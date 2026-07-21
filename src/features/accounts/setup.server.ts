import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { count } from "drizzle-orm";

import type { AccountMutationResult } from "./account-contract.ts";
import { readBootstrapToken } from "./config.server.ts";
import { credentialSecretsEqual } from "./credential-secrets.server.ts";
import { type AccountDatabase, getAccountDatabase } from "./db.server.ts";
import { hashPassword, isValidPassword } from "./password.server.ts";
import { users } from "./schema.ts";
import { normalizeUsername } from "./username-policy.ts";

export function getSetupState(
	database: AccountDatabase = getAccountDatabase(),
) {
	const { value: userCount } = database.db
		.select({ value: count() })
		.from(users)
		.get() as { value: number };
	return { setupRequired: userCount === 0 };
}

export async function bootstrapAdministrator(
	input: {
		username: string;
		password: string;
		bootstrapToken: string;
	},
	database: AccountDatabase = getAccountDatabase(),
	now = Date.now(),
): Promise<AccountMutationResult> {
	const normalized = normalizeUsername(input.username);
	if (!normalized || !isValidPassword(input.password)) {
		return { ok: false, code: "invalid_input" };
	}

	let configuredToken: string | null;
	try {
		configuredToken = readBootstrapToken();
	} catch {
		return { ok: false, code: "configuration_error" };
	}
	if (!configuredToken) {
		return { ok: false, code: "configuration_error" };
	}
	if (!credentialSecretsEqual(configuredToken, input.bootstrapToken)) {
		return { ok: false, code: "forbidden" };
	}

	const passwordHash = await hashPassword(input.password);
	try {
		return database.db.transaction(
			(transaction) => {
				const { value: existing } = transaction
					.select({ value: count() })
					.from(users)
					.get() as { value: number };
				if (existing !== 0) {
					return { ok: false, code: "setup_complete" } as const;
				}
				transaction
					.insert(users)
					.values({
						id: randomUUID(),
						...normalized,
						passwordHash,
						role: "admin",
						status: "active",
						mustChangePassword: false,
						createdAt: now,
						updatedAt: now,
						passwordChangedAt: now,
					})
					.run();
				return { ok: true, value: {} } as const;
			},
			{ behavior: "immediate" },
		);
	} catch {
		return { ok: false, code: "configuration_error" };
	}
}
