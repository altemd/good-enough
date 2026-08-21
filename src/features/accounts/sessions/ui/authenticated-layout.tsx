import { Link, Outlet, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import type { ReactNode } from "react";

import { Button } from "#/components/ui/button";

import { logoutAccount } from "../../access/account-access.functions";
import type { CurrentAccount } from "../../account-contract";

export function AuthenticatedLayout({ account }: { account: CurrentAccount }) {
	const logout = useServerFn(logoutAccount);
	const router = useRouter();

	return (
		<>
			<header className="border-b px-8 py-4">
				<nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2">
					<Link className="font-bold" to="/account">
						Good Enough
					</Link>
					<AccountNavLink to="/account/live-console">
						Live console
					</AccountNavLink>
					<AccountNavLink to="/account/api-keys">API keys</AccountNavLink>
					<AccountNavLink to="/account/security">Security</AccountNavLink>
					{account.role === "admin" ? (
						<>
							<AccountNavLink to="/admin/analytics">Analytics</AccountNavLink>
							<AccountNavLink to="/admin/users">Users</AccountNavLink>
						</>
					) : null}
					<span className="ml-auto text-sm text-muted-foreground">
						{account.username}
					</span>
					<Button
						variant="ghost"
						type="button"
						onClick={async () => {
							try {
								await logout();
								await router.navigate({ to: "/", replace: true });
							} catch {
								await router.invalidate();
							}
						}}
					>
						Sign out
					</Button>
				</nav>
			</header>
			<Outlet />
		</>
	);
}

function AccountNavLink({ to, children }: { to: string; children: ReactNode }) {
	return (
		<Link
			className="text-sm text-muted-foreground transition-colors hover:text-foreground [&.active]:font-medium [&.active]:text-foreground"
			to={to}
		>
			{children}
		</Link>
	);
}
