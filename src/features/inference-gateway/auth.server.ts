import "@tanstack/react-start/server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import type { ApiProtocol } from "./api-protocol";

const MIN_API_KEY_BYTES = 32;
const MAX_API_KEY_BYTES = 256;
const MAX_CONFIGURED_API_KEYS = 256;
const PRINCIPAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export type AuthenticationDecision =
	| { readonly status: "authenticated"; readonly principalId: string }
	| { readonly status: "configuration_error" }
	| { readonly status: "rejected" };

interface ConfiguredApiKey {
	readonly id: string;
	readonly digest: Uint8Array;
}

export function authenticateConfiguredApiKey(
	request: Request,
	apiProtocol: ApiProtocol,
	configuration: string | undefined,
): AuthenticationDecision {
	const configuredKeys = parseConfiguredApiKeys(configuration);
	if (!configuredKeys) {
		return { status: "configuration_error" };
	}

	const presentedKey = extractApiKey(request.headers, apiProtocol);
	if (!presentedKey) {
		return { status: "rejected" };
	}

	const presentedDigest = digestApiKey(presentedKey);
	let principalId: string | null = null;
	for (const configuredKey of configuredKeys) {
		if (timingSafeEqual(configuredKey.digest, presentedDigest)) {
			principalId = configuredKey.id;
		}
	}

	return principalId
		? { status: "authenticated", principalId }
		: { status: "rejected" };
}

function parseConfiguredApiKeys(
	configuration: string | undefined,
): ReadonlyArray<ConfiguredApiKey> | null {
	if (!configuration) {
		return null;
	}

	let value: unknown;
	try {
		value = JSON.parse(configuration);
	} catch {
		return null;
	}

	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > MAX_CONFIGURED_API_KEYS
	) {
		return null;
	}

	const principalIds = new Set<string>();
	const digests = new Set<string>();
	const configuredKeys: Array<ConfiguredApiKey> = [];
	for (const entry of value) {
		if (!isConfiguredApiKeyEntry(entry)) {
			return null;
		}

		const byteLength = Buffer.byteLength(entry.key, "utf8");
		if (
			!PRINCIPAL_ID_PATTERN.test(entry.id) ||
			byteLength < MIN_API_KEY_BYTES ||
			byteLength > MAX_API_KEY_BYTES ||
			/\s/u.test(entry.key)
		) {
			return null;
		}

		const digest = digestApiKey(entry.key);
		const digestKey = Buffer.from(digest).toString("base64");
		if (principalIds.has(entry.id) || digests.has(digestKey)) {
			return null;
		}

		principalIds.add(entry.id);
		digests.add(digestKey);
		configuredKeys.push({ id: entry.id, digest });
	}

	return configuredKeys;
}

function extractApiKey(
	headers: Headers,
	apiProtocol: ApiProtocol,
): string | null {
	if (apiProtocol === "anthropic") {
		const apiKey = headers.get("x-api-key");
		return apiKey && !/\s/u.test(apiKey) ? apiKey : null;
	}

	const authorization = headers.get("authorization");
	const match = authorization?.match(/^Bearer ([^\s]+)$/i);
	return match?.[1] ?? null;
}

function digestApiKey(apiKey: string): Uint8Array {
	return createHash("sha256").update(apiKey, "utf8").digest();
}

function isConfiguredApiKeyEntry(
	value: unknown,
): value is { readonly id: string; readonly key: string } {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}

	const keys = Object.keys(value);
	return (
		keys.length === 2 &&
		keys.includes("id") &&
		keys.includes("key") &&
		typeof Reflect.get(value, "id") === "string" &&
		typeof Reflect.get(value, "key") === "string"
	);
}
