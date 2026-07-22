import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import type { AccountMutationResult } from "../account-contract.ts";
import { readRegistrationEnabled } from "../config.server.ts";
import { type AccountDatabase, getAccountDatabase } from "../db.server.ts";
import { consumeRateLimit } from "../rate-limit.server.ts";
import { users } from "../schema.ts";
import { createBrowserSession } from "../sessions/sessions.server.ts";
import { hashPassword, isValidPassword } from "./password.server.ts";
import { normalizeUsername } from "./username-policy.ts";

export async function registerMember(
	input: { username: string; password: string },
	database: AccountDatabase = getAccountDatabase(),
	now = Date.now(),
): Promise<AccountMutationResult<{ token: string; expiresAt: number }>> {
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
				const userId = randomUUID();
				transaction
					.insert(users)
					.values({
						id: userId,
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
				return {
					ok: true,
					value: createBrowserSession(userId, false, now, {
						db: transaction,
					}),
				} as const;
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

function isNormalizedUsernameConflict(error: unknown): boolean {
	return (
		error instanceof Error &&
		error.message.includes(
			"UNIQUE constraint failed: users.normalized_username",
		)
	);
}
