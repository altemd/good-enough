import { createFileRoute } from "@tanstack/react-router";

import { handleOpenAiChatCompletionsRequest } from "#/features/inference-gateway/gateway.server";

interface ChatCompletionsRouteHandlerContext {
	request: Request;
}

const handleChatCompletionsRoute = ({
	request,
}: ChatCompletionsRouteHandlerContext) =>
	handleOpenAiChatCompletionsRequest(request);

export const Route = createFileRoute("/v1/chat/completions")({
	server: {
		handlers: {
			POST: handleChatCompletionsRoute,
			ANY: handleChatCompletionsRoute,
		},
	},
});
