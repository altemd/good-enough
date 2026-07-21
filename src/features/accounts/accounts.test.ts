import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { login } from "./authentication.server.ts";
import { type AccountDatabase, createAccountDatabase } from "./db.server.ts";
import { authenticateInferenceApiKey } from "./inference-api-key-authentication.server.ts";
import {
	issueTemporaryPassword,
	setMemberDisabled,
} from "./member-administration.server.ts";
import {
	hashPassword,
	verifyLoginPassword,
	verifyPassword,
} from "./password.server.ts";
import {
	createPersonalApiKey,
	listPersonalApiKeys,
	revokePersonalApiKey,
} from "./personal-api-keys.server.ts";
import { registerMember } from "./registration.server.ts";
import {
	createBrowserSession,
	getSessionCookiePolicy,
	readBrowserSession,
} from "./sessions.server.ts";
import { bootstrapAdministrator } from "./setup.server.ts";
import { normalizeUsername } from "./username-policy.ts";

const ADMIN_PASSWORD = "correct horse battery staple";
const MEMBER_PASSWORD = "member password long enough";
const BOOTSTRAP_TOKEN = "bootstrap-token-that-is-at-least-32-bytes-long";

let directory: string;
let databasePath: string;
let database: AccountDatabase;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "good-enough-accounts-"));
	databasePath = join(directory, "accounts.sqlite");
	database = createAccountDatabase(databasePath);
	vi.stubEnv("ACCOUNT_BOOTSTRAP_TOKEN", BOOTSTRAP_TOKEN);
	vi.stubEnv("ACCOUNT_REGISTRATION_ENABLED", "true");
});

afterEach(() => {
	database.sqlite.close();
	rmSync(directory, { recursive: true, force: true });
	vi.unstubAllEnvs();
});

