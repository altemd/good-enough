import { describe, expect, it } from "vitest";

import { createAnthropicErrorBody } from "./anthropic-errors";

describe("Anthropic authentication errors", () => {
	it("maps 401 to the Anthropic authentication-error contract", () => {
		expect(
			createAnthropicErrorBody(
				401,
				"Authentication failed.",
				"request-anthropic-auth",
			),
		).toEqual({
			type: "error",
			error: {
				type: "authentication_error",
				message: "Authentication failed.",
			},
			request_id: "request-anthropic-auth",
		});
	});

	it("omits request IDs from terminal stream errors", () => {
		expect(
			createAnthropicErrorBody(502, "Inference stream ended unexpectedly."),
		).toEqual({
			type: "error",
			error: {
				type: "api_error",
				message: "Inference stream ended unexpectedly.",
			},
		});
	});
});
