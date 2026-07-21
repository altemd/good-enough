import "@tanstack/react-start/server-only";

import { eq } from "drizzle-orm";

import type {
	AccountMutationResult,
	CurrentAccount,
} from "./account-contract.ts";
import { type AccountDatabase, getAccountDatabase } from "./db.server.ts";
import {
	hashPassword,
	isValidPassword,
	verifyLoginPassword,
	verifyPassword,
} from "./password.server.ts";
import { clearRateLimit, consumeRateLimit } from "./rate-limit.server.ts";
import { users } from "./schema.ts";
import { createBrowserSession, deleteUserSessions } from "./sessions.server.ts";
import { normalizeUsername } from "./username-policy.ts";

export async function login(
	input: { username: string; password: string },
	database: AccountDatabase = getAccountDatabase(),
	now = Date.now(),
): Promise<
	AccountMutationResult<{
		token: string;
		expiresAt: number;
		restricted: boolean;
	}>
> {
	const globalLimit = consumeRateLimit(
		"login:global",
		100,
		15 * 60 * 1000,
		now,
	);
	if (!globalLimit.allowed) {
		return {
			ok: false,
			code: "rate_limited",
			retryAfterSeconds: globalLimit.retryAfterSeconds,
		};
	}
	const normalized = normalizeUsername(input.username);
	const normalizedKey = normalized?.normalizedUsername ?? "invalid";
	const userLimit = consumeRateLimit(
		`login:${normalizedKey}`,
		5,
		15 * 60 * 1000,
		now,
	);
	if (!userLimit.allowed) {
		return {
			ok: false,
			code: "rate_limited",
			retryAfterSeconds: userLimit.retryAfterSeconds,
		};
	}

	const user = normalized
		? database.db
				.select()
				.from(users)
				.where(eq(users.normalizedUsername, normalized.normalizedUsername))
				.get()
		: undefined;
	const passwordInputValid = isValidPassword(input.password);
	const passwordMatches = await verifyLoginPassword(
		user?.passwordHash,
		input.password,
	);
	const temporaryPasswordValid =
		!user?.mustChangePassword ||
		(user.temporaryPasswordExpiresAt !== null &&
			user.temporaryPasswordExpiresAt > now);
	if (
		!user ||
		!passwordInputValid ||
		!passwordMatches ||
		!temporaryPasswordValid ||
		user.status !== "active"
	) {
		return { ok: false, code: "invalid_credentials" };
	}

	clearRateLimit(`login:${normalizedKey}`);
	const session = database.db.transaction(
		(transaction) =>
			createBrowserSession(user.id, user.mustChangePassword, now, {
				db: transaction,
			}),
		{ behavior: "immediate" },
	);
	return {
		ok: true,
		value: { ...session, restricted: user.mustChangePassword },
	};
}

export async function changePassword(
	account: CurrentAccount,
	input: { currentPassword: string; newPassword: string },
	database: AccountDatabase = getAccountDatabase(),
	now = Date.now(),
): Promise<AccountMutationResult<{ token: string; expiresAt: number }>> {
	if (!isValidPassword(input.newPassword)) {
		return { ok: false, code: "invalid_input" };
	}
	const user = database.db
		.select()
		.from(users)
		.where(eq(users.id, account.id))
		.get();
	if (
		!user ||
		!(await verifyPassword(user.passwordHash, input.currentPassword))
	) {
		return { ok: false, code: "invalid_credentials" };
	}
	const passwordHash = await hashPassword(input.newPassword);
	return database.db.transaction(
		(transaction) => {
			transaction
				.update(users)
				.set({
					passwordHash,
					mustChangePassword: false,
					temporaryPasswordExpiresAt: null,
					passwordChangedAt: now,
					updatedAt: now,
				})
				.where(eq(users.id, account.id))
				.run();
			deleteUserSessions(account.id, { db: transaction });
			return {
				ok: true,
				value: createBrowserSession(account.id, false, now, {
					db: transaction,
				}),
			} as const;
		},
		{ behavior: "immediate" },
	);
}
