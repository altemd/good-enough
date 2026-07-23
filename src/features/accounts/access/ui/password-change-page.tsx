import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { Button } from "#/components/ui/button";

import type { CurrentAccount } from "../../account-contract";
import { AccountPageLayout } from "../../ui/account-page-layout";
import { changeAccountPassword } from "../account-access.functions";
import { AccountFormField } from "./account-form-field";

export function PasswordChangePage({ account }: { account: CurrentAccount }) {
	const changePassword = useServerFn(changeAccountPassword);
	const router = useRouter();
	const [feedback, setFeedback] = useState<{
		kind: "success" | "error";
		text: string;
	} | null>(null);

	return (
		<AccountPageLayout title="Security">
			{account.mustChangePassword ? (
				<p className="mt-4 rounded border border-amber-500 bg-amber-50 p-3">
					You must replace the temporary password before using account features.
				</p>
			) : null}
			<form
				className="mt-6 grid max-w-md gap-4"
				onSubmit={async (event) => {
					event.preventDefault();
					setFeedback(null);
					const form = new FormData(event.currentTarget);
					const result = await changePassword({
						data: {
							currentPassword: String(form.get("currentPassword") ?? ""),
							newPassword: String(form.get("newPassword") ?? ""),
						},
					});
					if (!result.ok) {
						setFeedback({
							kind: "error",
							text: "Password could not be changed.",
						});
						return;
					}
					setFeedback({ kind: "success", text: "Password changed." });
					await router.invalidate();
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
						role="alert"
						className={
							feedback.kind === "error"
								? "text-destructive"
								: "text-emerald-700"
						}
					>
						{feedback.text}
					</p>
				) : null}
				<Button size="lg" type="submit">
					Change password
				</Button>
			</form>
		</AccountPageLayout>
	);
}
