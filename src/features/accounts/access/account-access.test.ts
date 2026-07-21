import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountTestContext } from "../testing/account-test-context.ts";
import {
	ADMIN_PASSWORD,
	BOOTSTRAP_TOKEN,
	createAccountTestContext,
	createTestAdministrator,
	MEMBER_PASSWORD,
} from "../testing/account-test-context.ts";
import { registerMember } from "./registration.server.ts";
import { bootstrapAdministrator } from "./setup.server.ts";

let context: AccountTestContext;

beforeEach(() => {
	context = createAccountTestContext();
});

afterEach(() => {
	context.dispose();
});

describe("account setup and registration", () => {
	it("fails bootstrap closed when the trusted token is missing", async () => {
		vi.stubEnv("ACCOUNT_BOOTSTRAP_TOKEN", "");
		expect(
			await bootstrapAdministrator(
				{
					username: "Owner",
					password: ADMIN_PASSWORD,
					bootstrapToken: BOOTSTRAP_TOKEN,
				},
				context.database,
				1_000,
			),
		).toEqual({ ok: false, code: "configuration_error" });
		expect(
			context.database.sqlite
				.prepare("select count(*) as count from users")
				.get(),
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
				context.database,
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
				context.database,
				2_000,
			),
		).toEqual({ ok: false, code: "setup_complete" });

		expect(
			await registerMember(
				{ username: "Member", password: MEMBER_PASSWORD },
				context.database,
				3_000,
			),
		).toEqual({ ok: true, value: {} });
		expect(
			await registerMember(
				{ username: "member", password: MEMBER_PASSWORD },
				context.database,
				4_000,
			),
		).toEqual({ ok: false, code: "username_unavailable" });

		const roles = context.database.sqlite
			.prepare("select username, role from users order by created_at")
			.all();
		expect(roles).toEqual([
			{ username: "Owner", role: "admin" },
			{ username: "Member", role: "member" },
		]);
	}, 30_000);

	it("does not misclassify unrelated registration failures as duplicates", async () => {
		await createTestAdministrator(context);
		context.database.sqlite.exec(`
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
				context.database,
				70_000,
			),
		).toEqual({ ok: false, code: "configuration_error" });
	}, 30_000);
});
