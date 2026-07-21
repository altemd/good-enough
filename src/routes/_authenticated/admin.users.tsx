import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import {
	getMembers,
	issueMemberTemporaryPassword,
	setMemberDisabled,
} from "#/features/accounts/member-administration.functions";

export const Route = createFileRoute("/_authenticated/admin/users")({
	loader: async () => {
		const members = await getMembers();
		if (!members) throw redirect({ to: "/account" });
		return members;
	},
	component: UsersPage,
});

function UsersPage() {
	const members = Route.useLoaderData();
	const setDisabled = useServerFn(setMemberDisabled);
	const issuePassword = useServerFn(issueMemberTemporaryPassword);
	const router = useRouter();
	const [temporaryPassword, setTemporaryPassword] = useState<string | null>(
		null,
	);
	return (
		<main className="mx-auto max-w-5xl p-8">
			<h1 className="text-3xl font-bold">Users</h1>
			{temporaryPassword ? (
				<section className="mt-5 rounded border border-amber-500 bg-amber-50 p-4">
					<h2 className="font-bold">Temporary password</h2>
					<p>
						Share it securely. It expires in 24 hours and cannot be shown again.
					</p>
					<code className="my-3 block break-all">{temporaryPassword}</code>
					<button
						className="underline"
						type="button"
						onClick={() => navigator.clipboard.writeText(temporaryPassword)}
					>
						Copy
					</button>
					<button
						className="ml-5 underline"
						type="button"
						onClick={() => setTemporaryPassword(null)}
					>
						Dismiss
					</button>
				</section>
			) : null}
			<table className="mt-8 w-full text-left">
				<thead>
					<tr>
						<th>Username</th>
						<th>Status</th>
						<th>Password</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{members.map((member) => (
						<tr className="border-t" key={member.id}>
							<td className="py-3">{member.username}</td>
							<td>{member.status}</td>
							<td>{member.mustChangePassword ? "temporary" : "set"}</td>
							<td className="flex gap-4 py-3">
								<button
									className="underline"
									type="button"
									onClick={async () => {
										await setDisabled({
											data: {
												memberId: member.id,
												disabled: member.status === "active",
											},
										});
										await router.invalidate();
									}}
								>
									{member.status === "active" ? "Disable" : "Enable"}
								</button>
								{member.status === "active" ? (
									<button
										className="underline"
										type="button"
										onClick={async () => {
											const result = await issuePassword({
												data: { memberId: member.id },
											});
											if (result.ok)
												setTemporaryPassword(result.value.temporaryPassword);
											await router.invalidate();
										}}
									>
										Reset password
									</button>
								) : null}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</main>
	);
}
