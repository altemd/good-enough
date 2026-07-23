import type { CurrentAccount } from "../account-contract";
import { AccountPageLayout } from "./account-page-layout";

export function AccountOverviewPage({ account }: { account: CurrentAccount }) {
	return (
		<AccountPageLayout title="Account">
			<dl className="mt-6 grid max-w-lg grid-cols-2 gap-3">
				<dt>Username</dt>
				<dd>{account.username}</dd>
				<dt>Role</dt>
				<dd>{account.role}</dd>
			</dl>
			<p className="mt-8 text-muted-foreground">
				Inference content and per-user inference activity are not persisted.
			</p>
		</AccountPageLayout>
	);
}
