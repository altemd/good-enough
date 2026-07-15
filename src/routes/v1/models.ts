import { createFileRoute } from "@tanstack/react-router";

import { handleModelsRequest } from "#/features/inference-gateway/gateway.server";

interface ModelsRouteHandlerContext {
	request: Request;
}

const handleModelsRoute = ({ request }: ModelsRouteHandlerContext) =>
	handleModelsRequest(request);

export const Route = createFileRoute("/v1/models")({
	server: {
		handlers: {
			GET: handleModelsRoute,
			HEAD: handleModelsRoute,
			ANY: handleModelsRoute,
		},
	},
});
