import "@tanstack/react-start/server-only";

import { and, count, eq, gt, inArray, lte, min } from "drizzle-orm";

import { readPublicDemoEnabled } from "./config.server.ts";
import { createDemoApiTokenMaterial } from "./credential-secrets.server.ts";
import { type AccountDatabase, getAccountDatabase } from "./db.server.ts";
import { consumeRateLimit } from "./rate-limit.server.ts";
import { apiKeys, users } from "./schema.ts";

const DEMO_API_TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const MAX_UNEXPIRED_DEMO_API_TOKENS = 25;
const MAX_EXPIRED_TOKENS_CLEANED_PER_ISSUANCE = 100;
const ISSUANCE_RATE_LIMIT_KEY = "demo-api-token-issuance:global";
const ISSUANCE_RATE_LIMIT_MAXIMUM = 10;
const ISSUANCE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export type DemoApiTokenIssuanceResult =
	| {
			ok: true;
			value: { apiKey: string; createdAt: number; expiresAt: number };
	  }
	| {
			ok: false;
			code:
				| "capacity_reached"
				| "configuration_error"
				| "demo_disabled"
				| "rate_limited"
				| "setup_required";
			retryAfterSeconds?: number;
	  };

export function issueDemoApiToken(
	database: AccountDatabase = getAccountDatabase(),
	now = Date.now(),
): DemoApiTokenIssuanceResult {
	try {
		if (!readPublicDemoEnabled()) {
			return { ok: false, code: "demo_disabled" };
		}
	} catch {
		return { ok: false, code: "configuration_error" };
	}

	const rateLimit = consumeRateLimit(
		ISSUANCE_RATE_LIMIT_KEY,
		ISSUANCE_RATE_LIMIT_MAXIMUM,
		ISSUANCE_RATE_LIMIT_WINDOW_MS,
		now,
	);
	if (!rateLimit.allowed) {
		return {
			ok: false,
			code: "rate_limited",
			retryAfterSeconds: rateLimit.retryAfterSeconds,
		};
	}

	try {
		return database.db.transaction(
			(transaction) => {
				const userCount = transaction
					.select({ value: count() })
					.from(users)
					.get();
				if (!userCount || userCount.value === 0) {
					return { ok: false, code: "setup_required" } as const;
				}

				const expiredSelectors = transaction
					.select({ selector: apiKeys.selector })
					.from(apiKeys)
					.where(and(eq(apiKeys.kind, "demo"), lte(apiKeys.expiresAt, now)))
					.limit(MAX_EXPIRED_TOKENS_CLEANED_PER_ISSUANCE)
					.all()
					.map(({ selector }) => selector);
				if (expiredSelectors.length > 0) {
					transaction
						.delete(apiKeys)
						.where(
							and(
								eq(apiKeys.kind, "demo"),
								inArray(apiKeys.selector, expiredSelectors),
							),
						)
						.run();
				}

				const active = transaction
					.select({
						count: count(),
						earliestExpiry: min(apiKeys.expiresAt),
					})
					.from(apiKeys)
					.where(and(eq(apiKeys.kind, "demo"), gt(apiKeys.expiresAt, now)))
					.get();
				if (active && active.count >= MAX_UNEXPIRED_DEMO_API_TOKENS) {
					const retryAfterSeconds = Math.max(
						1,
						Math.ceil(((active.earliestExpiry ?? now) - now) / 1000),
					);
					return {
						ok: false,
						code: "capacity_reached",
						retryAfterSeconds,
					} as const;
				}

				const token = createDemoApiTokenMaterial();
				const expiresAt = now + DEMO_API_TOKEN_LIFETIME_MS;
				transaction
					.insert(apiKeys)
					.values({
						selector: token.selector,
						kind: "demo",
						userId: null,
						prefix: token.prefix,
						secretDigest: token.secretDigest,
						createdAt: now,
						expiresAt,
					})
					.run();
				return {
					ok: true,
					value: { apiKey: token.apiKey, createdAt: now, expiresAt },
				} as const;
			},
			{ behavior: "immediate" },
		);
	} catch {
		return { ok: false, code: "configuration_error" };
	}
}
