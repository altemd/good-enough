import { ClientOnly, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { useSubmission } from "#/components/common/use-submission";
import { Button } from "#/components/ui/button";
import { ApiCredentialOnboarding } from "#/features/client-onboarding/api-credential-onboarding";

import { AccountPageLayout } from "../../ui/account-page-layout";
import {
	createPersonalApiKey,
	revokePersonalApiKey,
} from "../api-key.functions";

export interface PersonalApiKeyView {
	prefix: string;
	createdAt: number;
	expiresAt: number;
	state: "active" | "expired" | "revoked";
}

export function ApiKeysPage({ keys }: { keys: PersonalApiKeyView[] }) {
	const createKey = useServerFn(createPersonalApiKey);
	const revokeKey = useServerFn(revokePersonalApiKey);
	const router = useRouter();
	const [newKey, setNewKey] = useState<string | null>(null);
	const { isSubmitting, busyLabel, error, setError, run } = useSubmission();
	const busyText = (label: string) =>
		isSubmitting && busyLabel === label ? label : null;

	return (
		<AccountPageLayout title="API keys">
			<p className="mt-3">
				Keys expire seven days after creation. Create a replacement before
				updating a client.
			</p>
			<p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
				Inference content is never persisted. Your private live console shows
				request timing only while connected and starts empty after refresh.
			</p>
			<Button
				className="mt-5"
				size="lg"
				type="button"
				disabled={isSubmitting || newKey !== null}
				onClick={() =>
					void run(
						"A key could not be created. Try again.",
						async () => {
							const result = await createKey({ data: {} });
							if (!result.ok) {
								setError(
									"A key could not be created. Revoke an active key if you already have ten.",
								);
								return;
							}
							setNewKey(result.value.apiKey);
							try {
								await router.invalidate();
							} catch {
								setError(
									"The key was created, but the key list could not be refreshed.",
								);
							}
						},
						"Creating…",
					)
				}
			>
				{busyText("Creating…") ?? "Create key"}
			</Button>
			{newKey ? (
				<ApiCredentialOnboarding
					key={newKey}
					apiKey={newKey}
					onDismiss={() => setNewKey(null)}
				/>
			) : null}
			{error ? (
				<p role="alert" className="mt-4 text-destructive">
					{error}
				</p>
			) : null}
			<div className="mt-8 overflow-x-auto">
				<table className="w-full text-left">
					<thead>
						<tr>
							<th>Prefix</th>
							<th>Created</th>
							<th>Expires</th>
							<th>State</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{keys.map((key) => (
							<tr className="border-t" key={key.prefix}>
								<td className="py-3 font-mono">{key.prefix}</td>
								<td>
									<LocalDateTime value={key.createdAt} />
								</td>
								<td>
									<LocalDateTime value={key.expiresAt} />
								</td>
								<td>{key.state}</td>
								<td>
									{key.state === "active" ? (
										<Button
											variant="link"
											className="underline"
											type="button"
											disabled={isSubmitting}
											onClick={() =>
												void run(
													"The key could not be revoked. Try again.",
													async () => {
														const result = await revokeKey({
															data: { prefix: key.prefix },
														});
														if (!result.ok) {
															setError(
																"The key could not be revoked. Try again.",
															);
															return;
														}
														await router.invalidate();
													},
													"Revoking…",
												)
											}
										>
											{busyText("Revoking…") ?? "Revoke"}
										</Button>
									) : null}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</AccountPageLayout>
	);
}

function LocalDateTime({ value }: { value: number }) {
	const instant = new Date(value);
	const dateTime = instant.toISOString();
	return (
		<ClientOnly
			fallback={<time dateTime={dateTime}>{formatUtcDateTime(dateTime)}</time>}
		>
			<time dateTime={dateTime}>{formatLocalDateTime(instant)}</time>
		</ClientOnly>
	);
}

function formatUtcDateTime(isoDate: string) {
	return `${isoDate.slice(0, 10)} ${isoDate.slice(11, 16)} UTC`;
}

function formatLocalDateTime(value: Date) {
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(value);
}
