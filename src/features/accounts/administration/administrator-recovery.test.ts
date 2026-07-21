import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { login } from "../access/authentication.server.ts";
import { verifyPassword } from "../access/password.server.ts";
import { authenticateInferenceApiKey } from "../api-keys/inference-api-key-authentication.server.ts";
import { createPersonalApiKey } from "../api-keys/personal-api-keys.server.ts";
import type { AccountTestContext } from "../testing/account-test-context.ts";
import {
	ADMIN_PASSWORD,
	createAccountTestContext,
	createTestAdministrator,
} from "../testing/account-test-context.ts";

let context: AccountTestContext;

beforeEach(() => {
	context = createAccountTestContext();
});

afterEach(() => {
	context.dispose();
});

describe("administrator host recovery", () => {
	it("resets the sole administrator without revoking API keys", async () => {
		const administrator = await createTestAdministrator(context);
		const key = createPersonalApiKey(
			administrator,
			context.database,
			Date.now(),
		);
		expect(key.ok).toBe(true);
		if (!key.ok) return;
		const signedIn = await login(
			{ username: administrator.username, password: ADMIN_PASSWORD },
			context.database,
		);
		expect(signedIn.ok).toBe(true);

		const output = execFileSync(
			process.execPath,
			[join(process.cwd(), "scripts/reset-admin-password.mjs"), "OWNER"],
			{
				encoding: "utf8",
				env: {
					...process.env,
					GOOD_ENOUGH_DATABASE_PATH: context.databasePath,
				},
			},
		);
		const outputLines = output.trim().split("\n");
		expect(outputLines[0]).toBe(
			"Temporary administrator password (shown once):",
		);
		expect(outputLines[1]).toMatch(/^[A-Za-z0-9_-]{32}$/u);
		expect(outputLines[2]).toMatch(/^Expires at: /u);

		const stored = context.database.sqlite
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
			context.database.sqlite
				.prepare("select count(*) as count from sessions")
				.get(),
		).toEqual({ count: 0 });
		expect(
			authenticateInferenceApiKey(key.value.apiKey, context.database).status,
		).toBe("authenticated");
	}, 30_000);
});
