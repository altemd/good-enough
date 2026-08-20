import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { useSubmission } from "#/components/common/use-submission";
import { Button } from "#/components/ui/button";
import { PageLayout } from "#/components/ui/page-layout";

import {
	type AccountEntryState,
	bootstrapAccount,
} from "../account-access.functions";
import { AccountFormField } from "./account-form-field";

export function SetupPage({ state }: { state: AccountEntryState }) {
	const router = useRouter();
	const bootstrap = useServerFn(bootstrapAccount);
	const { isSubmitting, error, setError, run } = useSubmission();

	if (!state.configurationValid) {
		return (
			<PageLayout title="Setup unavailable" width="narrow">
				<p>Account configuration is invalid.</p>
			</PageLayout>
		);
	}
	if (!state.setupRequired) {
		return (
			<PageLayout title="Setup complete" width="narrow">
				<p>The administrator already exists.</p>
				<Link to="/login">Sign in</Link>
			</PageLayout>
		);
	}

	return (
		<PageLayout title="Create administrator" width="narrow">
			<p>This trusted setup works only while the account database is empty.</p>
			<form
				className="mt-6 grid max-w-md gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					const form = new FormData(event.currentTarget);
					void run("Setup could not be completed. Try again.", async () => {
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
					});
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
				<Button size="lg" type="submit" disabled={isSubmitting}>
					{isSubmitting ? "Creating administrator…" : "Create administrator"}
				</Button>
			</form>
		</PageLayout>
	);
}

function messageFor(code: string) {
	return code === "invalid_input"
		? "Use a valid username and a password of at least 15 characters."
		: code === "setup_complete"
			? "Setup has already completed."
			: "Setup could not be completed.";
}
