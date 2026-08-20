import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { useSubmission } from "#/components/common/use-submission";
import { Button } from "#/components/ui/button";
import { PageLayout } from "#/components/ui/page-layout";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";

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
	const { isSubmitting, busyLabel, error, setError, run } = useSubmission();
	const busyText = (label: string) =>
		isSubmitting && busyLabel === label ? label : null;

	return (
		<PageLayout title="Users">
			{temporaryPassword ? (
				<DisplayOnceSecret
					key={temporaryPassword}
					title="Temporary password"
					description="Share it securely. It expires in 24 hours and cannot be shown again."
					secret={temporaryPassword}
					onDismiss={() => setTemporaryPassword(null)}
				/>
			) : null}
			{error ? (
				<p role="alert" className="mt-4 text-sm text-destructive">
					{error}
				</p>
			) : null}
			<div className="mt-8">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Username</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Password</TableHead>
							<TableHead>
								<span className="sr-only">Actions</span>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{members.map((member) => (
							<TableRow key={member.id}>
								<TableCell>{member.username}</TableCell>
								<TableCell>{member.status}</TableCell>
								<TableCell>
									{member.mustChangePassword ? "temporary" : "set"}
								</TableCell>
								<TableCell className="flex gap-4">
									<Button
										variant="link"
										className="underline"
										type="button"
										disabled={isSubmitting}
										onClick={() =>
											void run(
												"The member could not be updated. Try again.",
												async () => {
													const result = await setDisabled({
														data: {
															memberId: member.id,
															disabled: member.status === "active",
														},
													});
													if (!result.ok) {
														setError(
															"This account can no longer manage members.",
														);
														return;
													}
													await router.invalidate();
												},
												"Updating…",
											)
										}
									>
										{busyText("Updating…") ??
											(member.status === "active" ? "Disable" : "Enable")}
									</Button>
									{member.status === "active" ? (
										<Button
											variant="link"
											className="underline"
											type="button"
											disabled={isSubmitting}
											onClick={() =>
												void run(
													"The temporary password could not be issued. Try again.",
													async () => {
														const result = await issuePassword({
															data: { memberId: member.id },
														});
														if (!result.ok) {
															setError(
																"The temporary password could not be issued. Try again.",
															);
															return;
														}
														setTemporaryPassword(
															result.value.temporaryPassword,
														);
														await router.invalidate();
													},
													"Resetting…",
												)
											}
										>
											{busyText("Resetting…") ?? "Reset password"}
										</Button>
									) : null}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</PageLayout>
	);
}
