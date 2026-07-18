import { describe, expect, it } from "vitest";

import { authenticateConfiguredApiKey } from "./auth.server";

const OPENAI_KEY = "openai-pilot-key-0000000000000001";
const ANTHROPIC_KEY = "anthropic-pilot-key-0000000000001";
const CONFIGURATION = JSON.stringify([
	{ id: "openai-pilot", key: OPENAI_KEY },
	{ id: "anthropic-pilot", key: ANTHROPIC_KEY },
]);

describe("configured API-key authentication", () => {
	it("authenticates OpenAI bearer credentials", () => {
		expect(
			authenticateConfiguredApiKey(
				request({ authorization: `Bearer ${OPENAI_KEY}` }),
				"openai",
				CONFIGURATION,
			),
		).toEqual({ status: "authenticated", principalId: "openai-pilot" });
	});

	it("authenticates Anthropic x-api-key credentials", () => {
		expect(
			authenticateConfiguredApiKey(
				request({ "x-api-key": ANTHROPIC_KEY }),
				"anthropic",
				CONFIGURATION,
			),
		).toEqual({ status: "authenticated", principalId: "anthropic-pilot" });
	});

	it.each([
		["missing", {}],
		["malformed bearer", { authorization: `Token ${OPENAI_KEY}` }],
		["unknown", { authorization: `Bearer ${"x".repeat(48)}` }],
		["wrong protocol header", { "x-api-key": OPENAI_KEY }],
	] as const)("rejects %s OpenAI credentials", (_case, headers) => {
		expect(
			authenticateConfiguredApiKey(request(headers), "openai", CONFIGURATION),
		).toEqual({ status: "rejected" });
	});

	it("rejects an OpenAI bearer credential on the Anthropic route", () => {
		expect(
			authenticateConfiguredApiKey(
				request({ authorization: `Bearer ${ANTHROPIC_KEY}` }),
				"anthropic",
				CONFIGURATION,
			),
		).toEqual({ status: "rejected" });
	});

	it.each([
		["missing", undefined],
		["malformed JSON", "{"],
		["empty list", "[]"],
		["short key", JSON.stringify([{ id: "pilot", key: "short" }])],
		[
			"duplicate principal",
			JSON.stringify([
				{ id: "pilot", key: "a".repeat(32) },
				{ id: "pilot", key: "b".repeat(32) },
			]),
		],
		[
			"duplicate key",
			JSON.stringify([
				{ id: "pilot-a", key: "a".repeat(32) },
				{ id: "pilot-b", key: "a".repeat(32) },
			]),
		],
	] as const)("fails closed for %s configuration", (_case, configuration) => {
		expect(
			authenticateConfiguredApiKey(
				request({ authorization: `Bearer ${OPENAI_KEY}` }),
				"openai",
				configuration,
			),
		).toEqual({ status: "configuration_error" });
	});
});

function request(headers: HeadersInit): Request {
	return new Request("https://gateway.example/v1/chat/completions", {
		headers,
	});
}