describe("account lifecycle", () => {
	it("fails bootstrap closed when the trusted token is missing", async () => {
		vi.stubEnv("ACCOUNT_BOOTSTRAP_TOKEN", "");
		expect(
			await bootstrapAdministrator(
				{
					username: "Owner",
					password: ADMIN_PASSWORD,
					bootstrapToken: BOOTSTRAP_TOKEN,
				},
				database,
				1_000,
			),
		).toEqual({ ok: false, code: "configuration_error" });
		expect(
			database.sqlite.prepare("select count(*) as count from users").get(),
		).toEqual({ count: 0 });
	});

	it("bootstraps one administrator and registers only members", async () => {
		expect(
			await bootstrapAdministrator(
				{
					username: "Owner",
					password: ADMIN_PASSWORD,
					bootstrapToken: BOOTSTRAP_TOKEN,
				},
				database,
				1_000,
			),
		).toEqual({ ok: true, value: {} });
		expect(
			await bootstrapAdministrator(
				{
					username: "SecondAdmin",
					password: ADMIN_PASSWORD,
					bootstrapToken: BOOTSTRAP_TOKEN,
				},
				database,
				2_000,
			),
		).toEqual({ ok: false, code: "setup_complete" });

		expect(
			await registerMember(
				{ username: "Member", password: MEMBER_PASSWORD },
				database,
				3_000,
			),
		).toEqual({ ok: true, value: {} });
		expect(
			await registerMember(
				{ username: "member", password: MEMBER_PASSWORD },
				database,
				4_000,
			),
		).toEqual({ ok: false, code: "username_unavailable" });

		const roles = database.sqlite
			.prepare("select username, role from users order by created_at")
			.all();
		expect(roles).toEqual([
			{ username: "Owner", role: "admin" },
			{ username: "Member", role: "member" },
		]);
	}, 30_000);

	it("creates digest-only keys with an absolute seven-day boundary", async () => {
		const account = await createMember();
		const createdAt = 10_000;
		const created = createPersonalApiKey(account, database, createdAt);
		expect(created.ok).toBe(true);
		if (!created.ok) return;

		expect(created.value.expiresAt - created.value.createdAt).toBe(
			7 * 24 * 60 * 60 * 1000,
		);
		const stored = database.sqlite
			.prepare(
				"select prefix, secret_digest, created_at, expires_at from api_keys",
			)
			.get() as {
			prefix: string;
			secret_digest: Uint8Array;
			created_at: number;
			expires_at: number;
		};
		expect(stored.prefix).toBe(created.value.prefix);
		expect(Buffer.from(stored.secret_digest)).toHaveLength(32);
		expect(JSON.stringify(stored)).not.toContain(created.value.apiKey);

		expect(
			authenticateInferenceApiKey(
				created.value.apiKey,
				database,
				created.value.expiresAt - 1,
			),
		).toEqual({ status: "authenticated", principalId: account.id });
		expect(
			authenticateInferenceApiKey(
				created.value.apiKey,
				database,
				created.value.expiresAt,
			),
		).toEqual({ status: "rejected" });
		const expiredKeys = listPersonalApiKeys(
			account,
			database,
			created.value.expiresAt,
		);
		expect(expiredKeys).not.toBeNull();
		if (!expiredKeys) return;
		expect(expiredKeys[0]).toMatchObject({ state: "expired" });
		expect(Object.keys(expiredKeys[0] ?? {}).sort()).toEqual([
			"createdAt",
			"expiresAt",
			"prefix",
			"state",
		]);

		expect(
			revokePersonalApiKey(
				account,
				created.value.prefix,
				database,
				created.value.expiresAt + 1,
			),
		).toEqual({ ok: true, value: {} });
		const revokedKeys = listPersonalApiKeys(
			account,
			database,
			created.value.expiresAt + 1,
		);
		expect(revokedKeys?.[0]).toMatchObject({ state: "revoked" });

		const replacementTime = created.value.expiresAt + 2;
		const replacementKeys = Array.from({ length: 10 }, () =>
			createPersonalApiKey(account, database, replacementTime),
		);
		expect(replacementKeys.every((result) => result.ok)).toBe(true);
		expect(createPersonalApiKey(account, database, replacementTime)).toEqual({
			ok: false,
			code: "forbidden",
		});
		expect(
			createPersonalApiKey(
				account,
				database,
				replacementTime + 7 * 24 * 60 * 60 * 1000,
			).ok,
		).toBe(true);
	}, 30_000);

	it("uses restricted temporary-password sessions and disables access atomically", async () => {
		const administrator = await createAdministrator();
		const member = await createMember();
		const key = createPersonalApiKey(member, database, 20_000);
		expect(key.ok).toBe(true);
		if (!key.ok) return;
		const normalLogin = await login(
			{ username: member.username, password: MEMBER_PASSWORD },
			database,
			20_001,
		);
		expect(normalLogin.ok).toBe(true);
		if (!normalLogin.ok) return;
		const storedSession = database.sqlite
			.prepare("select token_digest from sessions")
			.get() as { token_digest: Uint8Array };
		expect(Buffer.from(storedSession.token_digest)).toHaveLength(32);
		expect(JSON.stringify(storedSession)).not.toContain(
			normalLogin.value.token,
		);
		expect(getSessionCookiePolicy()).toEqual({
			name: "ge_session_dev",
			secure: false,
		});

		const reset = await issueTemporaryPassword(
			administrator,
			member.id,
			database,
			30_000,
		);
		expect(reset.ok).toBe(true);
		if (!reset.ok) return;
		expect(reset.value.expiresAt).toBe(30_000 + 24 * 60 * 60 * 1000);
		const signedIn = await login(
			{ username: member.username, password: reset.value.temporaryPassword },
			database,
			30_001,
		);
		expect(signedIn.ok).toBe(true);
		if (!signedIn.ok) return;
		expect(signedIn.value.restricted).toBe(true);
		expect(
			readBrowserSession(signedIn.value.token, 30_002, database)?.restricted,
		).toBe(true);

		expect(
			setMemberDisabled(administrator, member.id, true, database, 40_000),
		).toEqual({ ok: true, value: {} });
		expect(
			readBrowserSession(signedIn.value.token, 40_001, database),
		).toBeNull();
		expect(
			authenticateInferenceApiKey(key.value.apiKey, database, 40_001),
		).toEqual({ status: "rejected" });
	}, 30_000);

	it("retains exactly the ten newest active browser sessions", async () => {
		const member = await createMember();
		const oldest = createBrowserSession(member.id, false, 50_000, database);
		const secondOldest = createBrowserSession(
			member.id,
			false,
			50_001,
			database,
		);
		for (let index = 2; index < 11; index += 1) {
			createBrowserSession(member.id, false, 50_000 + index, database);
		}
		expect(
			database.sqlite.prepare("select count(*) as count from sessions").get(),
		).toEqual({ count: 10 });
		expect(readBrowserSession(oldest.token, 60_000, database)).toBeNull();
		expect(
			readBrowserSession(secondOldest.token, 60_000, database),
		).not.toBeNull();
	}, 30_000);

	it("does not misclassify unrelated registration failures as duplicates", async () => {
		await createAdministrator();
		database.sqlite.exec(`
			create trigger fail_member_registration
			before insert on users
			when NEW.role = 'member'
			begin
				select raise(ABORT, 'synthetic registration storage failure');
			end
		`);
		expect(
			await registerMember(
				{ username: "AnotherMember", password: MEMBER_PASSWORD },
				database,
				70_000,
			),
		).toEqual({ ok: false, code: "configuration_error" });
	}, 30_000);

	it("applies committed migrations and SQLite safety pragmas", () => {
		expect(database.sqlite.prepare("pragma foreign_keys").get()).toEqual({
			foreign_keys: 1,
		});
		expect(database.sqlite.prepare("pragma journal_mode").get()).toEqual({
			journal_mode: "wal",
		});
		expect(database.sqlite.prepare("pragma busy_timeout").get()).toEqual({
			timeout: 5_000,
		});
		expect(database.sqlite.prepare("pragma synchronous").get()).toEqual({
			synchronous: 1,
		});
		expect(
			database.sqlite
				.prepare("select count(*) as count from __drizzle_migrations")
				.get(),
		).toEqual({ count: 2 });
	});

	it("rolls back a failed immediate account transaction", () => {
		database.sqlite.exec(
			"create table transaction_probe (value text not null)",
		);
		expect(() =>
			database.db.transaction(
				(transaction) => {
					transaction.run(
						sql`insert into transaction_probe (value) values ('uncommitted')`,
					);
					throw new Error("synthetic transaction failure");
				},
				{ behavior: "immediate" },
			),
		).toThrow("synthetic transaction failure");
		expect(
			database.sqlite
				.prepare("select count(*) as count from transaction_probe")
				.get(),
		).toEqual({ count: 0 });
	});

	it("resets the sole administrator from the host without revoking API keys", async () => {
		const administrator = await createAdministrator();
		const key = createPersonalApiKey(administrator, database, Date.now());
		expect(key.ok).toBe(true);
		if (!key.ok) return;
		const signedIn = await login(
			{ username: administrator.username, password: ADMIN_PASSWORD },
			database,
		);
		expect(signedIn.ok).toBe(true);

		const output = execFileSync(
			process.execPath,
			[join(process.cwd(), "scripts/reset-admin-password.mjs"), "OWNER"],
			{
				encoding: "utf8",
				env: { ...process.env, GOOD_ENOUGH_DATABASE_PATH: databasePath },
			},
		);
		const outputLines = output.trim().split("\n");
		expect(outputLines[0]).toBe(
			"Temporary administrator password (shown once):",
		);
		expect(outputLines[1]).toMatch(/^[A-Za-z0-9_-]{32}$/u);
		expect(outputLines[2]).toMatch(/^Expires at: /u);

		const stored = database.sqlite
			.prepare(
				"select password_hash, must_change_password from users where id = ?",
			)
			.get(administrator.id) as {
			password_hash: string;
			must_change_password: number;
		};
		expect(stored.must_change_password).toBe(1);
		expect(
			await verifyPassword(stored.password_hash, outputLines[1] ?? ""),
		).toBe(true);
		expect(
			database.sqlite.prepare("select count(*) as count from sessions").get(),
		).toEqual({ count: 0 });
		expect(authenticateInferenceApiKey(key.value.apiKey, database).status).toBe(
			"authenticated",
		);
	}, 30_000);
});

