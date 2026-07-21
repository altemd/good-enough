import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";

import type {
	AccountMutationResult,
	CurrentAccount,
} from "./account-contract.ts";
import {
	readBootstrapToken,
	readRegistrationEnabled,
} from "./config.server.ts";
import { credentialSecretsEqual } from "./credential-secrets.server.ts";
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

export async function registerMember(
	input: { username: string; password: string },
	database: AccountDatabase = getAccountDatabase(),
	now = Date.now(),
): Promise<AccountMutationResult> {
	const globalLimit = consumeRateLimit(
		"registration:global",
		10,
		10 * 60 * 1000,
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
	if (!normalized || !isValidPassword(input.password)) {
		return { ok: false, code: "invalid_input" };
	}
	const userLimit = consumeRateLimit(
		`registration:${normalized.normalizedUsername}`,
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
	try {
		if (!readRegistrationEnabled()) {
			return { ok: false, code: "registration_closed" };
		}
	} catch {
		return { ok: false, code: "configuration_error" };
	}

	const passwordHash = await hashPassword(input.password);
	try {
		return database.db.transaction(
			(transaction) => {
				const administrator = transaction
					.select({ id: users.id })
					.from(users)
					.where(eq(users.role, "admin"))
					.get();
				if (!administrator) {
					return { ok: false, code: "setup_required" } as const;
				}
				const duplicate = transaction
					.select({ id: users.id })
					.from(users)
					.where(eq(users.normalizedUsername, normalized.normalizedUsername))
					.get();
				if (duplicate) {
					return { ok: false, code: "username_unavailable" } as const;
				}
				transaction
					.insert(users)
					.values({
						id: randomUUID(),
						...normalized,
						passwordHash,
						role: "member",
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
	} catch (error) {
		return {
			ok: false,
			code: isNormalizedUsernameConflict(error)
				? "username_unavailable"
				: "configuration_error",
		};
	}
}

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

function isNormalizedUsernameConflict(error: unknown): boolean {
	return (
		error instanceof Error &&
		error.message.includes(
			"UNIQUE constraint failed: users.normalized_username",
		)
	);
}
