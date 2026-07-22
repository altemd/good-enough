import { createFileRoute } from "@tanstack/react-router";

import {
	getAccountEntryState,
	getCurrentAccount,
} from "#/features/accounts/access/account-access.functions";
import { PublicDemoRoutePage } from "#/features/public-demo/public-demo-route";

export const Route = createFileRoute("/")({
	loader: async () => {
		const [account, entryState] = await Promise.all([
			getCurrentAccount(),
			getAccountEntryState(),
		]);
		return { account, entryState };
	},
	component: IndexRoute,
});

function IndexRoute() {
	return <PublicDemoRoutePage {...Route.useLoaderData()} />;
}
