import { createFileRoute } from "@tanstack/react-router";

import { getPersonalApiKeys } from "#/features/accounts/api-keys/api-key.functions";
import { ApiKeysPage } from "#/features/accounts/api-keys/ui/api-keys-page";

export const Route = createFileRoute("/_authenticated/account/api-keys")({
	loader: () => getPersonalApiKeys(),
	component: ApiKeysRoute,
});

function ApiKeysRoute() {
	return <ApiKeysPage keys={Route.useLoaderData() ?? []} />;
}