describe("credential primitives", () => {
	it("normalizes only the username and verifies versioned scrypt hashes", async () => {
		expect(normalizeUsername("  Mixed_Case  ")).toEqual({
			username: "Mixed_Case",
			normalizedUsername: "mixed_case",
		});
		expect(normalizeUsername("not allowed!")).toBeNull();
		const password = "  unicode password long enough 🔐  ";
		const hash = await hashPassword(password);
		expect(hash).not.toContain(password);
		expect(await verifyPassword(hash, password)).toBe(true);
		expect(await verifyPassword(hash, password.trim())).toBe(false);
		expect(await verifyLoginPassword(hash, password)).toBe(true);
		expect(await verifyLoginPassword(undefined, password)).toBe(false);
		const shortHash = await hashPassword("short");
		expect(await verifyPassword(shortHash, "short")).toBe(true);
	}, 30_000);
});

async function createAdministrator() {
	const result = await bootstrapAdministrator(
		{
			username: "Owner",
			password: ADMIN_PASSWORD,
			bootstrapToken: BOOTSTRAP_TOKEN,
		},
		database,
		1_000,
	);
	expect(result.ok).toBe(true);
	const row = database.sqlite
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

async function createMember() {
	const existingAdmin = database.sqlite
		.prepare("select id from users where role = 'admin'")
		.get();
	if (!existingAdmin) {
		await bootstrapAdministrator(
			{
				username: "Owner",
				password: ADMIN_PASSWORD,
				bootstrapToken: BOOTSTRAP_TOKEN,
			},
			database,
			1_000,
		);
	}
	await registerMember(
		{ username: "Member", password: MEMBER_PASSWORD },
		database,
		2_000,
	);
	const row = database.sqlite
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
