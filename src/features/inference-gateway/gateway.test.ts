import { afterEach, describe, expect, it, vi } from "vitest";

import { createGenerationAdmissionController } from "./admission";
import {
	handleAnthropicMessagesRequest,
	handleModelsRequest,
	handleOpenAiChatCompletionsRequest,
	handleUnknownV1Request,
} from "./gateway.server";
import {
	type GatewayEndpoint,
	handleGatewayRequest,
	type InferenceRequestMetadata,
} from "./proxy-stream";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ENDPOINTS = {
	"chat/completions": {
		kind: "generation",
		method: "POST",
		path: "/v1/chat/completions",
		protocol: "openai",
	},
	messages: {
		kind: "generation",
		method: "POST",
		path: "/v1/messages",
		protocol: "anthropic",
	},
	models: {
		kind: "discovery",
		method: "GET",
		path: "/v1/models",
		protocol: "none",
	},
} as const satisfies Record<string, GatewayEndpoint>;

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe("endpoint policies", () => {
	it.each([
		["GET", "models"],
		["POST", "chat/completions"],
		["POST", "messages"],
	] as const)("forwards %s /v1/%s", async (method, path) => {
		let upstreamRequest: Request | undefined;
		const fetchMock = createFetchMock(async (request) => {
			upstreamRequest = request;
			return new Response("upstream-response", {
				status: 201,
				headers: { "x-upstream": "preserved" },
			});
		});
		const metadata = createRecorder();
		const body = method === "POST" ? '{"stream":true}' : undefined;
		const request = new Request(`https://gateway.example/v1/${path}?trace=1`, {
			method,
			body,
			headers: {
				accept: "text/event-stream",
				"anthropic-beta": "test-beta",
				"anthropic-version": "2023-06-01",
				authorization: "Bearer gateway-secret",
				cookie: "session=secret",
				"x-api-key": "anthropic-secret",
				"x-forwarded-for": "203.0.113.10",
			},
		});

		const response = await handleGatewayRequest(request, ENDPOINTS[path], {
			fetch: fetchMock.fetch,
			record: metadata.record,
			createRequestId: () => "request-1",
		});

		expect(await response.text()).toBe("upstream-response");
		expect(response.status).toBe(201);
		expect(response.headers.get("x-upstream")).toBe("preserved");
		expect(response.headers.get("x-request-id")).toBe("request-1");
		expect(fetchMock.mock).toHaveBeenCalledTimes(1);
		expect(upstreamRequest?.url).toBe(
			`http://127.0.0.1:8080/v1/${path}?trace=1`,
		);
		expect(upstreamRequest?.headers.get("accept")).toBe("text/event-stream");
		expect(upstreamRequest?.headers.get("anthropic-beta")).toBe("test-beta");
		expect(upstreamRequest?.headers.get("anthropic-version")).toBe(
			"2023-06-01",
		);
		expect(upstreamRequest?.headers.get("authorization")).toBeNull();
		expect(upstreamRequest?.headers.get("cookie")).toBeNull();
		expect(upstreamRequest?.headers.get("x-api-key")).toBeNull();
		expect(upstreamRequest?.headers.get("x-forwarded-for")).toBeNull();
		expect(upstreamRequest?.headers.get("content-length")).toBeNull();
		expect(upstreamRequest?.headers.get("x-request-id")).toBe("request-1");
		if (body) {
			expect(await upstreamRequest?.text()).toBe(body);
		}
		expect(metadata.events).toHaveLength(1);
		expect(metadata.events[0]).toMatchObject({
			outcome: "completed",
			responseStatus: 201,
			upstreamStatus: 201,
			admissionStatus: method === "POST" ? "admitted" : "not_applicable",
		});
	});

	it("rejects unknown paths without contacting llama-server", async () => {
		const fetchMock = createFetchMock(async () => new Response());
		const metadata = createRecorder();
		const response = await handleGatewayRequest(
			new Request("https://gateway.example/v1/slots"),
			null,
			{ fetch: fetchMock.fetch, record: metadata.record },
		);

		expect(response.status).toBe(404);
		expect(fetchMock.mock).not.toHaveBeenCalled();
		expect(metadata.events).toHaveLength(1);
		expect(metadata.events[0]).toMatchObject({
			outcome: "rejected",
			responseStatus: 404,
			upstreamStatus: null,
			rejectionReason: "not_found",
			admissionStatus: "not_applicable",
		});
	});

	it("returns Allow for a known path with the wrong method", async () => {
		const fetchMock = createFetchMock(async () => new Response());
		const metadata = createRecorder();
		const response = await handleGatewayRequest(
			new Request("https://gateway.example/v1/messages", { method: "GET" }),
			ENDPOINTS.messages,
			{ fetch: fetchMock.fetch, record: metadata.record },
		);

		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("POST");
		expect(fetchMock.mock).not.toHaveBeenCalled();
		expect(metadata.events[0]).toMatchObject({
			responseStatus: 405,
			upstreamStatus: null,
			rejectionReason: "method_not_allowed",
			admissionStatus: "not_applicable",
		});
	});
});

