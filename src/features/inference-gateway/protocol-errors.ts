import {
	applyAnthropicRequestIdHeaders,
	createAnthropicErrorBody,
	isConformingAnthropicError,
} from "./anthropic-errors";
import {
	applyOpenAiRequestIdHeaders,
	createOpenAiErrorBody,
	isConformingOpenAiError,
} from "./openai-errors";

const MAX_UPSTREAM_ERROR_BODY_BYTES = 64 * 1024;
const encoder = new TextEncoder();

export type ErrorProtocol = "anthropic" | "openai";

export type ProtocolErrorCode =
	| "authentication_failed"
	| "capacity_exceeded"
	| "client_cancelled"
	| "configuration_error"
	| "gateway_connection_error"
	| "method_not_allowed"
	| "not_found"
	| "upstream_error"
	| "upstream_stream_error";

interface ProtocolErrorResponseOptions {
	readonly protocol: ErrorProtocol;
	readonly status: number;
	readonly code: ProtocolErrorCode;
	readonly message: string;
	readonly requestId: string;
	readonly statusText?: string;
	readonly headers?: HeadersInit;
	readonly allowedMethods?: ReadonlyArray<string>;
}

interface NormalizeUpstreamErrorOptions {
	readonly protocol: ErrorProtocol;
	readonly upstreamResponse: Response;
	readonly responseHeaders: Headers;
	readonly requestId: string;
	readonly signal: AbortSignal;
}

export interface NormalizedUpstreamError {
	readonly response: Response;
	readonly bodyReadFailed: boolean;
}

type BoundedBodyResult =
	| { readonly kind: "complete"; readonly bytes: Uint8Array }
	| { readonly kind: "oversized" };

type JsonObject = Record<string, unknown>;

export function applyProtocolRequestIdHeaders(
	headers: Headers,
	protocol: ErrorProtocol,
	requestId: string,
): void {
	if (protocol === "anthropic") {
		applyAnthropicRequestIdHeaders(headers, requestId);
		return;
	}
	applyOpenAiRequestIdHeaders(headers, requestId);
}

export function createProtocolErrorResponse(
	options: ProtocolErrorResponseOptions,
): Response {
	const headers = new Headers(options.headers);
	removeStaleRepresentationHeaders(headers);
	headers.set("content-type", "application/json; charset=utf-8");
	applyProtocolRequestIdHeaders(headers, options.protocol, options.requestId);
	if (options.allowedMethods && options.allowedMethods.length > 0) {
		headers.set("allow", options.allowedMethods.join(", "));
	}

	return new Response(
		JSON.stringify(
			createProtocolErrorBody(
				options.protocol,
				options.status,
				options.code,
				options.message,
				options.requestId,
			),
		),
		{
			status: options.status,
			statusText: options.statusText,
			headers,
		},
	);
}

export async function normalizeUpstreamErrorResponse(
	options: NormalizeUpstreamErrorOptions,
): Promise<NormalizedUpstreamError> {
	const { upstreamResponse } = options;
	let boundedBody: BoundedBodyResult;

	try {
		boundedBody = await readBoundedBody(upstreamResponse.body);
	} catch (error) {
		if (options.signal.aborted) {
			throw error;
		}
		return {
			response: createUpstreamFallback(options),
			bodyReadFailed: true,
		};
	}

	if (
		boundedBody.kind === "complete" &&
		boundedBody.bytes.byteLength > 0 &&
		isJsonContentType(upstreamResponse.headers.get("content-type")) &&
		isConformingProtocolError(
			boundedBody.bytes,
			options.protocol,
			options.requestId,
		)
	) {
		const headers = new Headers(options.responseHeaders);
		removeStaleRepresentationHeaders(headers);
		applyProtocolRequestIdHeaders(headers, options.protocol, options.requestId);
		return {
			response: new Response(copyToArrayBuffer(boundedBody.bytes), {
				status: upstreamResponse.status,
				statusText: upstreamResponse.statusText,
				headers,
			}),
			bodyReadFailed: false,
		};
	}

	return {
		response: createUpstreamFallback(options),
		bodyReadFailed: false,
	};
}

export function createProtocolStreamErrorEvent(
	protocol: ErrorProtocol,
): Uint8Array {
	const body = createProtocolErrorBody(
		protocol,
		502,
		"upstream_stream_error",
		"Inference stream ended unexpectedly.",
		"unused-for-stream-events",
	);
	return encoder.encode(`\n\nevent: error\ndata: ${JSON.stringify(body)}\n\n`);
}

function createUpstreamFallback(
	options: NormalizeUpstreamErrorOptions,
): Response {
	return createProtocolErrorResponse({
		protocol: options.protocol,
		status: options.upstreamResponse.status,
		statusText: options.upstreamResponse.statusText,
		code: "upstream_error",
		message: "Inference backend returned an error.",
		requestId: options.requestId,
		headers: options.responseHeaders,
	});
}

function createProtocolErrorBody(
	protocol: ErrorProtocol,
	status: number,
	code: ProtocolErrorCode,
	message: string,
	requestId: string,
): JsonObject {
	if (protocol === "openai") {
		return createOpenAiErrorBody(status, code, message);
	}
	return createAnthropicErrorBody(
		status,
		message,
		requestId,
		code !== "upstream_stream_error",
	);
}

async function readBoundedBody(
	body: ReadableStream<Uint8Array> | null,
): Promise<BoundedBodyResult> {
	if (!body) {
		return { kind: "complete", bytes: new Uint8Array() };
	}

	const reader = body.getReader();
	const chunks: Array<Uint8Array> = [];
	let totalBytes = 0;

	while (true) {
		const result = await reader.read();
		if (result.done) {
			const bytes = new Uint8Array(totalBytes);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return { kind: "complete", bytes };
		}

		if (result.value.byteLength > MAX_UPSTREAM_ERROR_BODY_BYTES - totalBytes) {
			try {
				await reader.cancel("Upstream error body exceeded the parse limit.");
			} catch {
				// The sanitized fallback must not depend on cancellation succeeding.
			}
			return { kind: "oversized" };
		}

		chunks.push(result.value);
		totalBytes += result.value.byteLength;
	}
}

function isConformingProtocolError(
	bytes: Uint8Array,
	protocol: ErrorProtocol,
	requestId: string,
): boolean {
	let payload: unknown;
	try {
		payload = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(bytes),
		);
	} catch {
		return false;
	}

	if (!isJsonObject(payload)) {
		return false;
	}
	return protocol === "openai"
		? isConformingOpenAiError(payload)
		: isConformingAnthropicError(payload, requestId);
}

function isJsonContentType(value: string | null): boolean {
	const mediaType = value?.split(";", 1)[0]?.trim().toLowerCase();
	return (
		mediaType === "application/json" || mediaType?.endsWith("+json") === true
	);
}

function removeStaleRepresentationHeaders(headers: Headers): void {
	for (const header of [
		"content-encoding",
		"content-length",
		"content-md5",
		"digest",
		"etag",
	]) {
		headers.delete(header);
	}
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(copy).set(bytes);
	return copy;
}

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
