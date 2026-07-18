import { describe, expect, it } from "vitest";

import { createAnthropicErrorBody } from "./anthropic-errors";

describe("Anthropic authentication errors", () => {
	it("maps 401 to the Anthropic authentication-error contract", () => {
		expect(
			createAnthropicErrorBody(
				401,
				"Authentication failed.",
				"request-anthropic-auth",
				true,
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
});
