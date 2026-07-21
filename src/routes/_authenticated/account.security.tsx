import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { changeAccountPassword } from "#/features/accounts/account-access.functions";

export const Route = createFileRoute("/_authenticated/account/security")({
	component: SecurityPage,
});

function SecurityPage() {
	const { account } = Route.useRouteContext();
	const changePassword = useServerFn(changeAccountPassword);
	const router = useRouter();
	const [message, setMessage] = useState<string | null>(null);
	return (
		<main className="mx-auto max-w-5xl p-8">
			<h1 className="text-3xl font-bold">Security</h1>
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
				<label>
					Current password
					<input
						className="block w-full rounded border p-2"
						name="currentPassword"
						type="password"
						autoComplete="current-password"
						required
					/>
				</label>
				<label>
					New password
					<input
						className="block w-full rounded border p-2"
						name="newPassword"
						type="password"
						autoComplete="new-password"
						minLength={15}
						required
					/>
				</label>
				{message ? <p>{message}</p> : null}
				<button className="rounded bg-black px-4 py-2 text-white" type="submit">
					Change password
				</button>
			</form>
		</main>
	);
}
