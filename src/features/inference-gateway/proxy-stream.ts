import type {
	AdmissionSnapshot,
	GenerationAdmissionController,
	GenerationLease,
} from "./admission";
import type { ApiProtocol } from "./api-protocol";
import type { AuthenticationDecision } from "./auth.server";
import { createStreamMetadataObserver, type StreamMetadata } from "./metadata";
import {
	applyProtocolRequestIdHeaders,
	createProtocolErrorResponse,
	createProtocolStreamErrorEvent,
	type NormalizedUpstreamError,
	normalizeUpstreamErrorResponse,
} from "./protocol-errors";

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

export type GatewayRejectionReason =
	| "authentication_failed"
	| "capacity_exceeded"
	| "method_not_allowed"
	| "not_found";

export type GatewayAdmissionStatus = "admitted" | "not_applicable" | "rejected";

export type GatewayAuthenticationStatus =
	| "authenticated"
	| "configuration_error"
	| "rejected";

export interface InferenceRequestMetadata extends StreamMetadata {
	event: "inference_request";
	requestId: string;
	endpoint: string;
	startedAt: string;
	responseStatus: number;
	upstreamStatus: number | null;
	outcome: GatewayOutcome;
	rejectionReason: GatewayRejectionReason | null;
	authenticationStatus: GatewayAuthenticationStatus;
	admissionStatus: GatewayAdmissionStatus;
	concurrencyLimit: number | null;
	activeGenerationsAtAdmission: number | null;
	queuedGenerationsAtAdmission: number | null;
	upstreamHeadersMs: number | null;
	durationMs: number;
}

export type MetadataRecorder = (metadata: InferenceRequestMetadata) => void;

export interface GatewayEndpoint {
	readonly kind: "discovery" | "generation";
	readonly method: "GET" | "POST";
	readonly path: "/v1/chat/completions" | "/v1/messages" | "/v1/models";
	readonly apiProtocol: ApiProtocol;
}

export type GatewayAuthenticator = (
	request: Request,
	apiProtocol: ApiProtocol,
) => AuthenticationDecision | Promise<AuthenticationDecision>;

