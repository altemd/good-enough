import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { Button } from "#/components/ui/button";

import { registerAccount } from "../account-access.functions";
import type { AccountEntryState } from "./access-page";
import { AccountFormField } from "./account-form-field";

export function RegistrationForm({ state }: { state: AccountEntryState }) {
	const register = useServerFn(registerAccount);
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	if (!state.configurationValid) {
		return <p>Account configuration is invalid.</p>;
	}
	if (state.setupRequired) {
		return (
			<div className="grid gap-3">
				<p>The operator must create the administrator first.</p>
				<Link className="underline" to="/setup">
					Open setup
				</Link>
			</div>
		);
	}
	if (!state.registrationEnabled) {
		return (
			<div className="grid gap-3">
				<p>New account registration is temporarily closed.</p>
				<Link className="underline" to="/login">
					Sign in instead
				</Link>
			</div>
		);
	}

	return (
		<>
			<div className="rounded-xl border bg-muted/40 p-4 text-sm leading-6">
				<p className="font-medium">
					An account lets you create personal API keys that expire seven days
					after creation.
				</p>
				<p className="mt-2 text-muted-foreground">
					The free one-hour key on the landing page is separate, so creating an
					account does not extend that key. An account also includes the live
					request-timing console. There is no paid tier.
				</p>
				<p className="mt-2 text-muted-foreground">
					Good Enough never persists prompts, responses, reasoning, or tool
					arguments. Account, session, and API-key lifecycle records are stored
					so you can sign in and manage access.
				</p>
			</div>
			<form
				className="mt-5 grid gap-4"
				onSubmit={async (event) => {
					event.preventDefault();
					setError(null);
					setIsSubmitting(true);
					const form = new FormData(event.currentTarget);
					try {
						const result = await register({
							data: {
								username: String(form.get("username") ?? ""),
								password: String(form.get("password") ?? ""),
							},
						});
						if (!result.ok) {
							setError(messageFor(result.code));
							return;
						}
						await router.navigate({ to: "/account/api-keys" });
					} catch {
						setError(
							"Registration could not finish. Your account may exist; try signing in before registering again.",
						);
					} finally {
						setIsSubmitting(false);
					}
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
				<p className="text-xs leading-5 text-muted-foreground">
					Use at least 15 characters. Usernames are case-insensitive.
				</p>
				{error ? (
					<p className="text-sm text-destructive" role="alert">
						{error}
					</p>
				) : null}
				<Button size="lg" type="submit" disabled={isSubmitting}>
					{isSubmitting ? "Creating account…" : "Create account"}
				</Button>
			</form>
		</>
	);
}

function messageFor(code: string) {
	if (code === "username_unavailable") return "That username is unavailable.";
	if (code === "rate_limited") {
		return "Too many registration attempts. Try again later.";
	}
	if (code === "invalid_input") {
		return "Use a valid username and a password of at least 15 characters.";
	}
	if (code === "registration_closed") return "Registration is closed.";
	return "Registration could not finish. Try signing in before registering again.";
}