describe("generation admission", () => {
	it("shares one slot across protocols while discovery bypasses admission", async () => {
		const admission = createGenerationAdmissionController();
		const upstreamCancel = vi.fn();
		const fetchMock = createFetchMock(async (request) => {
			if (request.url.endsWith("/v1/models")) {
				return new Response('{"data":[]}');
			}

			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(encoder.encode("first"));
					},
					cancel: upstreamCancel,
				}),
				{ headers: { "content-type": "text/event-stream" } },
			);
		});
		const first = await handleGatewayRequest(
			postRequest("chat/completions", "{}"),
			ENDPOINTS["chat/completions"],
			{ admission, fetch: fetchMock.fetch },
		);

		const busyMetadata = createRecorder();
		const busy = await handleGatewayRequest(
			postRequest("messages", "PRIVATE_BUSY_PROMPT"),
			ENDPOINTS.messages,
			{ admission, fetch: fetchMock.fetch, record: busyMetadata.record },
		);
		const models = await handleGatewayRequest(
			new Request("https://gateway.example/v1/models"),
			ENDPOINTS.models,
			{ admission, fetch: fetchMock.fetch },
		);

		expect(busy.status).toBe(429);
		expect(busy.headers.get("retry-after")).toBeNull();
		expect(await busy.json()).toEqual({
			error: {
				type: "capacity_exceeded",
				message:
					"Inference capacity is currently in use. Retry the request later.",
			},
		});
		expect(await models.text()).toBe('{"data":[]}');
		expect(fetchMock.mock).toHaveBeenCalledTimes(2);
		expect(busyMetadata.events).toHaveLength(1);
		expect(busyMetadata.events[0]).toMatchObject({
			responseStatus: 429,
			upstreamStatus: null,
			outcome: "rejected",
			rejectionReason: "capacity_exceeded",
			admissionStatus: "rejected",
			concurrencyLimit: 1,
			activeGenerationsAtAdmission: 1,
			queuedGenerationsAtAdmission: 0,
		});
		expect(JSON.stringify(busyMetadata.events[0])).not.toContain(
			"PRIVATE_BUSY_PROMPT",
		);

		await first.body?.cancel("release the active slot");
		expect(upstreamCancel).toHaveBeenCalledTimes(1);
		expect(admission.snapshot().activeGenerations).toBe(0);
	});

	it("holds capacity until the upstream response body finishes", async () => {
		const admission = createGenerationAdmissionController();
		let upstreamController:
			| ReadableStreamDefaultController<Uint8Array>
			| undefined;
		const fetchMock = createFetchMock(
			async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							upstreamController = controller;
							controller.enqueue(encoder.encode("first"));
						},
					}),
					{ headers: { "content-type": "text/event-stream" } },
				),
		);
		const response = await handleGatewayRequest(
			postRequest("chat/completions", "{}"),
			ENDPOINTS["chat/completions"],
			{ admission, fetch: fetchMock.fetch },
		);
		const reader = response.body?.getReader();

		expect(admission.snapshot().activeGenerations).toBe(1);
		expect(decoder.decode((await reader?.read())?.value)).toBe("first");
		expect(admission.snapshot().activeGenerations).toBe(1);

		upstreamController?.close();
		expect((await reader?.read())?.done).toBe(true);
		expect(admission.snapshot().activeGenerations).toBe(0);
	});

	it("does not let routing rejections consume or depend on capacity", async () => {
		const admission = createGenerationAdmissionController();
		const active = admission.tryAcquire();
		if (!active.admitted) {
			throw new Error("Expected the test lease to be admitted");
		}
		const fetchMock = createFetchMock(async () => new Response());

		const wrongMethod = await handleGatewayRequest(
			new Request("https://gateway.example/v1/messages"),
			ENDPOINTS.messages,
			{ admission, fetch: fetchMock.fetch },
		);
		const unknown = await handleGatewayRequest(
			new Request("https://gateway.example/v1/slots"),
			null,
			{ admission, fetch: fetchMock.fetch },
		);

		expect(wrongMethod.status).toBe(405);
		expect(unknown.status).toBe(404);
		expect(fetchMock.mock).not.toHaveBeenCalled();
		expect(admission.snapshot().activeGenerations).toBe(1);
		active.lease.release();
	});

	it("releases capacity after a bodyless response", async () => {
		const admission = createGenerationAdmissionController();
		const response = await handleGatewayRequest(
			postRequest("messages", "{}"),
			ENDPOINTS.messages,
			{
				admission,
				fetch: createFetchMock(async () => new Response(null, { status: 204 }))
					.fetch,
			},
		);

		expect(response.status).toBe(204);
		expect(admission.snapshot().activeGenerations).toBe(0);
	});

	it("releases capacity after an upstream body error", async () => {
		const admission = createGenerationAdmissionController();
		const response = await handleGatewayRequest(
			postRequest("messages", "{}"),
			ENDPOINTS.messages,
			{
				admission,
				fetch: createFetchMock(
					async () =>
						new Response(
							new ReadableStream<Uint8Array>({
								pull(controller) {
									controller.error(new Error("upstream body failed"));
								},
							}),
						),
				).fetch,
			},
		);

		await expect(response.text()).rejects.toThrow("upstream body failed");
		expect(admission.snapshot().activeGenerations).toBe(0);
	});

	it("releases capacity before invoking a failing metadata recorder", async () => {
		const admission = createGenerationAdmissionController();
		const response = await handleGatewayRequest(
			postRequest("messages", "{}"),
			ENDPOINTS.messages,
			{
				admission,
				fetch: createFetchMock(async () => new Response("done")).fetch,
				record() {
					throw new Error("recorder failed");
				},
			},
		);

		expect(await response.text()).toBe("done");
		expect(admission.snapshot().activeGenerations).toBe(0);
		const nextDecision = admission.tryAcquire();
		expect(nextDecision.admitted).toBe(true);
		if (nextDecision.admitted) {
			nextDecision.lease.release();
		}
	});
});

