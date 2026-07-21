import { useServerFn } from "@tanstack/react-start";

import type { CurrentAccount } from "#/features/accounts/account-contract";
import { createDemoApiToken } from "#/features/accounts/api-keys/api-key.functions";

import { PublicDemoPage } from "./public-demo-page.tsx";

export function PublicDemoRoutePage({
	account,
}: {
	account: CurrentAccount | null;
}) {
	const createToken = useServerFn(createDemoApiToken);
	return (
		<PublicDemoPage
			account={account}
			issueDemoToken={() => createToken({ data: {} })}
		/>
	);
}
