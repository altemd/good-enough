import { describe, expect, it } from "vitest";

import { createOpenAiErrorBody } from "./openai-errors";

describe("OpenAI authentication errors", () => {
	it("maps the internal rejection reason to the OpenAI invalid-key contract", () => {
		expect(
			createOpenAiErrorBody(
				401,
				"authentication_failed",
				"Authentication failed.",
			),
		).toEqual({
			error: {
				message: "Authentication failed.",
				type: "invalid_request_error",
				param: null,
				code: "invalid_api_key",
			},
		});
	});
});
