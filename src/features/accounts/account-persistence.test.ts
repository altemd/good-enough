import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AccountTestContext } from "./testing/account-test-context.ts";
import { createAccountTestContext } from "./testing/account-test-context.ts";

let context: AccountTestContext;

beforeEach(() => {
	context = createAccountTestContext();
});

afterEach(() => {
	context.dispose();
});

describe("account persistence", () => {
	it("applies committed migrations and SQLite safety pragmas", () => {
		expect(
			context.database.sqlite.prepare("pragma foreign_keys").get(),
		).toEqual({
			foreign_keys: 1,
		});
		expect(
			context.database.sqlite.prepare("pragma journal_mode").get(),
		).toEqual({
			journal_mode: "wal",
		});
		expect(
			context.database.sqlite.prepare("pragma busy_timeout").get(),
		).toEqual({
			timeout: 5_000,
		});
		expect(context.database.sqlite.prepare("pragma synchronous").get()).toEqual(
			{
				synchronous: 1,
			},
		);
		expect(
			context.database.sqlite
				.prepare("select count(*) as count from __drizzle_migrations")
				.get(),
		).toEqual({ count: 2 });
	});

	it("rolls back a failed immediate account transaction", () => {
		context.database.sqlite.exec(
			"create table transaction_probe (value text not null)",
		);
		expect(() =>
			context.database.db.transaction(
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
			context.database.sqlite
				.prepare("select count(*) as count from transaction_probe")
				.get(),
		).toEqual({ count: 0 });
	});
});
