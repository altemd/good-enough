import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { login } from "./access/authentication.server.ts";
import {
	issueTemporaryPassword,
	setMemberDisabled,
} from "./administration/member-administration.server.ts";
import { authenticateInferenceApiKey } from "./api-keys/inference-api-key-authentication.server.ts";
import { createPersonalApiKey } from "./api-keys/personal-api-keys.server.ts";
import {
	getSessionCookiePolicy,
	readBrowserSession,
} from "./sessions/sessions.server.ts";
import type { AccountTestContext } from "./testing/account-test-context.ts";
import {
	createAccountTestContext,
	createTestAdministrator,
	createTestMember,
	MEMBER_PASSWORD,
} from "./testing/account-test-context.ts";

let context: AccountTestContext;

beforeEach(() => {
	context = createAccountTestContext();
});

afterEach(() => {
	context.dispose();
});

describe("account lifecycle integration", () => {
	it("uses restricted temporary-password sessions and disables access atomically", async () => {
		const administrator = await createTestAdministrator(context);
		const member = await createTestMember(context);
		const key = createPersonalApiKey(member, context.database, 20_000);
		expect(key.ok).toBe(true);
		if (!key.ok) return;
		const normalLogin = await login(
			{ username: member.username, password: MEMBER_PASSWORD },
			context.database,
			20_001,
		);
		expect(normalLogin.ok).toBe(true);
		if (!normalLogin.ok) return;
		const storedSession = context.database.sqlite
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
			context.database,
			30_000,
		);
		expect(reset.ok).toBe(true);
		if (!reset.ok) return;
		expect(reset.value.expiresAt).toBe(30_000 + 24 * 60 * 60 * 1000);
		const signedIn = await login(
			{ username: member.username, password: reset.value.temporaryPassword },
			context.database,
			30_001,
		);
		expect(signedIn.ok).toBe(true);
		if (!signedIn.ok) return;
		expect(signedIn.value.restricted).toBe(true);
		expect(
			readBrowserSession(signedIn.value.token, 30_002, context.database)
				?.restricted,
		).toBe(true);

		expect(
			setMemberDisabled(
				administrator,
				member.id,
				true,
				context.database,
				40_000,
			),
		).toEqual({ ok: true, value: {} });
		expect(
			readBrowserSession(signedIn.value.token, 40_001, context.database),
		).toBeNull();
		expect(
			authenticateInferenceApiKey(key.value.apiKey, context.database, 40_001),
		).toEqual({ status: "rejected" });
	}, 30_000);
});
