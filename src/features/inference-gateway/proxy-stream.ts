import type { GenerationAdmissionController } from "./admission";
import type { ApiProtocol } from "./api-protocol";
import type { AuthenticationDecision } from "./auth.server";
import type {
	GatewayLifecycleObserverFactory,
	GatewayRequestKind,
} from "./lifecycle-events";
import { createStreamMetadataObserver } from "./metadata";
import {
	createProtocolErrorResponse,
	createProtocolStreamErrorEvent,
	type NormalizedUpstreamError,
	normalizeUpstreamErrorResponse,
} from "./protocol-errors";
import {
	createGatewayRequestLifecycle,
	type MetadataRecorder,
} from "./request-lifecycle";
import {
	DEFAULT_LLAMA_SERVER_URL,
	parseLoopbackOrigin,
	prepareDownstreamHeaders,
	prepareUpstreamRequest,
} from "./request-preparation";

export type {
	GatewayAdmissionStatus,
	GatewayAuthenticationStatus,
	GatewayOutcome,
	GatewayRejectionReason,
	InferenceRequestMetadata,
	MetadataRecorder,
} from "./request-lifecycle";

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
	createLifecycleObserver?: GatewayLifecycleObserverFactory;
}

export async function handleGatewayRequest(
	request: Request,
	endpoint: GatewayEndpoint | null,
	dependencies: GatewayDependencies,
): Promise<Response> {
	const now = dependencies.now ?? performance.now.bind(performance);
	const requestKind = resolveRequestKind(request, endpoint);
	const lifecycle = createGatewayRequestLifecycle({
		endpoint: endpoint?.path ?? "/v1/*",
		requestKind,
		now,
		wallClock: dependencies.wallClock ?? (() => new Date()),
		createRequestId: dependencies.createRequestId,
		readCapacitySnapshot: () => dependencies.admission.snapshot(),
		record: dependencies.record,
	});
	const requestId = lifecycle.requestId;
	const apiProtocol = endpoint?.apiProtocol ?? "openai";

	let authentication: AuthenticationDecision;
	try {
		authentication = await dependencies.authenticate(request, apiProtocol);
	} catch {
		authentication = { status: "configuration_error" };
	}
	lifecycle.setAuthenticationStatus(authentication.status);

	if (authentication.status === "configuration_error") {
		lifecycle.finalize(
			{
				outcome: "configuration_error",
				stage: "authentication_configuration",
			},
			500,
		);
		return createProtocolErrorResponse({
			protocol: apiProtocol,
			status: 500,
			code: "configuration_error",
			message: "Gateway authentication configuration is invalid.",
			requestId,
		});
	}

	if (authentication.status === "rejected") {
		lifecycle.finalize(
			{ outcome: "rejected", reason: "authentication_failed" },
			401,
		);
		return createProtocolErrorResponse({
			protocol: apiProtocol,
			status: 401,
			code: "authentication_failed",
			message: "Authentication failed.",
			requestId,
		});
	}

	lifecycle.startObservation(
		createLifecycleObserver(dependencies.createLifecycleObserver, {
			principalId: authentication.principalId,
		}),
	);

	const clientSignal = dependencies.clientSignal ?? request.signal;
	if (clientSignal.aborted) {
		lifecycle.finalize({ outcome: "cancelled" }, 499);
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
		lifecycle.finalize(
			{
				outcome: "rejected",
				reason: endpoint ? "method_not_allowed" : "not_found",
			},
			status,
		);

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
		lifecycle.finalize(
			{ outcome: "configuration_error", stage: "backend_configuration" },
			500,
		);
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
			lifecycle.setAdmission("rejected", decision.snapshot);
			lifecycle.finalize(
				{ outcome: "rejected", reason: "capacity_exceeded" },
				429,
			);

			return createProtocolErrorResponse({
				protocol: apiProtocol,
				status: 429,
				code: "capacity_exceeded",
				message:
					"Inference capacity is currently in use. Retry the request later.",
				requestId,
			});
		}

		lifecycle.setAdmission("admitted", decision.lease.snapshot, decision.lease);
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

	let upstreamResponse: Response;
	try {
		const upstreamRequest = prepareUpstreamRequest({
			request,
			endpoint,
			llamaOrigin,
			signal: abortController.signal,
			requestId,
		});
		upstreamResponse = await (dependencies.fetch ?? globalThis.fetch)(
			upstreamRequest,
		);
		lifecycle.setUpstreamStatus(upstreamResponse.status);
	} catch {
		cleanupAbortListener();
		if (abortController.signal.aborted) {
			lifecycle.finalize({ outcome: "cancelled" }, 499);
			return createProtocolErrorResponse({
				protocol: apiProtocol,
				status: 499,
				statusText: "Client Closed Request",
				code: "client_cancelled",
				message: "Request was cancelled before a response was available.",
				requestId,
			});
		}

		lifecycle.finalize({ outcome: "upstream_error", stage: "connection" }, 502);
		return createProtocolErrorResponse({
			protocol: apiProtocol,
			status: 502,
			code: "gateway_connection_error",
			message: "Inference backend is unavailable.",
			requestId,
		});
	}

	const responseHeaders = prepareDownstreamHeaders(
		upstreamResponse.headers,
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
			lifecycle.finalize({ outcome: "cancelled" }, 499);
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
			lifecycle.finalize({ outcome: "cancelled" }, 499);
			return createProtocolErrorResponse({
				protocol: endpoint.apiProtocol,
				status: 499,
				statusText: "Client Closed Request",
				code: "client_cancelled",
				message: "Request was cancelled before a response was available.",
				requestId,
			});
		}

		lifecycle.finalize(
			normalizedError.bodyReadFailed
				? { outcome: "upstream_error", stage: "error_body" }
				: { outcome: "completed" },
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
		lifecycle.finalize({ outcome: "completed" }, upstreamResponse.status);
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
					metadataObserver.finish(lifecycle.elapsed());
					const { ttftMs } = metadataObserver.snapshot();
					if (ttftMs !== null) {
						lifecycle.recordFirstOutput(ttftMs);
					}
					cleanupAbortListener();
					lifecycle.finalize(
						{ outcome: "completed" },
						upstreamResponse.status,
						metadataObserver,
					);
					controller.close();
					return;
				}

				metadataObserver.observe(result.value, lifecycle.elapsed());
				const { ttftMs } = metadataObserver.snapshot();
				if (ttftMs !== null) {
					lifecycle.recordFirstOutput(ttftMs);
				}
				controller.enqueue(result.value);
			} catch (error) {
				cleanupAbortListener();
				const cancelled = abortController.signal.aborted;
				if (!cancelled) {
					abortController.abort();
				}
				lifecycle.finalize(
					cancelled
						? { outcome: "cancelled" }
						: { outcome: "upstream_error", stage: "stream_body" },
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
				lifecycle.finalize(
					{ outcome: "cancelled" },
					upstreamResponse.status,
					metadataObserver,
				);
			}
		},
	});

	return new Response(responseBody, {
		status: upstreamResponse.status,
		statusText: upstreamResponse.statusText,
		headers: responseHeaders,
	});
}

function resolveRequestKind(
	request: Request,
	endpoint: GatewayEndpoint | null,
): GatewayRequestKind {
	if (endpoint === null || endpoint.method !== request.method) {
		return "routing_rejection";
	}

	return endpoint.kind;
}

function createLifecycleObserver(
	factory: GatewayLifecycleObserverFactory | undefined,
	context: Parameters<GatewayLifecycleObserverFactory>[0],
) {
	try {
		return factory?.(context);
	} catch {
		return undefined;
	}
}
