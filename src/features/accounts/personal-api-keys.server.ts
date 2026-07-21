import "@tanstack/react-start/server-only";

import { and, asc, count, eq, gt, isNull } from "drizzle-orm";

import type {
	AccountMutationResult,
	CurrentAccount,
} from "./account-contract.ts";
import {
	createPersonalApiKeyMaterial,
	parsePersonalApiKeyPrefix,
} from "./credential-secrets.server.ts";
import { type AccountDatabase, getAccountDatabase } from "./db.server.ts";
import { apiKeys } from "./schema.ts";

const API_KEY_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ACTIVE_API_KEYS = 10;

export function createPersonalApiKey(
	account: CurrentAccount,
	database: AccountDatabase = getAccountDatabase(),
	now = Date.now(),
): AccountMutationResult<{
	apiKey: string;
	prefix: string;
	createdAt: number;
	expiresAt: number;
}> {
	if (account.mustChangePassword) {
		return { ok: false, code: "forbidden" };
	}
	return database.db.transaction(
		(transaction) => {
			const { value: activeCount } = transaction
				.select({ value: count() })
				.from(apiKeys)
				.where(
					and(
						eq(apiKeys.kind, "personal"),
						eq(apiKeys.userId, account.id),
						isNull(apiKeys.revokedAt),
						gt(apiKeys.expiresAt, now),
					),
				)
				.get() as { value: number };
			if (activeCount >= MAX_ACTIVE_API_KEYS) {
				return { ok: false, code: "forbidden" } as const;
			}
			const key = createPersonalApiKeyMaterial();
			const expiresAt = now + API_KEY_LIFETIME_MS;
			transaction
				.insert(apiKeys)
				.values({
					selector: key.selector,
					kind: "personal",
					userId: account.id,
					prefix: key.prefix,
					secretDigest: key.secretDigest,
					createdAt: now,
					expiresAt,
				})
				.run();
			return {
				ok: true,
				value: {
					apiKey: key.apiKey,
					prefix: key.prefix,
					createdAt: now,
					expiresAt,
				},
			} as const;
		},
		{ behavior: "immediate" },
	);
}

export function listPersonalApiKeys(
	account: CurrentAccount,
	database: AccountDatabase = getAccountDatabase(),
	now = Date.now(),
) {
	if (account.mustChangePassword) {
		return null;
	}
	return database.db
		.select({
			prefix: apiKeys.prefix,
			createdAt: apiKeys.createdAt,
			expiresAt: apiKeys.expiresAt,
			revokedAt: apiKeys.revokedAt,
		})
		.from(apiKeys)
		.where(and(eq(apiKeys.kind, "personal"), eq(apiKeys.userId, account.id)))
		.orderBy(asc(apiKeys.createdAt))
		.all()
		.map((key) => ({
			prefix: key.prefix,
			createdAt: key.createdAt,
			expiresAt: key.expiresAt,
			state:
				key.revokedAt !== null
					? ("revoked" as const)
					: key.expiresAt <= now
						? ("expired" as const)
						: ("active" as const),
		}));
}

export function revokePersonalApiKey(
	account: CurrentAccount,
	prefix: string,
	database: AccountDatabase = getAccountDatabase(),
	now = Date.now(),
): AccountMutationResult {
	const selector = parsePersonalApiKeyPrefix(prefix);
	if (account.mustChangePassword || !selector) {
		return { ok: false, code: "forbidden" };
	}
	return database.db.transaction(
		(transaction) => {
			transaction
				.update(apiKeys)
				.set({ revokedAt: now })
				.where(
					and(
						eq(apiKeys.kind, "personal"),
						eq(apiKeys.selector, selector),
						eq(apiKeys.userId, account.id),
						isNull(apiKeys.revokedAt),
					),
				)
				.run();
			return { ok: true, value: {} } as const;
		},
		{ behavior: "immediate" },
	);
}
