import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import type { CurrentAccount } from "../../account-contract";
import { AccountPageLayout } from "../../ui/account-page-layout";
import { changeAccountPassword } from "../account-access.functions";
import { AccountFormField } from "./account-form-field";

export function PasswordChangePage({ account }: { account: CurrentAccount }) {
	const changePassword = useServerFn(changeAccountPassword);
	const router = useRouter();
	const [message, setMessage] = useState<string | null>(null);

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
					setMessage(null);
					const form = new FormData(event.currentTarget);
					const result = await changePassword({
						data: {
							currentPassword: String(form.get("currentPassword") ?? ""),
							newPassword: String(form.get("newPassword") ?? ""),
						},
					});
					if (!result.ok) {
						setMessage("Password could not be changed.");
						return;
					}
					setMessage("Password changed.");
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
				{message ? <p>{message}</p> : null}
				<button className="rounded bg-black px-4 py-2 text-white" type="submit">
					Change password
				</button>
			</form>
		</AccountPageLayout>
	);
}
