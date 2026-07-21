import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/account")({
	component: AccountPage,
});

function AccountPage() {
	const { account } = Route.useRouteContext();
	return (
		<main className="mx-auto max-w-5xl p-8">
			<h1 className="text-3xl font-bold">Account</h1>
			<dl className="mt-6 grid max-w-lg grid-cols-2 gap-3">
				<dt>Username</dt>
				<dd>{account.username}</dd>
				<dt>Role</dt>
				<dd>{account.role}</dd>
			</dl>
			<p className="mt-8 text-slate-700">
				Inference content and per-user inference activity are not persisted.
			</p>
		</main>
	);
}
