import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { registerAccount } from "../account-access.functions";
import { AccessPage, type AccountEntryState } from "./access-page";
import { AccountFormField } from "./account-form-field";

export function RegisterPage({ state }: { state: AccountEntryState }) {
	const register = useServerFn(registerAccount);
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);

	if (!state.configurationValid) {
		return (
			<AccessPage title="Registration unavailable">
				<p>Account configuration is invalid.</p>
			</AccessPage>
		);
	}
	if (state.setupRequired) {
		return (
			<AccessPage title="Setup required">
				<p>The operator must create the administrator first.</p>
				<Link to="/setup">Open setup</Link>
			</AccessPage>
		);
	}
	if (!state.registrationEnabled) {
		return (
			<AccessPage title="Registration closed">
				<p>New account registration is temporarily closed.</p>
				<Link to="/login">Sign in</Link>
			</AccessPage>
		);
	}

	return (
		<AccessPage title="Create account">
			<p>
				Registration creates a member account. Usernames are case-insensitive.
			</p>
			<form
				className="mt-6 grid max-w-md gap-4"
				onSubmit={async (event) => {
					event.preventDefault();
					setError(null);
					const form = new FormData(event.currentTarget);
					const result = await register({
						data: {
							username: String(form.get("username") ?? ""),
							password: String(form.get("password") ?? ""),
						},
					});
					if (!result.ok) {
						setError(
							result.code === "username_unavailable"
								? "That username is unavailable."
								: result.code === "rate_limited"
									? "Too many registration attempts. Try again later."
									: "Registration could not be completed.",
						);
						return;
					}
					await router.navigate({ to: "/login" });
				}}
			>
				<AccountFormField
					label="Username"
					name="username"
					autoComplete="username"
					required
				/>
				<AccountFormField
					label="Password"
					name="password"
					type="password"
					minLength={15}
					autoComplete="new-password"
					required
				/>
				{error ? <p className="text-red-700">{error}</p> : null}
				<button className="rounded bg-black px-4 py-2 text-white" type="submit">
					Register
				</button>
			</form>
			<p className="mt-6">
				Already registered?{" "}
				<Link className="underline" to="/login">
					Sign in
				</Link>
			</p>
		</AccessPage>
	);
}
