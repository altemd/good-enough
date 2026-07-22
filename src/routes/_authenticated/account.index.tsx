import { createFileRoute } from "@tanstack/react-router";

import { AccountOverviewPage } from "#/features/accounts/ui/account-overview-page";

export const Route = createFileRoute("/_authenticated/account/")({
	component: AccountIndexRoute,
});

function AccountIndexRoute() {
	return <AccountOverviewPage account={Route.useRouteContext().account} />;
}
