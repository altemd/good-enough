import { describe, expect, it, vi } from "vitest";

import { handleOpenAiChatCompletionsRequest } from "./gateway.server";
import {
	createFetchMock,
	createRecorder,
	ENDPOINTS,
	eventStream,
	handleGatewayRequest,
	installGatewayTestHooks,
	postRequest,
	sse,
	steppingClock,
} from "./gateway.test-support";

installGatewayTestHooks();

describe("protocol metadata and privacy", () => {
	it("captures request start before waiting for llama-server", async () => {
		const start = new Date("2026-07-15T10:00:00.000Z");
		const finish = new Date("2026-07-15T10:00:05.000Z");
		const wallClock = vi
			.fn()
			.mockReturnValueOnce(start)
			.mockReturnValue(finish);
		const metadata = createRecorder();
		const response = await handleGatewayRequest(
			new Request("https://gateway.example/v1/models"),
			ENDPOINTS.models,
			{
				fetch: createFetchMock(async () => new Response("{}")).fetch,
				record: metadata.record,
				wallClock,
			},
		);

		await response.text();

		expect(metadata.events[0]?.startedAt).toBe(start.toISOString());
		expect(wallClock).toHaveBeenCalledTimes(1);
	});

	it("extracts OpenAI timing and usage across chunk boundaries", async () => {
		const completionSentinel = "PRIVATE_COMPLETION_SENTINEL";
		const toolSentinel = "PRIVATE_TOOL_ARGUMENT_SENTINEL";
		const createdSentinel = 987654321;
		const choiceIndexSentinel = 765432109;
		const logProbabilitySentinel = -123456.789;
		const toolNumberSentinel = 246813579;
		const roleEvent = sse({
			choices: [{ delta: { role: "assistant" }, index: 0 }],
		});
		const contentEvent = sse({
			created: createdSentinel,
			choices: [
				{
					delta: { content: completionSentinel },
					index: choiceIndexSentinel,
					logprobs: { content: [{ logprob: logProbabilitySentinel }] },
				},
			],
		});
		const toolEvent = sse({
			choices: [
				{
					delta: {
						tool_calls: [
							{
								function: {
									arguments: `${toolSentinel}:${toolNumberSentinel}`,
								},
							},
						],
					},
					index: 0,
				},
			],
		});
		const usageEvent = sse({
			choices: [],
			usage: {
				prompt_tokens: 11,
				completion_tokens: 7,
				total_tokens: 18,
				prompt_tokens_details: { cached_tokens: 5 },
			},
			timings: { prompt_per_second: 42, predicted_per_second: 21 },
		});
		const usageSplit = Math.floor(usageEvent.length / 2);
		const chunks = [
			roleEvent,
			contentEvent,
			toolEvent,
			usageEvent.slice(0, usageSplit),
			usageEvent.slice(usageSplit),
			"data: [DONE]\n\n",
		];
		const fetchMock = createFetchMock(async () => eventStream(chunks));
		const metadata = createRecorder();
		const response = await handleGatewayRequest(
			postRequest(
				"chat/completions",
				'{"messages":[{"content":"PRIVATE_PROMPT_SENTINEL"}]}',
			),
			ENDPOINTS["chat/completions"],
			{
				fetch: fetchMock.fetch,
				now: steppingClock(),
				record: metadata.record,
			},
		);

		expect(await response.text()).toBe(chunks.join(""));
		expect(metadata.events).toHaveLength(1);
		const event = metadata.events[0];
		expect(event?.ttftMs).not.toBeNull();
		expect(event?.ttftMs).toBeGreaterThan(event?.upstreamHeadersMs ?? 0);
		expect(event).toMatchObject({
			inputTokens: 11,
			outputTokens: 7,
			totalTokens: 18,
			cachedTokens: 5,
			promptTokensPerSecond: 42,
			generationTokensPerSecond: 21,
		});
		const serializedMetadata = JSON.stringify(event);
		expect(serializedMetadata).not.toContain("PRIVATE_PROMPT_SENTINEL");
		expect(serializedMetadata).not.toContain(completionSentinel);
		expect(serializedMetadata).not.toContain(toolSentinel);
		expect(serializedMetadata).not.toContain(String(createdSentinel));
		expect(serializedMetadata).not.toContain(String(choiceIndexSentinel));
		expect(serializedMetadata).not.toContain(String(logProbabilitySentinel));
		expect(serializedMetadata).not.toContain(String(toolNumberSentinel));
	});

	it("drops an oversized SSE frame and resumes at the next boundary", async () => {
		const oversizedSentinel = "PRIVATE_OVERSIZED_SENTINEL";
		const oversized = `data: ${oversizedSentinel}${"x".repeat(70 * 1024)}`;
		const usage = sse({
			choices: [],
			usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
		});
		const fetchMock = createFetchMock(async () =>
			eventStream([oversized, "\n", "\n", usage]),
		);
		const metadata = createRecorder();
		const response = await handleGatewayRequest(
			postRequest("chat/completions", "{}"),
			ENDPOINTS["chat/completions"],
			{ fetch: fetchMock.fetch, record: metadata.record },
		);

		await response.text();

		expect(metadata.events[0]).toMatchObject({
			inputTokens: 2,
			outputTokens: 3,
			totalTokens: 5,
		});
		expect(JSON.stringify(metadata.events[0])).not.toContain(oversizedSentinel);
	});

	it("extracts Anthropic usage and ignores structural events for TTFT", async () => {
		const contentSentinel = "PRIVATE_ANTHROPIC_COMPLETION";
		const blockIndexSentinel = 864209753;
		const messageStart = sse(
			{
				type: "message_start",
				message: {
					usage: {
						input_tokens: 8,
						cache_creation_input_tokens: 2,
						cache_read_input_tokens: 4,
					},
				},
			},
			"message_start",
		);
		const ping = sse({ type: "ping" }, "ping");
		const content = sse(
			{
				type: "content_block_delta",
				index: blockIndexSentinel,
				delta: { type: "text_delta", text: contentSentinel },
			},
			"content_block_delta",
		);
		const messageDelta = sse(
			{
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
				usage: { output_tokens: 6 },
			},
			"message_delta",
		);
		const chunks = [messageStart, ping, content, messageDelta];
		const fetchMock = createFetchMock(async () => eventStream(chunks));
		const metadata = createRecorder();
		const response = await handleGatewayRequest(
			postRequest("messages", '{"system":"PRIVATE_ANTHROPIC_PROMPT"}'),
			ENDPOINTS.messages,
			{
				fetch: fetchMock.fetch,
				now: steppingClock(),
				record: metadata.record,
			},
		);

		expect(await response.text()).toBe(chunks.join(""));
		const event = metadata.events[0];
		expect(event?.ttftMs).toBeGreaterThan(event?.upstreamHeadersMs ?? 0);
		expect(event).toMatchObject({
			inputTokens: 14,
			outputTokens: 6,
			totalTokens: 20,
			cachedTokens: 4,
		});
		const serializedMetadata = JSON.stringify(event);
		expect(serializedMetadata).not.toContain("PRIVATE_ANTHROPIC_PROMPT");
		expect(serializedMetadata).not.toContain(contentSentinel);
		expect(serializedMetadata).not.toContain(String(blockIndexSentinel));
	});

	it("emits metadata-only structured stdout from the server adapter", async () => {
		vi.stubEnv("LLAMA_SERVER_URL", "http://127.0.0.1:8080");
		const fetchMock = createFetchMock(async () =>
			eventStream([
				sse({
					choices: [
						{ delta: { content: "PRIVATE_STDOUT_COMPLETION" }, index: 0 },
					],
				}),
			]),
		);
		vi.stubGlobal("fetch", fetchMock.fetch);
		const stdout = vi.spyOn(console, "info").mockImplementation(() => {});
		const response = await handleOpenAiChatCompletionsRequest(
			postRequest(
				"chat/completions",
				'{"messages":[{"content":"PRIVATE_STDOUT_PROMPT"}]}',
			),
		);

		await response.text();

		expect(stdout).toHaveBeenCalledTimes(1);
		const output = String(stdout.mock.calls[0]?.[0]);
		expect(() => JSON.parse(output)).not.toThrow();
		expect(output).not.toContain("PRIVATE_STDOUT_PROMPT");
		expect(output).not.toContain("PRIVATE_STDOUT_COMPLETION");
	});
});
