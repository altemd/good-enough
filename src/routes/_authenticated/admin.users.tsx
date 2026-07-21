import { createFileRoute, redirect } from "@tanstack/react-router";

import { getMembers } from "#/features/accounts/administration/member-administration.functions";
import { MemberAdministrationPage } from "#/features/accounts/administration/ui/member-administration-page";

export const Route = createFileRoute("/_authenticated/admin/users")({
	loader: async () => {
		const members = await getMembers();
		if (!members) throw redirect({ to: "/account" });
		return members;
	},
	component: UsersRoute,
});

function UsersRoute() {
	return <MemberAdministrationPage members={Route.useLoaderData()} />;
}
