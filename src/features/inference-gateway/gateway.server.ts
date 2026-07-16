import "@tanstack/react-start/server-only";

import { createGenerationAdmissionController } from "./admission";
import {
	type GatewayEndpoint,
	handleGatewayRequest,
	type InferenceRequestMetadata,
} from "./proxy-stream";

const generationAdmission = createGenerationAdmissionController();

const MODELS_ENDPOINT = {
	kind: "discovery",
	method: "GET",
	path: "/v1/models",
	protocol: "none",
} as const satisfies GatewayEndpoint;

const OPENAI_CHAT_COMPLETIONS_ENDPOINT = {
	kind: "generation",
	method: "POST",
	path: "/v1/chat/completions",
	protocol: "openai",
} as const satisfies GatewayEndpoint;

const ANTHROPIC_MESSAGES_ENDPOINT = {
	kind: "generation",
	method: "POST",
	path: "/v1/messages",
	protocol: "anthropic",
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
		llamaServerUrl: process.env.LLAMA_SERVER_URL,
		record: recordInferenceMetadata,
	});
}

function recordInferenceMetadata(metadata: InferenceRequestMetadata) {
	console.info(JSON.stringify(metadata));
}