describe("server endpoint adapters", () => {
	it.each([
		["GET", "models", handleModelsRequest],
		["POST", "chat/completions", handleOpenAiChatCompletionsRequest],
		["POST", "messages", handleAnthropicMessagesRequest],
	] as const)("fixes %s /v1/%s to its upstream path", async (method, path, handler) => {
		let upstreamRequest: Request | undefined;
		const fetchMock = createFetchMock(async (request) => {
			upstreamRequest = request;
			return new Response("ok");
		});
		vi.stubGlobal("fetch", fetchMock.fetch);
		vi.spyOn(console, "info").mockImplementation(() => {});
		const response = await handler(
			new Request(`https://gateway.example/v1/${path}?trace=adapter`, {
				method,
				body: method === "POST" ? "{}" : undefined,
			}),
		);

		expect(await response.text()).toBe("ok");
		expect(upstreamRequest?.url).toBe(
			`http://127.0.0.1:8080/v1/${path}?trace=adapter`,
		);
	});

	it("rejects the catch-all without invoking upstream fetch", async () => {
		const fetchMock = createFetchMock(async () => new Response());
		vi.stubGlobal("fetch", fetchMock.fetch);
		vi.spyOn(console, "info").mockImplementation(() => {});

		const response = await handleUnknownV1Request(
			new Request("https://gateway.example/v1/slots"),
		);

		expect(response.status).toBe(404);
		expect(fetchMock.mock).not.toHaveBeenCalled();
	});

	it("rejects HEAD /v1/models instead of falling back to GET", async () => {
		const fetchMock = createFetchMock(async () => new Response());
		vi.stubGlobal("fetch", fetchMock.fetch);
		vi.spyOn(console, "info").mockImplementation(() => {});

		const response = await handleModelsRequest(
			new Request("https://gateway.example/v1/models", { method: "HEAD" }),
		);

		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("GET");
		expect(fetchMock.mock).not.toHaveBeenCalled();
	});
});

