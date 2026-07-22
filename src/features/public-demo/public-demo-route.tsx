import { useServerFn } from "@tanstack/react-start";
import type { AccountEntryState } from "#/features/accounts/access/ui/access-page";
import type { CurrentAccount } from "#/features/accounts/account-contract";
import { createDemoApiToken } from "#/features/accounts/api-keys/api-key.functions";

import { PublicDemoPage } from "./public-demo-page.tsx";

export function PublicDemoRoutePage({
	account,
	entryState,
}: {
	account: CurrentAccount | null;
	entryState: AccountEntryState;
}) {
	const createToken = useServerFn(createDemoApiToken);
	return (
		<PublicDemoPage
			account={account}
			entryState={entryState}
			issueDemoToken={() => createToken({ data: {} })}
		/>
	);
}
