import { createFileRoute } from "@tanstack/react-router";

import { handleAnthropicMessagesRequest } from "#/features/inference-gateway/gateway.server";

interface MessagesRouteHandlerContext {
	request: Request;
}

const handleMessagesRoute = ({ request }: MessagesRouteHandlerContext) =>
	handleAnthropicMessagesRequest(request);

export const Route = createFileRoute("/v1/messages")({
	server: {
		handlers: {
			POST: handleMessagesRoute,
			ANY: handleMessagesRoute,
		},
	},
});
