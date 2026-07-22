export interface OpenCodeConfigInput {
	apiKey: string;
	applicationOrigin: string;
	modelIds: string[];
}

export function buildOpenCodeConfigJson({
	apiKey,
	applicationOrigin,
	modelIds,
}: OpenCodeConfigInput) {
	const models = Object.fromEntries(
		[...new Set(modelIds)]
			.sort()
			.map((modelId) => [modelId, { name: modelId }]),
	);
	if (Object.keys(models).length === 0) {
		throw new Error("At least one model is required.");
	}

	return JSON.stringify(
		{
			$schema: "https://opencode.ai/config.json",
			provider: {
				"good-enough": {
					npm: "@ai-sdk/openai-compatible",
					name: "Good Enough",
					options: {
						baseURL: new URL("/v1", applicationOrigin).href,
						apiKey,
					},
					models,
				},
			},
		},
		null,
		2,
	);
}
