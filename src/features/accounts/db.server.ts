import "@tanstack/react-start/server-only";

import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";

import { readDatabasePath } from "./config.server.ts";

export function createAccountDatabase(
	databasePath: string,
	migrationsFolder = resolve("drizzle"),
) {
	const resolvedPath =
		databasePath === ":memory:" ? databasePath : resolve(databasePath);
	if (resolvedPath !== ":memory:") {
		mkdirSync(dirname(resolvedPath), { recursive: true, mode: 0o700 });
	}

	const sqlite = new DatabaseSync(resolvedPath, {
		enableForeignKeyConstraints: true,
		enableDoubleQuotedStringLiterals: false,
	});
	sqlite.exec("PRAGMA journal_mode = WAL");
	sqlite.exec("PRAGMA busy_timeout = 5000");
	sqlite.exec("PRAGMA synchronous = NORMAL");

	const db = drizzle({ client: sqlite });
	migrate(db, { migrationsFolder });

	if (resolvedPath !== ":memory:") {
		chmodSync(resolvedPath, 0o600);
	}
	return { db, sqlite };
}

export type AccountDatabase = ReturnType<typeof createAccountDatabase>;
let singleton: AccountDatabase | undefined;

export function runImmediateAccountTransaction<T>(
	sqlite: DatabaseSync,
	callback: () => T,
): T {
	sqlite.exec("BEGIN IMMEDIATE");
	try {
		const result = callback();
		sqlite.exec("COMMIT");
		return result;
	} catch (error) {
		sqlite.exec("ROLLBACK");
		throw error;
	}
}

export function getAccountDatabase(): AccountDatabase {
	if (!singleton) {
		singleton = createAccountDatabase(readDatabasePath());
	}
	return singleton;
}
