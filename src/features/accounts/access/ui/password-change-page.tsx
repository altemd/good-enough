import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { useSubmission } from "#/components/common/use-submission";
import { Button } from "#/components/ui/button";

import { PageLayout } from "#/components/ui/page-layout";

import type { CurrentAccount } from "../../account-contract";
import { changeAccountPassword } from "../account-access.functions";
import { AccountFormField } from "./account-form-field";

function messageFor(code: string) {
	return code === "invalid_credentials"
		? "The current password is incorrect."
		: code === "invalid_input"
			? "Use a new password of at least 15 characters."
			: "Password could not be changed. Try again.";
}

export function PasswordChangePage({ account }: { account: CurrentAccount }) {
	const changePassword = useServerFn(changeAccountPassword);
	const router = useRouter();
	const { isSubmitting, error, run } = useSubmission();
	const [feedback, setFeedback] = useState<{
		kind: "success" | "error";
		text: string;
	} | null>(null);

	return (
		<PageLayout title="Security">
			{account.mustChangePassword ? (
				<p className="mt-4 rounded border border-warning bg-warning-surface p-3">
					You must replace the temporary password before using account features.
				</p>
			) : null}
			<form
				className="mt-6 grid max-w-md gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					const form = new FormData(event.currentTarget);
					void run("Password could not be changed. Try again.", async () => {
						setFeedback(null);
						const result = await changePassword({
							data: {
								currentPassword: String(form.get("currentPassword") ?? ""),
								newPassword: String(form.get("newPassword") ?? ""),
							},
						});
						if (!result.ok) {
							setFeedback({
								kind: "error",
								text: messageFor(result.code),
							});
							return;
						}
						setFeedback({ kind: "success", text: "Password changed." });
						await router.invalidate();
					});
				}}
			>
				<AccountFormField
					label="Current password"
					name="currentPassword"
					type="password"
					autoComplete="current-password"
					required
				/>
				<AccountFormField
					label="New password"
					name="newPassword"
					type="password"
					autoComplete="new-password"
					minLength={15}
					required
				/>
				{feedback ? (
					<p
						role={feedback.kind === "error" ? "alert" : "status"}
						className={
							feedback.kind === "error" ? "text-destructive" : "text-success"
						}
					>
						{feedback.text}
					</p>
				) : error ? (
					<p role="alert" className="text-destructive">
						{error}
					</p>
				) : null}
				<Button size="lg" type="submit" disabled={isSubmitting}>
					{isSubmitting ? "Changing password…" : "Change password"}
				</Button>
			</form>
		</PageLayout>
	);
}
