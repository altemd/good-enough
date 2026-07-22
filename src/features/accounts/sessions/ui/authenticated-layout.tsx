import { Link, Outlet, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { logoutAccount } from "../../access/account-access.functions";
import type { CurrentAccount } from "../../account-contract";

export function AuthenticatedLayout({ account }: { account: CurrentAccount }) {
	const logout = useServerFn(logoutAccount);
	const router = useRouter();

	return (
		<>
			<header className="border-b px-8 py-4">
				<nav className="mx-auto flex max-w-5xl items-center gap-5">
					<Link className="font-bold" to="/account">
						Good Enough
					</Link>
					<Link to="/account/live-console">Live console</Link>
					<Link to="/account/api-keys">API keys</Link>
					<Link to="/account/security">Security</Link>
					{account.role === "admin" ? (
						<>
							<Link to="/admin/analytics">Analytics</Link>
							<Link to="/admin/users">Users</Link>
						</>
					) : null}
					<span className="ml-auto">{account.username}</span>
					<button
						type="button"
						className="underline"
						onClick={async () => {
							await logout();
							await router.navigate({ to: "/", replace: true });
						}}
					>
						Sign out
					</button>
				</nav>
			</header>
			<Outlet />
		</>
	);
}
