import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { loginAccount } from "#/features/accounts/account-access.functions";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
	const login = useServerFn(loginAccount);
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	return (
		<main className="mx-auto max-w-3xl p-8">
			<h1 className="mb-4 text-3xl font-bold">Sign in</h1>
			<form
				className="mt-6 grid max-w-md gap-4"
				onSubmit={async (event) => {
					event.preventDefault();
					setError(null);
					const form = new FormData(event.currentTarget);
					const result = await login({
						data: {
							username: String(form.get("username") ?? ""),
							password: String(form.get("password") ?? ""),
						},
					});
					if (!result.ok) {
						setError(
							result.code === "rate_limited"
								? "Too many attempts. Try again later."
								: "Invalid username or password.",
						);
						return;
					}
					await router.navigate({
						to: result.value.restricted ? "/account/security" : "/account",
					});
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
						autoComplete="current-password"
						required
					/>
				</label>
				{error ? <p className="text-red-700">{error}</p> : null}
				<button className="rounded bg-black px-4 py-2 text-white" type="submit">
					Sign in
				</button>
			</form>
			<p className="mt-6">
				Need an account?{" "}
				<Link className="underline" to="/register">
					Register
				</Link>
			</p>
		</main>
	);
}
