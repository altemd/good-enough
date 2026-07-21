import { createFileRoute } from "@tanstack/react-router";

import { PasswordChangePage } from "#/features/accounts/access/ui/password-change-page";

export const Route = createFileRoute("/_authenticated/account/security")({
	component: SecurityRoute,
});

function SecurityRoute() {
	return <PasswordChangePage account={Route.useRouteContext().account} />;
}
