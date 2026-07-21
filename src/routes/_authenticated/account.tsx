import { createFileRoute } from "@tanstack/react-router";

import { AccountOverviewPage } from "#/features/accounts/ui/account-overview-page";

export const Route = createFileRoute("/_authenticated/account")({
	component: AccountRoute,
});

function AccountRoute() {
	return <AccountOverviewPage account={Route.useRouteContext().account} />;
}