describe("shared streaming transport", () => {
	it("delivers the first chunk while upstream remains open", async () => {
		let upstreamController:
			| ReadableStreamDefaultController<Uint8Array>
			| undefined;
		const upstreamBody = new ReadableStream<Uint8Array>({
			start(controller) {
				upstreamController = controller;
				controller.enqueue(encoder.encode("first"));
			},
		});
		const fetchMock = createFetchMock(
			async () =>
				new Response(upstreamBody, {
					headers: { "content-type": "text/event-stream" },
				}),
		);
		const response = await handleGatewayRequest(
			postRequest("chat/completions", "{}"),
			ENDPOINTS["chat/completions"],
			{ fetch: fetchMock.fetch },
		);
		const reader = response.body?.getReader();

		const first = await reader?.read();
		expect(decoder.decode(first?.value)).toBe("first");
		expect(first?.done).toBe(false);
		expect(response.headers.get("cache-control")).toBe("no-cache");
		expect(response.headers.get("x-accel-buffering")).toBe("no");

		upstreamController?.enqueue(encoder.encode("second"));
		upstreamController?.close();
		const second = await reader?.read();
		expect(decoder.decode(second?.value)).toBe("second");
		expect((await reader?.read())?.done).toBe(true);
	});

	it("preserves SSE cache and buffering headers supplied upstream", async () => {
		const fetchMock = createFetchMock(
			async () =>
				new Response("data: [DONE]\n\n", {
					headers: {
						"cache-control": "private, no-store",
						"content-type": "text/event-stream",
						"x-accel-buffering": "upstream-value",
					},
				}),
		);
		const response = await handleGatewayRequest(
			postRequest("chat/completions", "{}"),
			ENDPOINTS["chat/completions"],
			{ fetch: fetchMock.fetch },
		);

		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(response.headers.get("x-accel-buffering")).toBe("upstream-value");
		await response.text();
	});

	it.each([429, 503])("preserves upstream %s responses", async (status) => {
		const errorBody = `upstream-${status}`;
		const fetchMock = createFetchMock(
			async () =>
				new Response(errorBody, {
					status,
					headers: {
						"content-type": "application/json",
						"retry-after": "7",
					},
				}),
		);
		const metadata = createRecorder();
		const response = await handleGatewayRequest(
			postRequest("chat/completions", "{}"),
			ENDPOINTS["chat/completions"],
			{ fetch: fetchMock.fetch, record: metadata.record },
		);

		expect(response.status).toBe(status);
		expect(response.headers.get("retry-after")).toBe("7");
		expect(await response.text()).toBe(errorBody);
		expect(metadata.events[0]).toMatchObject({
			responseStatus: status,
			upstreamStatus: status,
			rejectionReason: null,
			admissionStatus: "admitted",
		});
	});

	it("returns a sanitized 502 when llama-server is unavailable", async () => {
		const admission = createGenerationAdmissionController();
		const fetchMock = createFetchMock(async () => {
			throw new Error("connection details that must not escape");
		});
		const metadata = createRecorder();
		const response = await handleGatewayRequest(
			postRequest("messages", "{}"),
			ENDPOINTS.messages,
			{ admission, fetch: fetchMock.fetch, record: metadata.record },
		);
		const body = await response.text();

		expect(response.status).toBe(502);
		expect(body).toContain("Inference backend is unavailable.");
		expect(body).not.toContain("connection details");
		expect(metadata.events).toHaveLength(1);
		expect(metadata.events[0]).toMatchObject({
			outcome: "upstream_error",
			responseStatus: 502,
			upstreamStatus: null,
			admissionStatus: "admitted",
		});
		expect(admission.snapshot().activeGenerations).toBe(0);
	});

	it.each([
		"http://192.168.1.20:8080",
		"http://user:password@127.0.0.1:8080",
		"http://127.0.0.1:8080/prefix",
	])("rejects unsafe llama-server origin %s", async (llamaServerUrl) => {
		const fetchMock = createFetchMock(async () => new Response());
		const response = await handleGatewayRequest(
			new Request("https://gateway.example/v1/models"),
			ENDPOINTS.models,
			{ fetch: fetchMock.fetch, llamaServerUrl },
		);

		expect(response.status).toBe(500);
		expect(fetchMock.mock).not.toHaveBeenCalled();
		expect(await response.text()).not.toContain(llamaServerUrl);
	});

	it("validates generation configuration before acquiring capacity", async () => {
		const admission = createGenerationAdmissionController();
		const fetchMock = createFetchMock(async () => new Response());
		const metadata = createRecorder();
		const response = await handleGatewayRequest(
			postRequest("messages", "PRIVATE_INVALID_CONFIGURATION_PROMPT"),
			ENDPOINTS.messages,
			{
				admission,
				fetch: fetchMock.fetch,
				llamaServerUrl: "http://192.168.1.20:8080",
				record: metadata.record,
			},
		);

		expect(response.status).toBe(500);
		expect(fetchMock.mock).not.toHaveBeenCalled();
		expect(admission.snapshot().activeGenerations).toBe(0);
		expect(metadata.events).toHaveLength(1);
		expect(metadata.events[0]).toMatchObject({
			outcome: "configuration_error",
			responseStatus: 500,
			upstreamStatus: null,
			admissionStatus: "not_applicable",
			concurrencyLimit: null,
		});
		expect(JSON.stringify(metadata.events[0])).not.toContain(
			"PRIVATE_INVALID_CONFIGURATION_PROMPT",
		);
	});

	it("aborts upstream when the incoming request is aborted", async () => {
		const admission = createGenerationAdmissionController();
		const clientAbort = new AbortController();
		let upstreamSignal: AbortSignal | undefined;
		const fetchMock = createFetchMock(
			(request) =>
				new Promise<Response>((_resolve, reject) => {
					upstreamSignal = request.signal;
					request.signal.addEventListener("abort", () => {
						reject(new DOMException("Aborted", "AbortError"));
					});
				}),
		);
		const metadata = createRecorder();
		const responsePromise = handleGatewayRequest(
			new Request("https://gateway.example/v1/messages", {
				method: "POST",
				body: "{}",
				signal: clientAbort.signal,
			}),
			ENDPOINTS.messages,
			{ admission, fetch: fetchMock.fetch, record: metadata.record },
		);

		clientAbort.abort("client disconnected");
		const response = await responsePromise;

		expect(response.status).toBe(499);
		expect(upstreamSignal?.aborted).toBe(true);
		expect(metadata.events).toHaveLength(1);
		expect(metadata.events[0]).toMatchObject({
			outcome: "cancelled",
			responseStatus: 499,
			upstreamStatus: null,
		});
		expect(admission.snapshot().activeGenerations).toBe(0);
	});

	it("aborts fetch and cancels upstream when the downstream reader cancels", async () => {
		const admission = createGenerationAdmissionController();
		const upstreamCancel = vi.fn();
		let upstreamSignal: AbortSignal | undefined;
		const upstreamBody = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode("first"));
			},
			cancel: upstreamCancel,
		});
		const fetchMock = createFetchMock(async (request) => {
			upstreamSignal = request.signal;
			return new Response(upstreamBody, {
				headers: { "content-type": "text/event-stream" },
			});
		});
		const metadata = createRecorder();
		const response = await handleGatewayRequest(
			postRequest("chat/completions", "{}"),
			ENDPOINTS["chat/completions"],
			{ admission, fetch: fetchMock.fetch, record: metadata.record },
		);
		const reader = response.body?.getReader();

		await reader?.read();
		await reader?.cancel("downstream disconnected");

		expect(upstreamSignal?.aborted).toBe(true);
		expect(upstreamCancel).toHaveBeenCalledTimes(1);
		expect(metadata.events).toHaveLength(1);
		expect(metadata.events[0]).toMatchObject({
			outcome: "cancelled",
			responseStatus: 200,
			upstreamStatus: 200,
		});
		expect(admission.snapshot().activeGenerations).toBe(0);
	});
});

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

