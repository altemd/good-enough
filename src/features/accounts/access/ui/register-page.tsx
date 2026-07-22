import { Link } from "@tanstack/react-router";

import { AccessPage, type AccountEntryState } from "./access-page";
import { RegistrationForm } from "./registration-form";

export function RegisterPage({ state }: { state: AccountEntryState }) {
	return (
		<AccessPage title="Create account">
			<div className="mt-6 max-w-md">
				<RegistrationForm state={state} />
			</div>
			<p className="mt-6">
				Already registered?{" "}
				<Link className="underline" to="/login">
					Sign in
				</Link>
			</p>
		</AccessPage>
	);
}
