import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import {
	getAccountEntryState,
	registerAccount,
} from "#/features/accounts/access/account-access.functions";

export const Route = createFileRoute("/register")({
	loader: () => getAccountEntryState(),
	component: RegisterPage,
});

function RegisterPage() {
	const state = Route.useLoaderData();
	const register = useServerFn(registerAccount);
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	if (!state.configurationValid)
		return (
			<Page title="Registration unavailable">
				<p>Account configuration is invalid.</p>
			</Page>
		);
	if (state.setupRequired)
		return (
			<Page title="Setup required">
				<p>The operator must create the administrator first.</p>
				<Link to="/setup">Open setup</Link>
			</Page>
		);
	if (!state.registrationEnabled)
		return (
			<Page title="Registration closed">
				<p>New account registration is temporarily closed.</p>
				<Link to="/login">Sign in</Link>
			</Page>
		);
	return (
		<Page title="Create account">
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
						minLength={15}
						autoComplete="new-password"
						required
					/>
				</label>
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
		</Page>
	);
}

function Page({
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
