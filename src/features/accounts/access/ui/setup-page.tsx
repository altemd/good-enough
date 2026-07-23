import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { Button } from "#/components/ui/button";

import { bootstrapAccount } from "../account-access.functions";
import { AccessPage, type AccountEntryState } from "./access-page";
import { AccountFormField } from "./account-form-field";

export function SetupPage({ state }: { state: AccountEntryState }) {
	const router = useRouter();
	const bootstrap = useServerFn(bootstrapAccount);
	const [error, setError] = useState<string | null>(null);

	if (!state.configurationValid) {
		return (
			<AccessPage title="Setup unavailable">
				<p>Account configuration is invalid.</p>
			</AccessPage>
		);
	}
	if (!state.setupRequired) {
		return (
			<AccessPage title="Setup complete">
				<p>The administrator already exists.</p>
				<Link to="/login">Sign in</Link>
			</AccessPage>
		);
	}

	return (
		<AccessPage title="Create administrator">
			<p>This trusted setup works only while the account database is empty.</p>
			<form
				className="mt-6 grid max-w-md gap-4"
				onSubmit={async (event) => {
					event.preventDefault();
					setError(null);
					const form = new FormData(event.currentTarget);
					const result = await bootstrap({
						data: {
							username: String(form.get("username") ?? ""),
							password: String(form.get("password") ?? ""),
							bootstrapToken: String(form.get("bootstrapToken") ?? ""),
						},
					});
					if (!result.ok) {
						setError(messageFor(result.code));
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
					autoComplete="new-password"
					minLength={15}
					required
				/>
				<AccountFormField
					label="Bootstrap token"
					name="bootstrapToken"
					type="password"
					autoComplete="off"
					required
				/>
				{error ? (
					<p role="alert" className="text-destructive">
						{error}
					</p>
				) : null}
				<Button size="lg" type="submit">
					Create administrator
				</Button>
			</form>
		</AccessPage>
	);
}

function messageFor(code: string) {
	return code === "invalid_input"
		? "Use a valid username and a password of at least 15 characters."
		: code === "setup_complete"
			? "Setup has already completed."
			: "Setup could not be completed.";
}
