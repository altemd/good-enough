import "@tanstack/react-start/server-only";

import { Buffer } from "node:buffer";

import { parseApplicationOrigin } from "./app-origin.ts";

const DEFAULT_DATABASE_PATH = "./data/good-enough.sqlite";

export function readDatabasePath(
	value = process.env.GOOD_ENOUGH_DATABASE_PATH,
) {
	const path = value ?? DEFAULT_DATABASE_PATH;
	if (path.length === 0 || path.includes("\0")) {
		throw new Error("Invalid account database path");
	}
	return path;
}

export function readRegistrationEnabled(
	value = process.env.ACCOUNT_REGISTRATION_ENABLED,
): boolean {
	if (value === undefined || value === "true") {
		return true;
	}
	if (value === "false") {
		return false;
	}
	throw new Error("Invalid registration configuration");
}

export function readBootstrapToken(
	value = process.env.ACCOUNT_BOOTSTRAP_TOKEN,
): string | null {
	if (value === undefined) {
		return null;
	}
	const bytes = Buffer.byteLength(value, "utf8");
	if (bytes < 32 || bytes > 256 || /\s/u.test(value)) {
		throw new Error("Invalid bootstrap configuration");
	}
	return value;
}

export function readAppOrigin(
	value = process.env.APP_ORIGIN,
	nodeEnvironment = process.env.NODE_ENV,
): URL {
	return parseApplicationOrigin(value, nodeEnvironment);
}
