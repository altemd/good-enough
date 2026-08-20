import { Link } from "@tanstack/react-router";

import { PageLayout } from "#/components/ui/page-layout";

import { LoginForm } from "./login-form";

export function LoginPage() {
	return (
		<PageLayout title="Sign in" width="narrow">
			<div className="mt-6 max-w-md">
				<LoginForm />
			</div>
			<p className="mt-6">
				Need an account?{" "}
				<Link className="underline" to="/register">
					Register
				</Link>
			</p>
		</PageLayout>
	);
}
