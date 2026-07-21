import { describe, expect, it, vi } from "vitest";

import { authenticateGatewayApiKey } from "./auth.server";

const PERSONAL_KEY = `ge_${"s".repeat(16)}_${"v".repeat(43)}`;

describe("personal API-key authentication", () => {
	it("passes an OpenAI bearer credential to the account verifier", async () => {
		const verify = vi.fn(() => ({
			status: "authenticated" as const,
			principalId: "account-id",
		}));
		expect(
			await authenticateGatewayApiKey(
				request({ authorization: `Bearer ${PERSONAL_KEY}` }),
				"openai",
				verify,
			),
		).toEqual({ status: "authenticated", principalId: "account-id" });
		expect(verify).toHaveBeenCalledWith(PERSONAL_KEY);
	});

	it("passes an Anthropic x-api-key credential to the account verifier", async () => {
		const verify = vi.fn(() => ({
			status: "authenticated" as const,
			principalId: "account-id",
		}));
		expect(
			await authenticateGatewayApiKey(
				request({ "x-api-key": PERSONAL_KEY }),
				"anthropic",
				verify,
			),
		).toEqual({ status: "authenticated", principalId: "account-id" });
		expect(verify).toHaveBeenCalledWith(PERSONAL_KEY);
	});

	it.each([
		["missing", {}],
		["malformed bearer", { authorization: `Token ${PERSONAL_KEY}` }],
		["wrong protocol header", { "x-api-key": PERSONAL_KEY }],
	] as const)("rejects %s OpenAI credentials before lookup", async (_case, headers) => {
		const verify = vi.fn();
		expect(
			await authenticateGatewayApiKey(request(headers), "openai", verify),
		).toEqual({ status: "rejected" });
		expect(verify).not.toHaveBeenCalled();
	});

	it("rejects an OpenAI bearer credential on the Anthropic route", async () => {
		const verify = vi.fn();
		expect(
			await authenticateGatewayApiKey(
				request({ authorization: `Bearer ${PERSONAL_KEY}` }),
				"anthropic",
				verify,
			),
		).toEqual({ status: "rejected" });
		expect(verify).not.toHaveBeenCalled();
	});

	it("maps database failures to an authentication configuration error", async () => {
		expect(
			await authenticateGatewayApiKey(
				request({ authorization: `Bearer ${PERSONAL_KEY}` }),
				"openai",
				() => {
					throw new Error("private database detail");
				},
			),
		).toEqual({ status: "configuration_error" });
	});
});

function request(headers: HeadersInit): Request {
	return new Request("https://gateway.example/v1/chat/completions", {
		headers,
	});
}
