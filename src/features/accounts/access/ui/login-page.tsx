import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { loginAccount } from "../account-access.functions";
import { AccessPage } from "./access-page";
import { AccountFormField } from "./account-form-field";

export function LoginPage() {
	const login = useServerFn(loginAccount);
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);

	return (
		<AccessPage title="Sign in">
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
					autoComplete="current-password"
					required
				/>
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
		</AccessPage>
	);
}