export interface GatewayDependencies {
	authenticate: GatewayAuthenticator;
	admission: GenerationAdmissionController;
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
	dependencies: GatewayDependencies,
): Promise<Response> {
	const now = dependencies.now ?? performance.now.bind(performance);
	const startedAtMs = now();
	const startedAt = (dependencies.wallClock?.() ?? new Date()).toISOString();
	const requestId =
		dependencies.createRequestId?.() ?? globalThis.crypto.randomUUID();
	const apiProtocol = endpoint?.apiProtocol ?? "openai";
	const observer = createStreamMetadataObserver("none");
	let upstreamStatus: number | null = null;
	let upstreamHeadersMs: number | null = null;
	let rejectionReason: GatewayRejectionReason | null = null;
	let authenticationStatus: GatewayAuthenticationStatus = "rejected";
	let admissionStatus: GatewayAdmissionStatus = "not_applicable";
	let admissionSnapshot: AdmissionSnapshot | null = null;
	let generationLease: GenerationLease | null = null;
	let finalized = false;

	const finalize = (
		outcome: GatewayOutcome,
		responseStatus: number,
		metadataObserver = observer,
	) => {
		if (finalized) {
			return;
		}
		finalized = true;
		generationLease?.release();

		const streamMetadata = metadataObserver.snapshot();
		const metadata: InferenceRequestMetadata = {
			event: "inference_request",
			requestId,
			endpoint: endpoint?.path ?? "/v1/*",
			startedAt,
			responseStatus,
			upstreamStatus,
			outcome,
			rejectionReason,
			authenticationStatus,
			admissionStatus,
			concurrencyLimit: admissionSnapshot?.concurrencyLimit ?? null,
			activeGenerationsAtAdmission:
				admissionSnapshot?.activeGenerations ?? null,
			queuedGenerationsAtAdmission:
				admissionSnapshot?.queuedGenerations ?? null,
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

	let authentication: AuthenticationDecision;
	try {
		authentication = await dependencies.authenticate(request, apiProtocol);
	} catch {
		authentication = { status: "configuration_error" };
	}
	authenticationStatus = authentication.status;

	if (authentication.status === "configuration_error") {
		finalize("configuration_error", 500);
		return createProtocolErrorResponse({
			protocol: apiProtocol,
			status: 500,
			code: "configuration_error",
			message: "Gateway authentication configuration is invalid.",
			requestId,
		});
	}

	if (authentication.status === "rejected") {
		rejectionReason = "authentication_failed";
		finalize("rejected", 401);
		return createProtocolErrorResponse({
			protocol: apiProtocol,
			status: 401,
			code: "authentication_failed",
			message: "Authentication failed.",
			requestId,
		});
	}

	const clientSignal = dependencies.clientSignal ?? request.signal;
	if (clientSignal.aborted) {
		finalize("cancelled", 499);
		return createProtocolErrorResponse({
			protocol: apiProtocol,
			status: 499,
			statusText: "Client Closed Request",
			code: "client_cancelled",
			message: "Request was cancelled before a response was available.",
			requestId,
		});
	}

	if (endpoint === null || endpoint.method !== request.method) {
		const allowedMethods = endpoint ? [endpoint.method] : [];
		const status = endpoint ? 405 : 404;
		rejectionReason = endpoint ? "method_not_allowed" : "not_found";
		finalize("rejected", status);

		return createProtocolErrorResponse({
			protocol: apiProtocol,
			status,
			code: status === 405 ? "method_not_allowed" : "not_found",
			message:
				status === 405
					? "Method not allowed for this endpoint."
					: "Endpoint not found.",
			requestId,
			allowedMethods,
		});
	}

	let llamaOrigin: URL;
	try {
		llamaOrigin = parseLoopbackOrigin(
			dependencies.llamaServerUrl ?? DEFAULT_LLAMA_SERVER_URL,
		);
	} catch {
		finalize("configuration_error", 500);
		return createProtocolErrorResponse({
			protocol: apiProtocol,
			status: 500,
			code: "configuration_error",
			message: "Inference backend configuration is invalid.",
			requestId,
		});
	}

	if (endpoint.kind === "generation") {
		const decision = dependencies.admission.tryAcquire();
		if (!decision.admitted) {
			admissionStatus = "rejected";
			admissionSnapshot = decision.snapshot;
			rejectionReason = "capacity_exceeded";
			finalize("rejected", 429);

			return createProtocolErrorResponse({
				protocol: apiProtocol,
				status: 429,
				code: "capacity_exceeded",
				message:
					"Inference capacity is currently in use. Retry the request later.",
				requestId,
			});
		}

		admissionStatus = "admitted";
		admissionSnapshot = decision.lease.snapshot;
		generationLease = decision.lease;
	}

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
			finalize("cancelled", 499);
			return createProtocolErrorResponse({
				protocol: apiProtocol,
				status: 499,
				statusText: "Client Closed Request",
				code: "client_cancelled",
				message: "Request was cancelled before a response was available.",
				requestId,
			});
		}

		finalize("upstream_error", 502);
		return createProtocolErrorResponse({
			protocol: apiProtocol,
			status: 502,
			code: "gateway_connection_error",
			message: "Inference backend is unavailable.",
			requestId,
		});
	}

	const responseHeaders = sanitizeHeaders(
		upstreamResponse.headers,
		RESPONSE_HEADERS_TO_STRIP,
	);
	applyProtocolRequestIdHeaders(
		responseHeaders,
		endpoint.apiProtocol,
		requestId,
	);

	if (upstreamResponse.status >= 400) {
		let normalizedError: NormalizedUpstreamError;
		try {
			normalizedError = await normalizeUpstreamErrorResponse({
				protocol: endpoint.apiProtocol,
				upstreamResponse,
				responseHeaders,
				requestId,
				signal: abortController.signal,
			});
		} catch {
			cleanupAbortListener();
			finalize("cancelled", 499);
			return createProtocolErrorResponse({
				protocol: endpoint.apiProtocol,
				status: 499,
				statusText: "Client Closed Request",
				code: "client_cancelled",
				message: "Request was cancelled before a response was available.",
				requestId,
			});
		}

		cleanupAbortListener();
		if (abortController.signal.aborted) {
			finalize("cancelled", 499);
			return createProtocolErrorResponse({
				protocol: endpoint.apiProtocol,
				status: 499,
				statusText: "Client Closed Request",
				code: "client_cancelled",
				message: "Request was cancelled before a response was available.",
				requestId,
			});
		}

		finalize(
			normalizedError.bodyReadFailed ? "upstream_error" : "completed",
			upstreamResponse.status,
		);
		return normalizedError.response;
	}

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
		finalize("completed", upstreamResponse.status);
		return new Response(null, {
			status: upstreamResponse.status,
			statusText: upstreamResponse.statusText,
			headers: responseHeaders,
		});
	}

	const metadataObserver = createStreamMetadataObserver(
		isEventStream && endpoint.kind === "generation"
			? endpoint.apiProtocol
			: "none",
	);
	const reader = upstreamResponse.body.getReader();
	const responseBody = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const result = await reader.read();
				if (result.done) {
					metadataObserver.finish(elapsed(now, startedAtMs));
					cleanupAbortListener();
					finalize("completed", upstreamResponse.status, metadataObserver);
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
				finalize(
					cancelled ? "cancelled" : "upstream_error",
					upstreamResponse.status,
					metadataObserver,
				);
				if (!cancelled && isEventStream && endpoint.kind === "generation") {
					controller.enqueue(
						createProtocolStreamErrorEvent(endpoint.apiProtocol),
					);
					controller.close();
					return;
				}
				controller.error(error);
			}
		},
		async cancel(reason) {
			abortController.abort(reason);
			cleanupAbortListener();
			try {
				await reader.cancel(reason);
			} finally {
				finalize("cancelled", upstreamResponse.status, metadataObserver);
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

function elapsed(now: () => number, startedAtMs: number): number {
	return Math.round((now() - startedAtMs) * 1000) / 1000;
}
