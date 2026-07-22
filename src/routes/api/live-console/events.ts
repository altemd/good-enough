import { createFileRoute } from "@tanstack/react-router";

import { handlePersonalEventStreamRequest } from "#/features/live-inference-console/personal-event-stream.server";

interface LiveConsoleEventsRouteHandlerContext {
	request: Request;
}

const handleLiveConsoleEventsRoute = ({
	request,
}: LiveConsoleEventsRouteHandlerContext) =>
	handlePersonalEventStreamRequest(request);

export const Route = createFileRoute("/api/live-console/events")({
	server: {
		handlers: {
			GET: handleLiveConsoleEventsRoute,
			ANY: handleLiveConsoleEventsRoute,
		},
	},
});
