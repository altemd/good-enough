import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AccountTestContext } from "../testing/account-test-context.ts";
import {
	createAccountTestContext,
	createTestMember,
} from "../testing/account-test-context.ts";
import { authenticateInferenceApiKey } from "./inference-api-key-authentication.server.ts";
import {
	createPersonalApiKey,
	listPersonalApiKeys,
	revokePersonalApiKey,
} from "./personal-api-keys.server.ts";

let context: AccountTestContext;

beforeEach(() => {
	context = createAccountTestContext();
});

afterEach(() => {
	context.dispose();
});

describe("personal API keys", () => {
	it("creates digest-only keys with an absolute seven-day boundary", async () => {
		const account = await createTestMember(context);
		const createdAt = 10_000;
		const created = createPersonalApiKey(account, context.database, createdAt);
		expect(created.ok).toBe(true);
		if (!created.ok) return;

		expect(created.value.expiresAt - created.value.createdAt).toBe(
			7 * 24 * 60 * 60 * 1000,
		);
		const stored = context.database.sqlite
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
				context.database,
				created.value.expiresAt - 1,
			),
		).toEqual({ status: "authenticated", principalId: account.id });
		expect(
			authenticateInferenceApiKey(
				created.value.apiKey,
				context.database,
				created.value.expiresAt,
			),
		).toEqual({ status: "rejected" });
		const expiredKeys = listPersonalApiKeys(
			account,
			context.database,
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
				context.database,
				created.value.expiresAt + 1,
			),
		).toEqual({ ok: true, value: {} });
		const revokedKeys = listPersonalApiKeys(
			account,
			context.database,
			created.value.expiresAt + 1,
		);
		expect(revokedKeys?.[0]).toMatchObject({ state: "revoked" });

		const replacementTime = created.value.expiresAt + 2;
		const replacementKeys = Array.from({ length: 10 }, () =>
			createPersonalApiKey(account, context.database, replacementTime),
		);
		expect(replacementKeys.every((result) => result.ok)).toBe(true);
		expect(
			createPersonalApiKey(account, context.database, replacementTime),
		).toEqual({
			ok: false,
			code: "forbidden",
		});
		expect(
			createPersonalApiKey(
				account,
				context.database,
				replacementTime + 7 * 24 * 60 * 60 * 1000,
			).ok,
		).toBe(true);
	}, 30_000);
});
