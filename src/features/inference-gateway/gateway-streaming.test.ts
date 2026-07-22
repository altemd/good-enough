import { describe, expect, it, vi } from "vitest";

import { createGenerationAdmissionController } from "./admission";
import {
	createFetchMock,
	createRecorder,
	decoder,
	ENDPOINTS,
	encoder,
	handleGatewayRequest,
	installGatewayTestHooks,
	postRequest,
} from "./gateway.test-support";

installGatewayTestHooks();

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

	it.each([
		[
			"chat/completions",
			ENDPOINTS["chat/completions"],
			'data: {"choices":[{"delta":{"content":"partial-openai"}}]}\n\n',
			'event: error\ndata: {"error":{"message":"Inference stream ended unexpectedly.","type":"server_error","param":null,"code":"upstream_stream_error"}}\n\n',
		],
		[
			"messages",
			ENDPOINTS.messages,
			'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"partial-anthropic"}}\n\n',
			'event: error\ndata: {"type":"error","error":{"type":"api_error","message":"Inference stream ended unexpectedly."}}\n\n',
		],
	] as const)("appends a protocol error when the %s SSE body fails", async (path, endpoint, successfulFrame, expectedErrorFrame) => {
		const admission = createGenerationAdmissionController();
		const metadata = createRecorder();
		let pullCount = 0;
		const fetchMock = createFetchMock(
			async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						pull(controller) {
							pullCount += 1;
							if (pullCount === 1) {
								controller.enqueue(encoder.encode(successfulFrame));
								return;
							}
							controller.error(new Error("PRIVATE_UPSTREAM_STREAM_FAILURE"));
						},
					}),
					{ headers: { "content-type": "text/event-stream" } },
				),
		);
		const response = await handleGatewayRequest(
			postRequest(path, "{}"),
			endpoint,
			{
				admission,
				fetch: fetchMock.fetch,
				record: metadata.record,
			},
		);

		const body = await response.text();

		expect(body).toBe(`${successfulFrame}\n\n${expectedErrorFrame}`);
		expect(body).not.toContain("PRIVATE_UPSTREAM_STREAM_FAILURE");
		expect(metadata.events).toHaveLength(1);
		expect(metadata.events[0]).toMatchObject({
			outcome: "upstream_error",
			responseStatus: 200,
			upstreamStatus: 200,
			admissionStatus: "admitted",
		});
		expect(metadata.events[0]?.ttftMs).not.toBeNull();
		expect(JSON.stringify(metadata.events[0])).not.toContain(
			"PRIVATE_UPSTREAM_STREAM_FAILURE",
		);
		expect(admission.snapshot().activeGenerations).toBe(0);
	});

	it.each([
		429, 503,
	])("sanitizes nonconforming upstream %s responses", async (status) => {
		const errorBody = `PRIVATE_UPSTREAM_ERROR_${status}`;
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
		const responseBody = await response.text();
		expect(responseBody).toContain("Inference backend returned an error.");
		expect(responseBody).not.toContain(errorBody);
		expect(metadata.events[0]).toMatchObject({
			responseStatus: status,
			upstreamStatus: status,
			rejectionReason: null,
			admissionStatus: "admitted",
		});
		expect(JSON.stringify(metadata.events[0])).not.toContain(errorBody);
	});

	it("sanitizes a failed upstream error body and releases capacity", async () => {
		const admission = createGenerationAdmissionController();
		const metadata = createRecorder();
		const response = await handleGatewayRequest(
			postRequest("chat/completions", "{}"),
			ENDPOINTS["chat/completions"],
			{
				admission,
				fetch: createFetchMock(
					async () =>
						new Response(
							new ReadableStream<Uint8Array>({
								pull(controller) {
									controller.error(new Error("PRIVATE_ERROR_BODY_FAILURE"));
								},
							}),
							{ status: 503, headers: { "content-type": "application/json" } },
						),
				).fetch,
				record: metadata.record,
			},
		);
		const body = await response.text();

		expect(response.status).toBe(503);
		expect(body).toContain("Inference backend returned an error.");
		expect(body).not.toContain("PRIVATE_ERROR_BODY_FAILURE");
		expect(metadata.events).toHaveLength(1);
		expect(metadata.events[0]).toMatchObject({
			outcome: "upstream_error",
			responseStatus: 503,
			upstreamStatus: 503,
			admissionStatus: "admitted",
		});
		expect(admission.snapshot().activeGenerations).toBe(0);
	});

	it("passes through a conforming OpenAI upstream error", async () => {
		const errorBody = JSON.stringify({
			error: {
				message: "Known upstream error.",
				type: "server_error",
				param: null,
				code: "server_error",
			},
		});
		const response = await handleGatewayRequest(
			postRequest("chat/completions", "{}"),
			ENDPOINTS["chat/completions"],
			{
				fetch: createFetchMock(
					async () =>
						new Response(errorBody, {
							status: 503,
							statusText: "Backend Busy",
							headers: {
								"content-type": "application/json",
								"retry-after": "5",
							},
						}),
				).fetch,
			},
		);

		expect(response.status).toBe(503);
		expect(response.statusText).toBe("Backend Busy");
		expect(response.headers.get("retry-after")).toBe("5");
		expect(await response.text()).toBe(errorBody);
	});

	it("passes through Anthropic errors only with the gateway request ID", async () => {
		const errorBody = JSON.stringify({
			type: "error",
			error: { type: "overloaded_error", message: "Known overload." },
			request_id: "anthropic-upstream-request",
		});
		const response = await handleGatewayRequest(
			postRequest("messages", "{}"),
			ENDPOINTS.messages,
			{
				createRequestId: () => "anthropic-upstream-request",
				fetch: createFetchMock(
					async () =>
						new Response(errorBody, {
							status: 529,
							headers: { "content-type": "application/json" },
						}),
				).fetch,
			},
		);

		expect(response.headers.get("x-request-id")).toBeNull();
		expect(response.headers.get("request-id")).toBe(
			"anthropic-upstream-request",
		);
		expect(await response.text()).toBe(errorBody);
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
			{
				admission,
				fetch: fetchMock.fetch,
				record: metadata.record,
				createRequestId: () => "connection-request",
			},
		);

		expect(response.status).toBe(502);
		expect(response.headers.get("x-request-id")).toBeNull();
		expect(response.headers.get("request-id")).toBe("connection-request");
		expect(await response.json()).toEqual({
			type: "error",
			error: {
				type: "api_error",
				message: "Inference backend is unavailable.",
			},
			request_id: "connection-request",
		});
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
			{
				fetch: fetchMock.fetch,
				llamaServerUrl,
				createRequestId: () => "models-configuration-request",
			},
		);

		expect(response.status).toBe(500);
		expect(fetchMock.mock).not.toHaveBeenCalled();
		expect(await response.json()).toEqual({
			error: {
				message: "Inference backend configuration is invalid.",
				type: "server_error",
				param: null,
				code: "configuration_error",
			},
		});
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
				createRequestId: () => "messages-configuration-request",
			},
		);

		expect(response.status).toBe(500);
		expect(response.headers.get("request-id")).toBe(
			"messages-configuration-request",
		);
		expect(await response.json()).toEqual({
			type: "error",
			error: {
				type: "api_error",
				message: "Inference backend configuration is invalid.",
			},
			request_id: "messages-configuration-request",
		});
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
		const fetchMock = createFetchMock(
			(request) =>
				new Promise<Response>((_resolve, reject) => {
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
		const requestId = response.headers.get("request-id");
		expect(requestId).toBeTruthy();
		expect(response.headers.get("x-request-id")).toBeNull();
		expect(response.headers.get("request-id")).toBe(requestId);
		expect(await response.json()).toEqual({
			type: "error",
			error: {
				type: "invalid_request_error",
				message: "Request was cancelled before a response was available.",
			},
			request_id: requestId,
		});
		expect(fetchMock.mock).not.toHaveBeenCalled();
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
