import "@tanstack/react-start/server-only";

import { and, asc, eq, gt, isNull, ne } from "drizzle-orm";

import type {
	AccountMutationResult,
	CurrentAccount,
} from "./account-contract.ts";
import {
	type AccountDatabase,
	getAccountDatabase,
	runImmediateAccountTransaction,
} from "./db.server.ts";
import { apiKeys, sessions, users } from "./schema.ts";
import { deleteUserSessions } from "./sessions.server.ts";
import { createTemporaryPassword } from "./temporary-password.server.ts";

export function listMembers(
	account: CurrentAccount,
	database: AccountDatabase = getAccountDatabase(),
) {
	if (account.role !== "admin" || account.mustChangePassword) {
		return null;
	}
	return database.db
		.select({
			id: users.id,
			username: users.username,
			status: users.status,
			mustChangePassword: users.mustChangePassword,
			createdAt: users.createdAt,
		})
		.from(users)
		.where(eq(users.role, "member"))
		.orderBy(asc(users.createdAt))
		.all();
}

export function setMemberDisabled(
	account: CurrentAccount,
	memberId: string,
	disabled: boolean,
	database: AccountDatabase = getAccountDatabase(),
	now = Date.now(),
): AccountMutationResult {
	if (account.role !== "admin" || account.mustChangePassword) {
		return { ok: false, code: "forbidden" };
	}
	return runImmediateAccountTransaction(database.sqlite, () => {
		const member = database.db
			.select({ id: users.id })
			.from(users)
			.where(and(eq(users.id, memberId), eq(users.role, "member")))
			.get();
		if (!member) return { ok: false, code: "forbidden" } as const;
		database.db
			.update(users)
			.set({ status: disabled ? "disabled" : "active", updatedAt: now })
			.where(eq(users.id, memberId))
			.run();
		if (disabled) {
			database.db.delete(sessions).where(eq(sessions.userId, memberId)).run();
			database.db
				.update(apiKeys)
				.set({ revokedAt: now })
				.where(
					and(
						eq(apiKeys.userId, memberId),
						isNull(apiKeys.revokedAt),
						gt(apiKeys.expiresAt, now),
					),
				)
				.run();
		}
		return { ok: true, value: {} } as const;
	});
}

export async function issueTemporaryPassword(
	account: CurrentAccount,
	memberId: string,
	database: AccountDatabase = getAccountDatabase(),
	now = Date.now(),
): Promise<
	AccountMutationResult<{ temporaryPassword: string; expiresAt: number }>
> {
	if (account.role !== "admin" || account.mustChangePassword) {
		return { ok: false, code: "forbidden" };
	}
	const member = database.db
		.select({ id: users.id })
		.from(users)
		.where(
			and(
				eq(users.id, memberId),
				eq(users.role, "member"),
				ne(users.status, "disabled"),
			),
		)
		.get();
	if (!member) return { ok: false, code: "forbidden" };
	const { temporaryPassword, passwordHash, expiresAt } =
		await createTemporaryPassword(now);
	return runImmediateAccountTransaction(database.sqlite, () => {
		database.db
			.update(users)
			.set({
				passwordHash,
				mustChangePassword: true,
				temporaryPasswordExpiresAt: expiresAt,
				passwordChangedAt: now,
				updatedAt: now,
			})
			.where(eq(users.id, memberId))
			.run();
		deleteUserSessions(memberId, database);
		return { ok: true, value: { temporaryPassword, expiresAt } } as const;
	});
}
