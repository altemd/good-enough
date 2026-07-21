import "@tanstack/react-start/server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, gt, lte } from "drizzle-orm";

import { readAppOrigin } from "../config.server.ts";
import { digestCredentialSecret } from "../credential-secrets.server.ts";
import {
	type AccountDatabase,
	type AccountQueryDatabase,
	getAccountDatabase,
} from "../db.server.ts";
import { sessions, users } from "../schema.ts";

const NORMAL_SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const RESTRICTED_SESSION_MS = 30 * 60 * 1000;
const MAX_ACTIVE_SESSIONS = 10;
const SECURE_COOKIE_NAME = "__Host-ge_session";
const DEVELOPMENT_COOKIE_NAME = "ge_session_dev";

export interface BrowserSession {
	id: string;
	expiresAt: number;
	restricted: boolean;
	user: {
		id: string;
		username: string;
		role: "admin" | "member";
		mustChangePassword: boolean;
	};
}

export function createBrowserSession(
	userId: string,
	restricted: boolean,
	now = Date.now(),
	database: AccountQueryDatabase = getAccountDatabase(),
) {
	const token = randomBytes(32).toString("base64url");
	const expiresAt =
		now + (restricted ? RESTRICTED_SESSION_MS : NORMAL_SESSION_MS);
	database.db.delete(sessions).where(lte(sessions.expiresAt, now)).run();

	const active = database.db
		.select({ id: sessions.id })
		.from(sessions)
		.where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, now)))
		.orderBy(asc(sessions.createdAt))
		.all();
	const excessAfterInsert = active.length - MAX_ACTIVE_SESSIONS + 1;
	if (excessAfterInsert > 0) {
		for (const session of active.slice(0, excessAfterInsert)) {
			database.db.delete(sessions).where(eq(sessions.id, session.id)).run();
		}
	}

	database.db
		.insert(sessions)
		.values({
			id: randomUUID(),
			userId,
			tokenDigest: digestCredentialSecret(token),
			createdAt: now,
			expiresAt,
		})
		.run();
	return { expiresAt, token };
}

export function readBrowserSession(
	token: string | null,
	now = Date.now(),
	database: AccountDatabase = getAccountDatabase(),
): BrowserSession | null {
	if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) {
		return null;
	}
	const row = database.db
		.select({
			id: sessions.id,
			expiresAt: sessions.expiresAt,
			userId: users.id,
			username: users.username,
			role: users.role,
			status: users.status,
			mustChangePassword: users.mustChangePassword,
		})
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(eq(sessions.tokenDigest, digestCredentialSecret(token)))
		.get();
	if (!row || row.expiresAt <= now || row.status !== "active") {
		return null;
	}
	return {
		id: row.id,
		expiresAt: row.expiresAt,
		restricted: row.mustChangePassword,
		user: {
			id: row.userId,
			username: row.username,
			role: row.role,
			mustChangePassword: row.mustChangePassword,
		},
	};
}

export function deleteBrowserSession(
	sessionId: string,
	database: AccountDatabase = getAccountDatabase(),
) {
	database.db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}

export function deleteUserSessions(
	userId: string,
	database: AccountQueryDatabase = getAccountDatabase(),
) {
	database.db.delete(sessions).where(eq(sessions.userId, userId)).run();
}

export function getSessionCookiePolicy() {
	const origin = readAppOrigin();
	if (origin.protocol === "https:") {
		return { name: SECURE_COOKIE_NAME, secure: true };
	}
	if (["127.0.0.1", "::1", "localhost"].includes(origin.hostname)) {
		return { name: DEVELOPMENT_COOKIE_NAME, secure: false };
	}
	throw new Error("Insecure account origin");
}