function createFetchMock(handler: (request: Request) => Promise<Response>) {
	const mock = vi.fn(handler);
	const fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		const request =
			input instanceof Request && init === undefined
				? input
				: new Request(input, init);
		return mock(request);
	}) as typeof globalThis.fetch;

	return { fetch, mock };
}

function createRecorder() {
	const events: Array<InferenceRequestMetadata> = [];
	return {
		events,
		record: (metadata: InferenceRequestMetadata) => events.push(metadata),
	};
}

function postRequest(path: string, body: string): Request {
	return new Request(`https://gateway.example/v1/${path}`, {
		method: "POST",
		body,
		headers: { "content-type": "application/json" },
	});
}

function eventStream(chunks: ReadonlyArray<string>): Response {
	let index = 0;
	return new Response(
		new ReadableStream<Uint8Array>({
			pull(controller) {
				const chunk = chunks[index];
				index += 1;
				if (chunk === undefined) {
					controller.close();
					return;
				}
				controller.enqueue(encoder.encode(chunk));
			},
		}),
		{ headers: { "content-type": "text/event-stream; charset=utf-8" } },
	);
}

function sse(payload: unknown, event?: string): string {
	return `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(payload)}\n\n`;
}

function steppingClock() {
	let now = 0;
	return () => {
		now += 10;
		return now;
	};
}
