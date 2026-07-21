import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AccountTestContext } from "../testing/account-test-context.ts";
import {
	createAccountTestContext,
	createTestMember,
} from "../testing/account-test-context.ts";
import { createBrowserSession, readBrowserSession } from "./sessions.server.ts";

let context: AccountTestContext;

beforeEach(() => {
	context = createAccountTestContext();
});

afterEach(() => {
	context.dispose();
});

describe("browser sessions", () => {
	it("retains exactly the ten newest active browser sessions", async () => {
		const member = await createTestMember(context);
		const oldest = createBrowserSession(
			member.id,
			false,
			50_000,
			context.database,
		);
		const secondOldest = createBrowserSession(
			member.id,
			false,
			50_001,
			context.database,
		);
		for (let index = 2; index < 11; index += 1) {
			createBrowserSession(member.id, false, 50_000 + index, context.database);
		}
		expect(
			context.database.sqlite
				.prepare("select count(*) as count from sessions")
				.get(),
		).toEqual({ count: 10 });
		expect(
			readBrowserSession(oldest.token, 60_000, context.database),
		).toBeNull();
		expect(
			readBrowserSession(secondOldest.token, 60_000, context.database),
		).not.toBeNull();
	}, 30_000);
});
