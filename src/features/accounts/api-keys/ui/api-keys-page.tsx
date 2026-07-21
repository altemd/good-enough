import { ClientOnly, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { AccountPageLayout } from "../../ui/account-page-layout";
import { DisplayOnceSecret } from "../../ui/display-once-secret";
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
	const [error, setError] = useState<string | null>(null);

	return (
		<AccountPageLayout title="API keys">
			<p className="mt-3">
				Keys expire seven days after creation. Create a replacement before
				updating a client.
			</p>
			<button
				className="mt-5 rounded bg-black px-4 py-2 text-white"
				type="button"
				onClick={async () => {
					setError(null);
					const result = await createKey({ data: {} });
					if (!result.ok) {
						setError(
							"A key could not be created. Revoke an active key if you already have ten.",
						);
						return;
					}
					setNewKey(result.value.apiKey);
					await router.invalidate();
				}}
			>
				Create key
			</button>
			{newKey ? (
				<DisplayOnceSecret
					key={newKey}
					title="Copy this key now"
					description="It cannot be shown again."
					secret={newKey}
					onDismiss={() => setNewKey(null)}
				/>
			) : null}
			{error ? <p className="mt-4 text-red-700">{error}</p> : null}
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
										<button
											className="underline"
											type="button"
											onClick={async () => {
												await revokeKey({ data: { prefix: key.prefix } });
												await router.invalidate();
											}}
										>
											Revoke
										</button>
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
