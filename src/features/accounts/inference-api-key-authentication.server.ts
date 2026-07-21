import "@tanstack/react-start/server-only";

import { eq } from "drizzle-orm";

import {
	credentialSecretMatchesDigest,
	parseDemoApiToken,
	parsePersonalApiKey,
} from "./credential-secrets.server.ts";
import { type AccountDatabase, getAccountDatabase } from "./db.server.ts";
import { apiKeys, users } from "./schema.ts";

export function authenticateInferenceApiKey(
	presentedKey: string,
	database: AccountDatabase = getAccountDatabase(),
	now = Date.now(),
) {
	const demoToken = parseDemoApiToken(presentedKey);
	const personalKey = demoToken ? null : parsePersonalApiKey(presentedKey);
	const parsed = demoToken ?? personalKey;
	const expectedKind = demoToken ? "demo" : "personal";
	if (!parsed) return { status: "rejected" } as const;

	const key = database.db
		.select({
			kind: apiKeys.kind,
			userId: apiKeys.userId,
			secretDigest: apiKeys.secretDigest,
			expiresAt: apiKeys.expiresAt,
			revokedAt: apiKeys.revokedAt,
			userStatus: users.status,
		})
		.from(apiKeys)
		.leftJoin(users, eq(apiKeys.userId, users.id))
		.where(eq(apiKeys.selector, parsed.selector))
		.get();
	if (
		!key ||
		key.kind !== expectedKind ||
		key.expiresAt <= now ||
		!credentialSecretMatchesDigest(parsed.secret, key.secretDigest)
	) {
		return { status: "rejected" } as const;
	}

	if (key.kind === "demo") {
		return {
			status: "authenticated",
			principalId: `demo:${parsed.selector}`,
		} as const;
	}
	if (
		key.userId === null ||
		key.revokedAt !== null ||
		key.userStatus !== "active"
	) {
		return { status: "rejected" } as const;
	}
	return { status: "authenticated", principalId: key.userId } as const;
}
