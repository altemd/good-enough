import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef } from "react";
import type { AccountEntryState } from "#/features/accounts/access/account-access.functions";
import type { CurrentAccount } from "#/features/accounts/account-contract";
import { createDemoApiToken } from "#/features/accounts/api-keys/api-key.functions";
import { recordLandingPageView } from "#/features/operations-analytics/anonymous-analytics.functions";

import { PublicDemoPage } from "./public-demo-page.tsx";

export function PublicDemoRoutePage({
	account,
	entryState,
}: {
	account: CurrentAccount | null;
	entryState: AccountEntryState;
}) {
	const createToken = useServerFn(createDemoApiToken);
	const recordView = useServerFn(recordLandingPageView);
	const recordedView = useRef(false);
	useEffect(() => {
		if (recordedView.current) return;
		recordedView.current = true;
		void recordView({ data: {} }).catch(() => {});
	}, [recordView]);
	return (
		<PublicDemoPage
			account={account}
			entryState={entryState}
			issueDemoToken={() => createToken({ data: {} })}
		/>
	);
}
