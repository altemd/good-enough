import { describe, expect, it } from "vitest";

import { buildOpenCodeConfigJson } from "./opencode-config";

describe("OpenCode configuration", () => {
	it("builds deterministic complete JSON with an inline key and exact model IDs", () => {
		const result = buildOpenCodeConfigJson({
			apiKey: "ge_personal_selector_private-secret",
			applicationOrigin: "https://good-enough.example",
			modelIds: ["z-model", "a-model", "z-model"],
		});

		expect(JSON.parse(result)).toEqual({
			$schema: "https://opencode.ai/config.json",
			provider: {
				"good-enough": {
					npm: "@ai-sdk/openai-compatible",
					name: "Good Enough",
					options: {
						baseURL: "https://good-enough.example/v1",
						apiKey: "ge_personal_selector_private-secret",
					},
					models: {
						"a-model": { name: "a-model" },
						"z-model": { name: "z-model" },
					},
				},
			},
		});
		expect(result).not.toContain('"model":');
	});

	it("refuses to build a config without a discovered model", () => {
		expect(() =>
			buildOpenCodeConfigJson({
				apiKey: "ge_personal_selector_private-secret",
				applicationOrigin: "https://good-enough.example",
				modelIds: [],
			}),
		).toThrow("At least one model is required.");
	});
});
