import {
	createFileRoute,
	Link,
	Outlet,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import {
	getCurrentAccount,
	logoutAccount,
} from "#/features/accounts/access/account-access.functions";

export const Route = createFileRoute("/_authenticated")({
	beforeLoad: async ({ location }) => {
		const account = await getCurrentAccount();
		if (!account) throw redirect({ to: "/login" });
		if (account.mustChangePassword && location.pathname !== "/account/security")
			throw redirect({ to: "/account/security" });
		return { account };
	},
	component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
	const { account } = Route.useRouteContext();
	const logout = useServerFn(logoutAccount);
	const router = useRouter();
	return (
		<>
			<header className="border-b px-8 py-4">
				<nav className="mx-auto flex max-w-5xl items-center gap-5">
					<Link className="font-bold" to="/account">
						Good Enough
					</Link>
					<Link to="/account/api-keys">API keys</Link>
					<Link to="/account/security">Security</Link>
					{account.role === "admin" ? (
						<Link to="/admin/users">Users</Link>
					) : null}
					<span className="ml-auto">{account.username}</span>
					<button
						type="button"
						className="underline"
						onClick={async () => {
							await logout();
							await router.navigate({ to: "/login" });
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
