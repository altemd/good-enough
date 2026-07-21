import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	runDisplayOnceSecretMutation,
	runMutation,
} from "./account-function-runtime.server.ts";

const startServer = vi.hoisted(() => ({
	setResponseHeader: vi.fn(),
	setResponseStatus: vi.fn(),
}));

vi.mock("@tanstack/react-start/server", () => startServer);

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("account function response boundary", () => {
	it.each([
		["capacity_reached", 429, 17],
		["rate_limited", 429, 23],
		["demo_disabled", 403, undefined],
		["configuration_error", 500, undefined],
	] as const)("maps the %s mutation result through the shared server-function boundary", async (code, status, retryAfterSeconds) => {
		const result = await runMutation(() => ({
			ok: false,
			code,
			...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
		}));

		expect(result).toEqual({
			ok: false,
			code,
			...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
		});
		expect(startServer.setResponseStatus).toHaveBeenCalledWith(status);
		expect(startServer.setResponseHeader).toHaveBeenCalledTimes(
			retryAfterSeconds === undefined ? 0 : 1,
		);
		if (retryAfterSeconds !== undefined) {
			expect(startServer.setResponseHeader).toHaveBeenCalledWith(
				"Retry-After",
				String(retryAfterSeconds),
			);
		}
	});

	it("marks display-once secret responses as non-storable", async () => {
		const result = await runDisplayOnceSecretMutation(() => ({
			ok: true,
			value: { secret: "display-once-secret" },
		}));

		expect(result).toEqual({
			ok: true,
			value: { secret: "display-once-secret" },
		});
		expect(startServer.setResponseHeader).toHaveBeenCalledWith(
			"Cache-Control",
			"no-store",
		);
	});
});
