import {
	createStreamMetadataObserver,
	type MetadataProtocol,
	type StreamMetadata,
} from "./metadata";

const DEFAULT_LLAMA_SERVER_URL = "http://127.0.0.1:8080";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const REQUEST_HEADERS_TO_STRIP = new Set([
	"authorization",
	"connection",
	"content-length",
	"cookie",
	"forwarded",
	"host",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
	"via",
	"x-api-key",
	"x-forwarded-for",
	"x-forwarded-host",
	"x-forwarded-port",
	"x-forwarded-proto",
]);
const RESPONSE_HEADERS_TO_STRIP = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
]);

export type GatewayOutcome =
	| "cancelled"
	| "completed"
	| "configuration_error"
	| "rejected"
	| "upstream_error";

export interface InferenceRequestMetadata extends StreamMetadata {
	event: "inference_request";
	requestId: string;
	endpoint: string;
	startedAt: string;
	upstreamStatus: number | null;
	outcome: GatewayOutcome;
	upstreamHeadersMs: number | null;
	durationMs: number;
}

export type MetadataRecorder = (metadata: InferenceRequestMetadata) => void;

export interface GatewayEndpoint {
	readonly method: "GET" | "POST";
	readonly path: "/v1/chat/completions" | "/v1/messages" | "/v1/models";
	readonly protocol: MetadataProtocol;
}

interface GatewayDependencies {
	llamaServerUrl?: string;
	fetch?: typeof globalThis.fetch;
	record?: MetadataRecorder;
	clientSignal?: AbortSignal;
	now?: () => number;
	wallClock?: () => Date;
	createRequestId?: () => string;
}

