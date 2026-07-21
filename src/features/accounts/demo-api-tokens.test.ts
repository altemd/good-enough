import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueDemoApiToken } from "./api-keys/demo-api-tokens.server.ts";
import { authenticateInferenceApiKey } from "./api-keys/inference-api-key-authentication.server.ts";
import { readPublicDemoEnabled } from "./config.server.ts";
import { type AccountDatabase, createAccountDatabase } from "./db.server.ts";
import { clearRateLimit } from "./rate-limit.server.ts";

const RATE_LIMIT_KEY = "demo-api-token-issuance:global";
const HOUR_MS = 60 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;

let directory: string;
let database: AccountDatabase;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "good-enough-demo-tokens-"));
	database = createAccountDatabase(join(directory, "accounts.sqlite"));
	clearRateLimit(RATE_LIMIT_KEY);
	vi.stubEnv("PUBLIC_DEMO_ENABLED", "true");
});

afterEach(() => {
	database.sqlite.close();
	rmSync(directory, { recursive: true, force: true });
	clearRateLimit(RATE_LIMIT_KEY);
	vi.unstubAllEnvs();
});

describe("public demo API tokens", () => {
	it("defaults to enabled and accepts only exact trusted booleans", () => {
		expect(readPublicDemoEnabled(undefined)).toBe(true);
		expect(readPublicDemoEnabled("true")).toBe(true);
		expect(readPublicDemoEnabled("false")).toBe(false);
		expect(() => readPublicDemoEnabled("TRUE")).toThrow(
			"Invalid public demo configuration",
		);
	});

	it("fails issuance closed before setup, when disabled, and on invalid configuration", () => {
		expect(issueDemoApiToken(database, 1_000)).toEqual({
			ok: false,
			code: "setup_required",
		});

		vi.stubEnv("PUBLIC_DEMO_ENABLED", "false");
		expect(issueDemoApiToken(database, 2_000)).toEqual({
			ok: false,
			code: "demo_disabled",
		});

		vi.stubEnv("PUBLIC_DEMO_ENABLED", "invalid-private-value");
		expect(issueDemoApiToken(database, 3_000)).toEqual({
			ok: false,
			code: "configuration_error",
		});
	});

	it("stores only a digest and expires exactly one hour after issuance", () => {
		seedUser();
		const created = issueDemoApiToken(database, 10_000);
		expect(created.ok).toBe(true);
		if (!created.ok) return;

		expect(created.value.expiresAt - created.value.createdAt).toBe(HOUR_MS);
		expect(created.value.apiKey).toMatch(
			/^ge_demo_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{43}$/u,
		);
		const stored = database.sqlite
			.prepare(
				"select selector, kind, user_id, prefix, secret_digest, created_at, expires_at, revoked_at from api_keys",
			)
			.get() as {
			selector: string;
			kind: string;
			user_id: null;
			prefix: string;
			secret_digest: Uint8Array;
			created_at: number;
			expires_at: number;
			revoked_at: null;
		};
		expect(stored).toMatchObject({
			kind: "demo",
			user_id: null,
			prefix: `ge_demo_${stored.selector}`,
			revoked_at: null,
		});
		expect(stored.selector).toHaveLength(16);
		expect(Buffer.from(stored.secret_digest)).toHaveLength(32);
		expect(JSON.stringify(stored)).not.toContain(created.value.apiKey);

		const changesBeforeAuthentication = totalChanges();
		expect(
			authenticateInferenceApiKey(
				created.value.apiKey,
				database,
				created.value.expiresAt - 1,
			),
		).toEqual({
			status: "authenticated",
			principalId: `demo:${stored.selector}`,
		});
		expect(totalChanges()).toBe(changesBeforeAuthentication);
		expect(
			authenticateInferenceApiKey(
				created.value.apiKey,
				database,
				created.value.expiresAt,
			),
		).toEqual({ status: "rejected" });
		expect(totalChanges()).toBe(changesBeforeAuthentication);
	});

	it("enforces the exact 25-token boundary and frees capacity at expiry", () => {
		seedUser();
		const startedAt = 1_000_000;
		const results = [
			...issueMany(10, startedAt),
			...issueMany(10, startedAt + TEN_MINUTES_MS),
			...issueMany(5, startedAt + 2 * TEN_MINUTES_MS),
		];
		expect(results).toHaveLength(25);
		expect(results.every((result) => result.ok)).toBe(true);

		expect(
			issueDemoApiToken(database, startedAt + 2 * TEN_MINUTES_MS + 1),
		).toEqual({
			ok: false,
			code: "capacity_reached",
			retryAfterSeconds: 2_400,
		});

		const replacement = issueDemoApiToken(database, startedAt + HOUR_MS);
		expect(replacement.ok).toBe(true);
		expect(countStoredTokens()).toBe(16);
	});

	it("limits public issuance to ten attempts per process per ten minutes", () => {
		seedUser();
		const now = 5_000_000;
		expect(issueMany(10, now).every((result) => result.ok)).toBe(true);
		expect(issueDemoApiToken(database, now + 1)).toEqual({
			ok: false,
			code: "rate_limited",
			retryAfterSeconds: 600,
		});
		expect(issueDemoApiToken(database, now + TEN_MINUTES_MS).ok).toBe(true);
	});

	it("cleans at most 100 expired records during one issuance", () => {
		seedUser();
		const insert = database.sqlite.prepare(
			"insert into api_keys (selector, kind, user_id, prefix, secret_digest, created_at, expires_at, revoked_at) values (?, 'demo', null, ?, ?, ?, ?, null)",
		);
		for (let index = 0; index < 105; index += 1) {
			insert.run(
				`expired-${index}`,
				`ge_demo_expired-${index}`,
				createHash("sha256").update(String(index)).digest(),
				1,
				2,
			);
		}

		expect(issueDemoApiToken(database, 10_000).ok).toBe(true);
		expect(countStoredTokens()).toBe(6);
	});

	it("enforces credential ownership and lifecycle constraints in SQLite", () => {
		seedUser();
		const insert = database.sqlite.prepare(
			"insert into api_keys (selector, kind, user_id, prefix, secret_digest, created_at, expires_at, revoked_at) values (?, ?, ?, ?, ?, 1, 2, ?)",
		);
		expect(() =>
			insert.run(
				"ownerless-personal",
				"personal",
				null,
				"ge_ownerless",
				Buffer.alloc(32, 1),
				null,
			),
		).toThrow();
		expect(() =>
			insert.run(
				"owned-demo",
				"demo",
				"admin-id",
				"ge_demo_owned",
				Buffer.alloc(32, 2),
				null,
			),
		).toThrow();
		expect(() =>
			insert.run(
				"revoked-demo",
				"demo",
				null,
				"ge_demo_revoked",
				Buffer.alloc(32, 3),
				2,
			),
		).toThrow();
	});

	it("uses one persisted verifier for personal and demo credential families", () => {
		seedUser();
		const created = issueDemoApiToken(database, 20_000);
		expect(created.ok).toBe(true);
		if (!created.ok) return;

		expect(
			authenticateInferenceApiKey(created.value.apiKey, database, 20_001),
		).toMatchObject({ status: "authenticated" });
		expect(
			authenticateInferenceApiKey(
				`${created.value.apiKey.slice(0, -1)}${created.value.apiKey.endsWith("A") ? "B" : "A"}`,
				database,
				20_001,
			),
		).toEqual({ status: "rejected" });
		expect(authenticateInferenceApiKey("malformed", database, 20_001)).toEqual({
			status: "rejected",
		});
	});

	it("sanitizes database failures", () => {
		seedUser();
		database.sqlite.close();
		expect(issueDemoApiToken(database, 30_000)).toEqual({
			ok: false,
			code: "configuration_error",
		});
		database = createAccountDatabase(join(directory, "replacement.sqlite"));
	});
});

function seedUser() {
	database.sqlite
		.prepare(
			"insert into users (id, username, normalized_username, password_hash, role, status, must_change_password, created_at, updated_at, password_changed_at) values (?, ?, ?, ?, 'admin', 'active', 0, ?, ?, ?)",
		)
		.run("admin-id", "Owner", "owner", "unused-test-hash", 1, 1, 1);
}

function issueMany(count: number, now: number) {
	return Array.from({ length: count }, () => issueDemoApiToken(database, now));
}

function countStoredTokens(): number {
	return (
		database.sqlite
			.prepare("select count(*) as count from api_keys where kind = 'demo'")
			.get() as { count: number }
	).count;
}

function totalChanges(): number {
	return (
		database.sqlite.prepare("select total_changes() as count").get() as {
			count: number;
		}
	).count;
}
