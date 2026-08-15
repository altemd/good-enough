import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { useSubmission } from "#/components/common/use-submission";
import { Button } from "#/components/ui/button";

import { loginAccount } from "../account-access.functions";
import { AccountFormField } from "./account-form-field";

export function LoginForm() {
	const login = useServerFn(loginAccount);
	const router = useRouter();
	const { isSubmitting, error, setError, run } = useSubmission();

	return (
		<form
			className="grid gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				const form = new FormData(event.currentTarget);
				void run("Sign in could not be completed. Try again.", async () => {
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
			{error ? (
				<p className="text-sm text-destructive" role="alert">
					{error}
				</p>
			) : null}
			<Button size="lg" type="submit" disabled={isSubmitting}>
				{isSubmitting ? "Signing in…" : "Sign in"}
			</Button>
		</form>
	);
}
