import { createFileRoute } from "@tanstack/react-router";

import { getAccountEntryState } from "#/features/accounts/access/account-access.functions";
import { RegisterPage } from "#/features/accounts/access/ui/register-page";

export const Route = createFileRoute("/register")({
	loader: () => getAccountEntryState(),
	component: RegisterRoute,
});

function RegisterRoute() {
	return <RegisterPage state={Route.useLoaderData()} />;
}
