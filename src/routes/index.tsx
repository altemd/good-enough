import { createFileRoute } from "@tanstack/react-router";

import { getCurrentAccount } from "#/features/accounts/access/account-access.functions";
import { PublicDemoRoutePage } from "#/features/public-demo/public-demo-route";

export const Route = createFileRoute("/")({
	loader: () => getCurrentAccount(),
	component: IndexRoute,
});

function IndexRoute() {
	return <PublicDemoRoutePage account={Route.useLoaderData()} />;
}
