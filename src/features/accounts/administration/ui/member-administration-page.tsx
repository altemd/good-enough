import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { Button } from "#/components/ui/button";

import { AccountPageLayout } from "../../ui/account-page-layout";
import { DisplayOnceSecret } from "../../ui/display-once-secret";
import {
	issueMemberTemporaryPassword,
	setMemberDisabled,
} from "../member-administration.functions";

export interface MemberView {
	id: string;
	username: string;
	status: "active" | "disabled";
	mustChangePassword: boolean;
}

export function MemberAdministrationPage({
	members,
}: {
	members: MemberView[];
}) {
	const setDisabled = useServerFn(setMemberDisabled);
	const issuePassword = useServerFn(issueMemberTemporaryPassword);
	const router = useRouter();
	const [temporaryPassword, setTemporaryPassword] = useState<string | null>(
		null,
	);

	return (
		<AccountPageLayout title="Users">
			{temporaryPassword ? (
				<DisplayOnceSecret
					key={temporaryPassword}
					title="Temporary password"
					description="Share it securely. It expires in 24 hours and cannot be shown again."
					secret={temporaryPassword}
					onDismiss={() => setTemporaryPassword(null)}
				/>
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
								<Button
									variant="link"
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
								</Button>
								{member.status === "active" ? (
									<Button
										variant="link"
										className="underline"
										type="button"
										onClick={async () => {
											const result = await issuePassword({
												data: { memberId: member.id },
											});
											if (result.ok) {
												setTemporaryPassword(result.value.temporaryPassword);
											}
											await router.invalidate();
										}}
									>
										Reset password
									</Button>
								) : null}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</AccountPageLayout>
	);
}
