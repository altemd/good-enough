import { Link } from "@tanstack/react-router";

import { AccessPage } from "./access-page";
import { LoginForm } from "./login-form";

export function LoginPage() {
	return (
		<AccessPage title="Sign in">
			<div className="mt-6 max-w-md">
				<LoginForm />
			</div>
			<p className="mt-6">
				Need an account?{" "}
				<Link className="underline" to="/register">
					Register
				</Link>
			</p>
		</AccessPage>
	);
}
