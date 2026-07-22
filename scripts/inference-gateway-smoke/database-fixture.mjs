import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import {
	BROWSER_SESSION_TOKEN,
	DATABASE_API_KEY,
	DATABASE_PRINCIPAL_ID,
	DEMO_API_KEY,
	DISABLED_API_KEY,
	EXPIRED_API_KEY,
	REVOKED_API_KEY,
} from "./constants.mjs";

export function seedDatabaseKeys(path) {
	const database = new DatabaseSync(path);
	const now = Date.now();
	const insertUser = database.prepare(
		"insert into users (id, username, normalized_username, password_hash, role, status, must_change_password, created_at, updated_at, password_changed_at) values (?, ?, ?, ?, 'member', ?, 0, ?, ?, ?)",
	);
	insertUser.run(
		DATABASE_PRINCIPAL_ID,
		"DatabaseUser",
		"databaseuser",
		"unused-runtime-password-hash",
		"active",
		now,
		now,
		now,
	);
	insertUser.run(
		"disabled-database-user",
		"DisabledUser",
		"disableduser",
		"unused-runtime-password-hash",
		"disabled",
		now,
		now,
		now,
	);
	const insertKey = database.prepare(
		"insert into api_keys (selector, kind, user_id, prefix, secret_digest, created_at, expires_at, revoked_at) values (?, 'personal', ?, ?, ?, ?, ?, ?)",
	);
	insertRuntimeKey(
		insertKey,
		DATABASE_API_KEY,
		DATABASE_PRINCIPAL_ID,
		now,
		now + 60_000,
		null,
	);
	insertRuntimeKey(
		insertKey,
		EXPIRED_API_KEY,
		DATABASE_PRINCIPAL_ID,
		now - 60_000,
		now,
		null,
	);
	insertRuntimeKey(
		insertKey,
		REVOKED_API_KEY,
		DATABASE_PRINCIPAL_ID,
		now,
		now + 60_000,
		now,
	);
	insertRuntimeKey(
		insertKey,
		DISABLED_API_KEY,
		"disabled-database-user",
		now,
		now + 60_000,
		null,
	);
	insertRuntimeDemoToken(database, DEMO_API_KEY, now, now + 60_000);
	database
		.prepare(
			"insert into sessions (id, user_id, token_digest, created_at, expires_at) values (?, ?, ?, ?, ?)",
		)
		.run(
			"runtime-browser-session",
			DATABASE_PRINCIPAL_ID,
			createHash("sha256").update(BROWSER_SESSION_TOKEN).digest(),
			now,
			now + 60_000,
		);
	database.close();
}

function insertRuntimeDemoToken(database, apiKey, createdAt, expiresAt) {
	const match = /^ge_demo_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{43})$/.exec(
		apiKey,
	);
	assert.ok(match);
	const [, selector, secret] = match;
	database
		.prepare(
			"insert into api_keys (selector, kind, user_id, prefix, secret_digest, created_at, expires_at, revoked_at) values (?, 'demo', null, ?, ?, ?, ?, null)",
		)
		.run(
			selector,
			`ge_demo_${selector}`,
			createHash("sha256").update(secret).digest(),
			createdAt,
			expiresAt,
		);
}

function insertRuntimeKey(
	statement,
	apiKey,
	userId,
	createdAt,
	expiresAt,
	revokedAt,
) {
	const match = /^ge_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{43})$/.exec(apiKey);
	assert.ok(match);
	const [, selector, secret] = match;
	statement.run(
		selector,
		userId,
		`ge_${selector}`,
		createHash("sha256").update(secret).digest(),
		createdAt,
		expiresAt,
		revokedAt,
	);
}
