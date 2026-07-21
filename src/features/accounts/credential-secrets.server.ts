import "@tanstack/react-start/server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const API_KEY_SELECTOR_BYTES = 12;
const API_KEY_SECRET_BYTES = 32;
const API_KEY_PREFIX_PATTERN = /^ge_([A-Za-z0-9_-]{16})$/u;
const API_KEY_PATTERN = /^ge_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{43})$/u;
const DEMO_API_TOKEN_PATTERN =
	/^ge_demo_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{43})$/u;

export function digestCredentialSecret(secret: string): Buffer {
	return createHash("sha256").update(secret, "utf8").digest();
}

export function credentialSecretsEqual(
	expected: string,
	presented: string,
): boolean {
	return timingSafeEqual(
		digestCredentialSecret(expected),
		digestCredentialSecret(presented),
	);
}

export function credentialSecretMatchesDigest(
	secret: string,
	expectedDigest: Uint8Array,
): boolean {
	return timingSafeEqual(expectedDigest, digestCredentialSecret(secret));
}

export function createPersonalApiKeyMaterial() {
	const selector = randomBytes(API_KEY_SELECTOR_BYTES).toString("base64url");
	const secret = randomBytes(API_KEY_SECRET_BYTES).toString("base64url");
	const prefix = `ge_${selector}`;
	return {
		apiKey: `${prefix}_${secret}`,
		prefix,
		secretDigest: digestCredentialSecret(secret),
		selector,
	};
}

export function createDemoApiTokenMaterial() {
	const selector = randomBytes(API_KEY_SELECTOR_BYTES).toString("base64url");
	const secret = randomBytes(API_KEY_SECRET_BYTES).toString("base64url");
	const prefix = `ge_demo_${selector}`;
	return {
		apiKey: `${prefix}_${secret}`,
		prefix,
		secretDigest: digestCredentialSecret(secret),
		selector,
	};
}

export function parsePersonalApiKeyPrefix(prefix: string): string | null {
	const match = API_KEY_PREFIX_PATTERN.exec(prefix);
	return match ? (match[1] as string) : null;
}

export function parsePersonalApiKey(
	apiKey: string,
): { selector: string; secret: string } | null {
	const match = API_KEY_PATTERN.exec(apiKey);
	return match
		? { selector: match[1] as string, secret: match[2] as string }
		: null;
}

export function parseDemoApiToken(
	apiKey: string,
): { selector: string; secret: string } | null {
	const match = DEMO_API_TOKEN_PATTERN.exec(apiKey);
	return match
		? { selector: match[1] as string, secret: match[2] as string }
		: null;
}
