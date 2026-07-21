import { createFileRoute } from "@tanstack/react-router";

import { getAccountEntryState } from "#/features/accounts/access/account-access.functions";
import { SetupPage } from "#/features/accounts/access/ui/setup-page";

export const Route = createFileRoute("/setup")({
	loader: () => getAccountEntryState(),
	component: SetupRoute,
});

function SetupRoute() {
	return <SetupPage state={Route.useLoaderData()} />;
}
