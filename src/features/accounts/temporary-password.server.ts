import "@tanstack/react-start/server-only";

import { randomBytes } from "node:crypto";

import { hashPassword } from "./password.server.ts";

const TEMPORARY_PASSWORD_LIFETIME_MS = 24 * 60 * 60 * 1000;

export async function createTemporaryPassword(now = Date.now()) {
	const temporaryPassword = randomBytes(24).toString("base64url");
	const passwordHash = await hashPassword(temporaryPassword);
	return {
		expiresAt: now + TEMPORARY_PASSWORD_LIFETIME_MS,
		passwordHash,
		temporaryPassword,
	};
}
