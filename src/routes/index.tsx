import { createFileRoute, redirect } from "@tanstack/react-router";

import { getCurrentAccount } from "#/features/accounts/account-access.functions";

export const Route = createFileRoute("/")({
	beforeLoad: async () => {
		const account = await getCurrentAccount();
		throw redirect({ to: account ? "/account" : "/login" });
	},
});
