import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, vi } from "vitest";

import { registerMember } from "../access/registration.server.ts";
import { bootstrapAdministrator } from "../access/setup.server.ts";
import { type AccountDatabase, createAccountDatabase } from "../db.server.ts";

export const ADMIN_PASSWORD = "correct horse battery staple";
export const MEMBER_PASSWORD = "member password long enough";
export const BOOTSTRAP_TOKEN = "bootstrap-token-that-is-at-least-32-bytes-long";

export interface AccountTestContext {
	database: AccountDatabase;
	databasePath: string;
	dispose: () => void;
}

export function createAccountTestContext(): AccountTestContext {
	const directory = mkdtempSync(join(tmpdir(), "good-enough-accounts-"));
	const databasePath = join(directory, "accounts.sqlite");
	const database = createAccountDatabase(databasePath);
	vi.stubEnv("ACCOUNT_BOOTSTRAP_TOKEN", BOOTSTRAP_TOKEN);
	vi.stubEnv("ACCOUNT_REGISTRATION_ENABLED", "true");
	return {
		database,
		databasePath,
		dispose: () => {
			database.sqlite.close();
			rmSync(directory, { recursive: true, force: true });
			vi.unstubAllEnvs();
		},
	};
}

export async function createTestAdministrator(
	context: AccountTestContext,
	now = 1_000,
) {
	const result = await bootstrapAdministrator(
		{
			username: "Owner",
			password: ADMIN_PASSWORD,
			bootstrapToken: BOOTSTRAP_TOKEN,
		},
		context.database,
		now,
	);
	expect(result.ok).toBe(true);
	const row = context.database.sqlite
		.prepare(
			"select id, username, role, must_change_password from users where normalized_username = 'owner'",
		)
		.get() as {
		id: string;
		username: string;
		role: "admin";
		must_change_password: number;
	};
	return {
		id: row.id,
		username: row.username,
		role: row.role,
		mustChangePassword: Boolean(row.must_change_password),
	};
}

export async function createTestMember(
	context: AccountTestContext,
	now = 2_000,
) {
	const existingAdmin = context.database.sqlite
		.prepare("select id from users where role = 'admin'")
		.get();
	if (!existingAdmin) {
		await createTestAdministrator(context);
	}
	await registerMember(
		{ username: "Member", password: MEMBER_PASSWORD },
		context.database,
		now,
	);
	const row = context.database.sqlite
		.prepare(
			"select id, username, role, must_change_password from users where normalized_username = 'member'",
		)
		.get() as {
		id: string;
		username: string;
		role: "member";
		must_change_password: number;
	};
	return {
		id: row.id,
		username: row.username,
		role: row.role,
		mustChangePassword: Boolean(row.must_change_password),
	};
}
