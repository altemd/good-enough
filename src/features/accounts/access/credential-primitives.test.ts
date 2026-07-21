import { describe, expect, it } from "vitest";

import {
	hashPassword,
	verifyLoginPassword,
	verifyPassword,
} from "./password.server.ts";
import { normalizeUsername } from "./username-policy.ts";

describe("credential primitives", () => {
	it("normalizes only the username and verifies versioned scrypt hashes", async () => {
		expect(normalizeUsername("  Mixed_Case  ")).toEqual({
			username: "Mixed_Case",
			normalizedUsername: "mixed_case",
		});
		expect(normalizeUsername("not allowed!")).toBeNull();
		const password = "  unicode password long enough 🔐  ";
		const hash = await hashPassword(password);
		expect(hash).not.toContain(password);
		expect(await verifyPassword(hash, password)).toBe(true);
		expect(await verifyPassword(hash, password.trim())).toBe(false);
		expect(await verifyLoginPassword(hash, password)).toBe(true);
		expect(await verifyLoginPassword(undefined, password)).toBe(false);
		const shortHash = await hashPassword("short");
		expect(await verifyPassword(shortHash, "short")).toBe(true);
	}, 30_000);
});
