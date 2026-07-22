import { createFileRoute } from "@tanstack/react-router";

import { PersonalLiveConsolePage } from "#/features/live-inference-console/ui/personal-live-console-page";

export const Route = createFileRoute("/_authenticated/account/live-console")({
	component: PersonalLiveConsolePage,
});
