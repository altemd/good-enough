import { Link } from "@tanstack/react-router";
import { PageLayout } from "#/components/ui/page-layout";
import type { AccountEntryState } from "#/features/accounts/access/account-access.functions";

import { RegistrationForm } from "./registration-form";

export function RegisterPage({ state }: { state: AccountEntryState }) {
	return (
		<PageLayout title="Create account" width="narrow">
			<div className="mt-6 max-w-md">
				<RegistrationForm state={state} />
			</div>
			<p className="mt-6">
				Already registered?{" "}
				<Link className="underline" to="/login">
					Sign in
				</Link>
			</p>
		</PageLayout>
	);
}