export async function handleGatewayRequest(
	request: Request,
	endpoint: GatewayEndpoint | null,
	dependencies: GatewayDependencies = {},
): Promise<Response> {
	const now = dependencies.now ?? performance.now.bind(performance);
	const startedAtMs = now();
	const startedAt = (dependencies.wallClock?.() ?? new Date()).toISOString();
	const requestId =
		dependencies.createRequestId?.() ?? globalThis.crypto.randomUUID();
	const observer = createStreamMetadataObserver("none");
	let upstreamStatus: number | null = null;
	let upstreamHeadersMs: number | null = null;
	let finalized = false;

	const finalize = (outcome: GatewayOutcome, metadataObserver = observer) => {
		if (finalized) {
			return;
		}
		finalized = true;

		const streamMetadata = metadataObserver.snapshot();
		const metadata: InferenceRequestMetadata = {
			event: "inference_request",
			requestId,
			endpoint: endpoint?.path ?? "/v1/*",
			startedAt,
			upstreamStatus,
			outcome,
			upstreamHeadersMs,
			durationMs: elapsed(now, startedAtMs),
			...streamMetadata,
		};

		try {
			dependencies.record?.(metadata);
		} catch {
			// Observability must never interrupt the proxied response.
		}
	};

	if (endpoint === null || endpoint.method !== request.method) {
		const allowedMethods = endpoint ? [endpoint.method] : [];
		const status = endpoint ? 405 : 404;
		upstreamStatus = status;
		finalize("rejected");

		return gatewayError(
			status,
			status === 405 ? "method_not_allowed" : "not_found",
			status === 405
				? "Method not allowed for this endpoint."
				: "Endpoint not found.",
			requestId,
			allowedMethods,
		);
	}

	let llamaOrigin: URL;
	try {
		llamaOrigin = parseLoopbackOrigin(
			dependencies.llamaServerUrl ?? DEFAULT_LLAMA_SERVER_URL,
		);
	} catch {
		upstreamStatus = 500;
		finalize("configuration_error");
		return gatewayError(
			500,
			"configuration_error",
			"Inference backend configuration is invalid.",
			requestId,
		);
	}

	const clientSignal = dependencies.clientSignal ?? request.signal;
	const abortController = new AbortController();
	const abortUpstream = () => abortController.abort(clientSignal.reason);
	if (clientSignal.aborted) {
		abortUpstream();
	} else {
		clientSignal.addEventListener("abort", abortUpstream, { once: true });
	}

	const cleanupAbortListener = () => {
		clientSignal.removeEventListener("abort", abortUpstream);
	};

	const upstreamUrl = new URL(endpoint.path, llamaOrigin);
	upstreamUrl.search = new URL(request.url).search;
	const requestHeaders = sanitizeHeaders(
		request.headers,
		REQUEST_HEADERS_TO_STRIP,
	);
	requestHeaders.set("x-request-id", requestId);

	const requestInit: RequestInit & { duplex?: "half" } = {
		method: request.method,
		headers: requestHeaders,
		signal: abortController.signal,
	};
	if (request.body !== null) {
		requestInit.body = request.body;
		requestInit.duplex = "half";
	}

	let upstreamResponse: Response;
	try {
		const upstreamRequest = new Request(upstreamUrl, requestInit);
		upstreamResponse = await (dependencies.fetch ?? globalThis.fetch)(
			upstreamRequest,
		);
		upstreamHeadersMs = elapsed(now, startedAtMs);
		upstreamStatus = upstreamResponse.status;
	} catch {
		cleanupAbortListener();
		if (abortController.signal.aborted) {
			upstreamStatus = 499;
			finalize("cancelled");
			return new Response(null, {
				status: 499,
				statusText: "Client Closed Request",
				headers: { "x-request-id": requestId },
			});
		}

		upstreamStatus = 502;
		finalize("upstream_error");
		return gatewayError(
			502,
			"gateway_connection_error",
			"Inference backend is unavailable.",
			requestId,
		);
	}

	const responseHeaders = sanitizeHeaders(
		upstreamResponse.headers,
		RESPONSE_HEADERS_TO_STRIP,
	);
	responseHeaders.set("x-request-id", requestId);
	const isEventStream = responseHeaders
		.get("content-type")
		?.toLowerCase()
		.startsWith("text/event-stream");
	if (isEventStream) {
		if (!responseHeaders.has("cache-control")) {
			responseHeaders.set("cache-control", "no-cache");
		}
		if (!responseHeaders.has("x-accel-buffering")) {
			// Redundant with current llama.cpp, which sets this on streamed responses.
			// Keep this fallback for older or alternative compatible backends.
			responseHeaders.set("x-accel-buffering", "no");
		}
	}

	if (!upstreamResponse.body) {
		cleanupAbortListener();
		finalize("completed");
		return new Response(null, {
			status: upstreamResponse.status,
			statusText: upstreamResponse.statusText,
			headers: responseHeaders,
		});
	}

	const metadataObserver = createStreamMetadataObserver(
		isEventStream ? endpoint.protocol : "none",
	);
	const reader = upstreamResponse.body.getReader();
	const responseBody = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const result = await reader.read();
				if (result.done) {
					metadataObserver.finish(elapsed(now, startedAtMs));
					cleanupAbortListener();
					finalize("completed", metadataObserver);
					controller.close();
					return;
				}

				metadataObserver.observe(result.value, elapsed(now, startedAtMs));
				controller.enqueue(result.value);
			} catch (error) {
				cleanupAbortListener();
				const cancelled = abortController.signal.aborted;
				if (!cancelled) {
					abortController.abort();
				}
				finalize(cancelled ? "cancelled" : "upstream_error", metadataObserver);
				controller.error(error);
			}
		},
		async cancel(reason) {
			abortController.abort(reason);
			cleanupAbortListener();
			try {
				await reader.cancel(reason);
			} finally {
				finalize("cancelled", metadataObserver);
			}
		},
	});

	return new Response(responseBody, {
		status: upstreamResponse.status,
		statusText: upstreamResponse.statusText,
		headers: responseHeaders,
	});
}

function parseLoopbackOrigin(value: string): URL {
	const url = new URL(value);
	const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		!LOOPBACK_HOSTS.has(hostname) ||
		url.username.length > 0 ||
		url.password.length > 0 ||
		url.pathname !== "/" ||
		url.search.length > 0 ||
		url.hash.length > 0
	) {
		throw new Error("Invalid llama-server origin");
	}
	return url;
}

function sanitizeHeaders(
	source: Headers,
	blocked: ReadonlySet<string>,
): Headers {
	const headers = new Headers(source);
	const connectionTokens = headers
		.get("connection")
		?.split(",")
		.map((header) => header.trim().toLowerCase())
		.filter(Boolean);

	for (const header of blocked) {
		headers.delete(header);
	}
	for (const header of connectionTokens ?? []) {
		headers.delete(header);
	}
	return headers;
}

function gatewayError(
	status: number,
	type: string,
	message: string,
	requestId: string,
	allowedMethods: ReadonlyArray<string> = [],
): Response {
	const headers = new Headers({
		"content-type": "application/json; charset=utf-8",
		"x-request-id": requestId,
	});
	if (allowedMethods.length > 0) {
		headers.set("allow", allowedMethods.join(", "));
	}

	return new Response(JSON.stringify({ error: { type, message } }), {
		status,
		headers,
	});
}

function elapsed(now: () => number, startedAtMs: number): number {
	return Math.max(0, Math.round((now() - startedAtMs) * 1000) / 1000);
}
