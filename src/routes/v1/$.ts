import { createFileRoute } from "@tanstack/react-router";

import { handleUnknownV1Request } from "#/features/inference-gateway/gateway.server";

interface GatewayRouteHandlerContext {
	request: Request;
}

const rejectUnknownV1Request = ({ request }: GatewayRouteHandlerContext) =>
	handleUnknownV1Request(request);

export const Route = createFileRoute("/v1/$")({
	server: {
		handlers: {
			ANY: rejectUnknownV1Request,
		},
	},
});
