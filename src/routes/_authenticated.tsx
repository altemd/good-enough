import { createFileRoute, redirect } from "@tanstack/react-router";

import { getCurrentAccount } from "#/features/accounts/access/account-access.functions";
import { AuthenticatedLayout } from "#/features/accounts/sessions/ui/authenticated-layout";

export const Route = createFileRoute("/_authenticated")({
	beforeLoad: async ({ location }) => {
		const account = await getCurrentAccount();
		if (!account) throw redirect({ to: "/login" });
		if (
			account.mustChangePassword &&
			location.pathname !== "/account/security"
		) {
			throw redirect({ to: "/account/security" });
		}
		return { account };
	},
	component: AuthenticatedRoute,
});

function AuthenticatedRoute() {
	return <AuthenticatedLayout account={Route.useRouteContext().account} />;
}
