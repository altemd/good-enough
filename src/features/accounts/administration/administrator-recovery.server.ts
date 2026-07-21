import "@tanstack/react-start/server-only";

import { and, eq } from "drizzle-orm";
import { normalizeUsername } from "../access/username-policy.ts";
import { type AccountDatabase, getAccountDatabase } from "../db.server.ts";
import { users } from "../schema.ts";
import { deleteUserSessions } from "../sessions/sessions.server.ts";
import { createTemporaryPassword } from "./temporary-password.server.ts";

export async function resetAdministratorPasswordFromHost(
	username: string,
	database: AccountDatabase = getAccountDatabase(),
	now = Date.now(),
) {
	const normalized = normalizeUsername(username);
	if (!normalized) return null;

	const administrator = database.db
		.select({ id: users.id })
		.from(users)
		.where(
			and(
				eq(users.normalizedUsername, normalized.normalizedUsername),
				eq(users.role, "admin"),
			),
		)
		.get();
	if (!administrator) return null;

	const temporary = await createTemporaryPassword(now);
	database.db.transaction(
		(transaction) => {
			transaction
				.update(users)
				.set({
					passwordHash: temporary.passwordHash,
					mustChangePassword: true,
					temporaryPasswordExpiresAt: temporary.expiresAt,
					passwordChangedAt: now,
					updatedAt: now,
				})
				.where(eq(users.id, administrator.id))
				.run();
			deleteUserSessions(administrator.id, { db: transaction });
		},
		{ behavior: "immediate" },
	);

	return {
		temporaryPassword: temporary.temporaryPassword,
		expiresAt: temporary.expiresAt,
	};
}
