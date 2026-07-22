import "@tanstack/react-start/server-only";

import { liveInferenceEventSource } from "#/features/live-inference-console/live-event-source.server";
import { createGenerationAdmissionController } from "./admission";
import { authenticateGatewayApiKey } from "./auth.server";
import type { GatewayLifecycleObserverFactory } from "./lifecycle-events";
import { type GatewayEndpoint, handleGatewayRequest } from "./proxy-stream";

const generationAdmission = createGenerationAdmissionController();
const createLifecycleObserver: GatewayLifecycleObserverFactory =
	({ principalId }) =>
	(event) =>
		liveInferenceEventSource.publishToPrincipal(principalId, event);

const MODELS_ENDPOINT = {
	kind: "discovery",
	method: "GET",
	path: "/v1/models",
	apiProtocol: "openai", // v1/models defaults to openai spec, TODO: discovery with anthropic spec
} as const satisfies GatewayEndpoint;

const OPENAI_CHAT_COMPLETIONS_ENDPOINT = {
	kind: "generation",
	method: "POST",
	path: "/v1/chat/completions",
	apiProtocol: "openai",
} as const satisfies GatewayEndpoint;

const ANTHROPIC_MESSAGES_ENDPOINT = {
	kind: "generation",
	method: "POST",
	path: "/v1/messages",
	apiProtocol: "anthropic",
} as const satisfies GatewayEndpoint;

export function handleModelsRequest(request: Request): Promise<Response> {
	return handleConfiguredGatewayRequest(request, MODELS_ENDPOINT);
}

export function handleOpenAiChatCompletionsRequest(
	request: Request,
): Promise<Response> {
	return handleConfiguredGatewayRequest(
		request,
		OPENAI_CHAT_COMPLETIONS_ENDPOINT,
	);
}

export function handleAnthropicMessagesRequest(
	request: Request,
): Promise<Response> {
	return handleConfiguredGatewayRequest(request, ANTHROPIC_MESSAGES_ENDPOINT);
}

export function handleUnknownV1Request(request: Request): Promise<Response> {
	return handleConfiguredGatewayRequest(request, null);
}

function handleConfiguredGatewayRequest(
	request: Request,
	endpoint: GatewayEndpoint | null,
): Promise<Response> {
	return handleGatewayRequest(request, endpoint, {
		admission: generationAdmission,
		authenticate: (candidateRequest, apiProtocol) =>
			authenticateGatewayApiKey(candidateRequest, apiProtocol),
		llamaServerUrl: process.env.LLAMA_SERVER_URL,
		createLifecycleObserver,
	});
}
