import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import {
	bootstrapAccount,
	getAccountEntryState,
} from "#/features/accounts/access/account-access.functions";

export const Route = createFileRoute("/setup")({
	loader: () => getAccountEntryState(),
	component: SetupPage,
});

function SetupPage() {
	const state = Route.useLoaderData();
	const router = useRouter();
	const bootstrap = useServerFn(bootstrapAccount);
	const [error, setError] = useState<string | null>(null);
	if (!state.configurationValid) {
		return (
			<PublicPage title="Setup unavailable">
				<p>Account configuration is invalid.</p>
			</PublicPage>
		);
	}
	if (!state.setupRequired) {
		return (
			<PublicPage title="Setup complete">
				<p>The administrator already exists.</p>
				<Link to="/login">Sign in</Link>
			</PublicPage>
		);
	}
	return (
		<PublicPage title="Create administrator">
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
				<label>
					Username
					<input
						className="block w-full rounded border p-2"
						name="username"
						autoComplete="username"
						required
					/>
				</label>
				<label>
					Password
					<input
						className="block w-full rounded border p-2"
						name="password"
						type="password"
						autoComplete="new-password"
						minLength={15}
						required
					/>
				</label>
				<label>
					Bootstrap token
					<input
						className="block w-full rounded border p-2"
						name="bootstrapToken"
						type="password"
						autoComplete="off"
						required
					/>
				</label>
				{error ? <p className="text-red-700">{error}</p> : null}
				<button className="rounded bg-black px-4 py-2 text-white" type="submit">
					Create administrator
				</button>
			</form>
		</PublicPage>
	);
}

function PublicPage({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<main className="mx-auto max-w-3xl p-8">
			<h1 className="mb-4 text-3xl font-bold">{title}</h1>
			{children}
		</main>
	);
}

function messageFor(code: string) {
	return code === "invalid_input"
		? "Use a valid username and a password of at least 15 characters."
		: code === "setup_complete"
			? "Setup has already completed."
			: "Setup could not be completed.";
}
