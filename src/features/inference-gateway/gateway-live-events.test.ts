import { describe, expect, it, vi } from "vitest";

import { createGenerationAdmissionController } from "./admission";
import {
	createFetchMock,
	ENDPOINTS,
	encoder,
	eventStream,
	handleGatewayRequest,
	installGatewayTestHooks,
	postRequest,
	sse,
} from "./gateway.test-support";
import type {
	GatewayLifecycleEvent,
	GatewayLifecycleObserverFactory,
} from "./lifecycle-events";

installGatewayTestHooks();

interface Delivery {
	principalId: string;
	event: GatewayLifecycleEvent;
}

function createEventRecorder() {
	const deliveries: Delivery[] = [];
	const createLifecycleObserver: GatewayLifecycleObserverFactory =
		({ principalId }) =>
		(event) =>
			deliveries.push({ principalId, event });
	return {
		deliveries,
		events() {
			return deliveries.map((delivery) => delivery.event);
		},
		createLifecycleObserver,
	};
}

describe("personal live inference events", () => {
	it("routes one ordered lifecycle to the API-key owner with safe metrics", async () => {
		const recorder = createEventRecorder();
		const principalId = "PRIVATE_PRINCIPAL_SENTINEL";
		const requestId = "request-visible-to-owner";
		const prompt = "PRIVATE_PROMPT_SENTINEL";
		const completion = "PRIVATE_COMPLETION_SENTINEL";
		const toolArguments = "PRIVATE_TOOL_ARGUMENT_SENTINEL";
		const chunks = [
			sse({ choices: [{ delta: { role: "assistant" }, index: 0 }] }),
			sse({ choices: [{ delta: { content: completion }, index: 0 }] }),
			sse({
				choices: [
					{
						delta: {
							tool_calls: [{ function: { arguments: toolArguments } }],
						},
						index: 0,
					},
				],
			}),
			sse({
				choices: [],
				usage: {
					prompt_tokens: 11,
					completion_tokens: 7,
					total_tokens: 18,
					prompt_tokens_details: { cached_tokens: 5 },
				},
				timings: { prompt_per_second: 42, predicted_per_second: 21 },
			}),
		];
		const response = await handleGatewayRequest(
			postRequest(
				"chat/completions",
				JSON.stringify({ messages: [{ content: prompt }] }),
			),
			ENDPOINTS["chat/completions"],
			{
				authenticate: () => ({ status: "authenticated", principalId }),
				createLifecycleObserver: recorder.createLifecycleObserver,
				createRequestId: () => requestId,
				fetch: createFetchMock(async () => eventStream(chunks)).fetch,
			},
		);

		expect(await response.text()).toBe(chunks.join(""));
		const events = recorder.events();
		expect(
			recorder.deliveries.every((item) => item.principalId === principalId),
		).toBe(true);
		expect(events.map((event) => event.type)).toEqual([
			"inference.request_started",
			"inference.admission_decided",
			"inference.first_output",
			"inference.terminal",
		]);
		expect(new Set(events.map((event) => event.requestId))).toEqual(
			new Set([requestId]),
		);
		expect(events[0]).toMatchObject({ requestKind: "generation" });
		expect(events[1]).toMatchObject({
			decision: "admitted",
			capacity: {
				concurrencyLimit: 1,
				activeGenerations: 1,
				queuedGenerations: 0,
			},
		});
		expect(events[2]).toMatchObject({ ttftMs: expect.any(Number) });
		expect(events[3]).toMatchObject({
			result: { outcome: "completed" },
			admissionStatus: "admitted",
			responseStatus: 200,
			upstreamStatus: 200,
			capacity: {
				concurrencyLimit: 1,
				activeGenerations: 0,
				queuedGenerations: 0,
			},
			metrics: {
				inputTokens: 11,
				outputTokens: 7,
				totalTokens: 18,
				cachedTokens: 5,
				promptTokensPerSecond: 42,
				generationTokensPerSecond: 21,
			},
		});
		const serialized = JSON.stringify(events);
		expect(serialized).not.toContain(principalId);
		expect(serialized).not.toContain("/v1/chat/completions");
		expect(serialized).not.toContain(prompt);
		expect(serialized).not.toContain(completion);
		expect(serialized).not.toContain(toolArguments);
	});

	it.each([
		{ name: "rejected credentials", status: "rejected" as const },
		{
			name: "authentication configuration failure",
			status: "configuration_error" as const,
		},
	])("publishes nothing when $name leaves no trusted owner", async ({
		status,
	}) => {
		const recorder = createEventRecorder();
		const response = await handleGatewayRequest(
			postRequest("chat/completions", "{}"),
			ENDPOINTS["chat/completions"],
			{
				authenticate: () => ({ status }),
				createLifecycleObserver: recorder.createLifecycleObserver,
			},
		);

		expect(response.status).toBeGreaterThanOrEqual(400);
		expect(recorder.deliveries).toEqual([]);
	});

	it("publishes capacity rejection after the admission decision", async () => {
		const admission = createGenerationAdmissionController({
			maxQueuedGenerations: 1,
			maxQueuedGenerationsPerPrincipal: 1,
			queueTimeoutMs: 1_000,
		});
		const active = admission.acquire({
			principalId: "active-account",
			signal: new AbortController().signal,
		});
		if (active.status !== "admitted") {
			throw new Error("Expected the test lease to be admitted");
		}
		const queuedCancellation = new AbortController();
		const queued = admission.acquire({
			principalId: "test-account",
			signal: queuedCancellation.signal,
		});
		if (queued.status !== "queued") {
			throw new Error("Expected the test queue to be occupied");
		}
		const recorder = createEventRecorder();
		const response = await handleGatewayRequest(
			postRequest("messages", "PRIVATE_REJECTED_BODY"),
			ENDPOINTS.messages,
			{
				admission,
				createLifecycleObserver: recorder.createLifecycleObserver,
			},
		);

		expect(response.status).toBe(429);
		const requestId = response.headers.get("request-id");
		expect(await response.json()).toEqual({
			type: "error",
			error: {
				type: "rate_limit_error",
				message: "Inference queue capacity is full. Retry the request later.",
			},
			request_id: requestId,
		});
		const events = recorder.events();
		expect(events.map((event) => event.type)).toEqual([
			"inference.request_started",
			"inference.admission_decided",
			"inference.terminal",
		]);
		expect(events[1]).toMatchObject({
			decision: "rejected",
			capacity: { activeGenerations: 1, queuedGenerations: 1 },
		});
		expect(events[2]).toMatchObject({
			result: { outcome: "rejected", reason: "capacity_exceeded" },
			admissionStatus: "rejected",
			capacity: { activeGenerations: 1 },
		});
		expect(JSON.stringify(events)).not.toContain("PRIVATE_REJECTED_BODY");
		queuedCancellation.abort();
		await queued.wait;
		active.lease.release();
	});

	it("publishes queued state and wait time before eventual admission", async () => {
		const admission = createGenerationAdmissionController();
		const active = admission.acquire({
			principalId: "active-account",
			signal: new AbortController().signal,
		});
		if (active.status !== "admitted") {
			throw new Error("Expected an active lease");
		}
		const recorder = createEventRecorder();
		const pendingResponse = handleGatewayRequest(
			postRequest("chat/completions", "PRIVATE_QUEUED_EVENT_BODY"),
			ENDPOINTS["chat/completions"],
			{
				admission,
				createLifecycleObserver: recorder.createLifecycleObserver,
				fetch: createFetchMock(async () => new Response("done")).fetch,
			},
		);
		await vi.waitFor(() => {
			expect(admission.snapshot().queuedGenerations).toBe(1);
		});
		expect(recorder.events().map((event) => event.type)).toEqual([
			"inference.request_started",
			"inference.queued",
		]);
		expect(recorder.events()[1]).toMatchObject({
			capacity: {
				activeGenerations: 1,
				queuedGenerations: 1,
				queueLimit: 64,
				principalQueuedGenerations: 1,
				principalQueueLimit: 8,
			},
		});

		active.lease.release();
		const response = await pendingResponse;
		expect(await response.text()).toBe("done");
		const events = recorder.events();
		expect(events.map((event) => event.type)).toEqual([
			"inference.request_started",
			"inference.queued",
			"inference.admission_decided",
			"inference.terminal",
		]);
		expect(events[2]).toMatchObject({ decision: "admitted" });
		expect(events[3]).toMatchObject({
			admissionStatus: "admitted",
			queueWaitMs: expect.any(Number),
		});
		expect(JSON.stringify(events)).not.toContain("PRIVATE_QUEUED_EVENT_BODY");
	});

	it("publishes first output found in the final unterminated SSE frame", async () => {
		const recorder = createEventRecorder();
		const response = await handleGatewayRequest(
			postRequest("chat/completions", "{}"),
			ENDPOINTS["chat/completions"],
			{
				createLifecycleObserver: recorder.createLifecycleObserver,
				fetch: createFetchMock(async () =>
					eventStream([
						'data: {"choices":[{"delta":{"content":"final"},"index":0}]}',
					]),
				).fetch,
			},
		);

		await response.text();
		expect(recorder.events().map((event) => event.type)).toEqual([
			"inference.request_started",
			"inference.admission_decided",
			"inference.first_output",
			"inference.terminal",
		]);
	});

	it.each([
		{
			name: "wrong method",
			request: new Request("https://gateway.example/v1/messages"),
			endpoint: ENDPOINTS.messages,
			reason: "method_not_allowed",
		},
		{
			name: "unknown route",
			request: new Request("https://gateway.example/v1/private-sentinel"),
			endpoint: null,
			reason: "not_found",
		},
	] as const)("publishes an owned routing rejection for $name", async (testCase) => {
		const recorder = createEventRecorder();
		const response = await handleGatewayRequest(
			testCase.request,
			testCase.endpoint,
			{ createLifecycleObserver: recorder.createLifecycleObserver },
		);

		expect(response.status).toBeGreaterThanOrEqual(400);
		expect(recorder.events().map((event) => event.type)).toEqual([
			"inference.request_started",
			"inference.terminal",
		]);
		expect(recorder.events()[0]?.requestKind).toBe("routing_rejection");
		expect(recorder.events()[1]).toMatchObject({
			result: { outcome: "rejected", reason: testCase.reason },
		});
		expect(JSON.stringify(recorder.events())).not.toContain("private-sentinel");
	});

	it("publishes an owned backend-configuration failure", async () => {
		const recorder = createEventRecorder();
		const response = await handleGatewayRequest(
			postRequest("chat/completions", "{}"),
			ENDPOINTS["chat/completions"],
			{
				createLifecycleObserver: recorder.createLifecycleObserver,
				llamaServerUrl: "https://remote.example",
			},
		);

		expect(response.status).toBe(500);
		expect(recorder.events().at(-1)).toMatchObject({
			type: "inference.terminal",
			result: {
				outcome: "configuration_error",
				stage: "backend_configuration",
			},
		});
	});

	it("classifies upstream connection, error-body, and stream failures", async () => {
		const connectionRecorder = createEventRecorder();
		const connectionResponse = await handleGatewayRequest(
			postRequest("chat/completions", "{}"),
			ENDPOINTS["chat/completions"],
			{
				createLifecycleObserver: connectionRecorder.createLifecycleObserver,
				fetch: createFetchMock(async () => {
					throw new Error("PRIVATE_CONNECTION_FAILURE");
				}).fetch,
			},
		);

		expect(connectionResponse.status).toBe(502);
		expect(connectionRecorder.events().at(-1)).toMatchObject({
			type: "inference.terminal",
			result: { outcome: "upstream_error", stage: "connection" },
		});

		const errorBodyRecorder = createEventRecorder();
		const errorBodyResponse = await handleGatewayRequest(
			postRequest("chat/completions", "{}"),
			ENDPOINTS["chat/completions"],
			{
				createLifecycleObserver: errorBodyRecorder.createLifecycleObserver,
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
			},
		);

		await errorBodyResponse.text();
		expect(errorBodyRecorder.events().at(-1)).toMatchObject({
			type: "inference.terminal",
			result: { outcome: "upstream_error", stage: "error_body" },
		});

		const streamRecorder = createEventRecorder();
		const streamResponse = await handleGatewayRequest(
			postRequest("chat/completions", "{}"),
			ENDPOINTS["chat/completions"],
			{
				createLifecycleObserver: streamRecorder.createLifecycleObserver,
				fetch: createFetchMock(
					async () =>
						new Response(
							new ReadableStream<Uint8Array>({
								start(controller) {
									controller.enqueue(
										encoder.encode(
											sse({
												choices: [{ delta: { content: "safe" }, index: 0 }],
											}),
										),
									);
									controller.error(new Error("PRIVATE_STREAM_FAILURE"));
								},
							}),
							{ headers: { "content-type": "text/event-stream" } },
						),
				).fetch,
			},
		);

		await streamResponse.text();
		expect(streamRecorder.events().at(-1)).toMatchObject({
			type: "inference.terminal",
			result: { outcome: "upstream_error", stage: "stream_body" },
		});
		expect(
			JSON.stringify([
				...connectionRecorder.events(),
				...errorBodyRecorder.events(),
				...streamRecorder.events(),
			]),
		).not.toContain("PRIVATE_");
	});

	it("classifies a conforming upstream error as completed transport", async () => {
		const recorder = createEventRecorder();
		const response = await handleGatewayRequest(
			postRequest("chat/completions", "{}"),
			ENDPOINTS["chat/completions"],
			{
				createLifecycleObserver: recorder.createLifecycleObserver,
				fetch: createFetchMock(
					async () =>
						new Response(
							JSON.stringify({
								error: {
									message: "Known upstream error.",
									type: "server_error",
									param: null,
									code: "server_error",
								},
							}),
							{ status: 503, headers: { "content-type": "application/json" } },
						),
				).fetch,
			},
		);

		expect(response.status).toBe(503);
		await response.text();
		expect(recorder.events().at(-1)).toMatchObject({
			type: "inference.terminal",
			result: { outcome: "completed" },
			responseStatus: 503,
			upstreamStatus: 503,
		});
	});

	it("publishes exactly one terminal event on downstream cancellation", async () => {
		const recorder = createEventRecorder();
		const response = await handleGatewayRequest(
			postRequest("chat/completions", "{}"),
			ENDPOINTS["chat/completions"],
			{
				createLifecycleObserver: recorder.createLifecycleObserver,
				fetch: createFetchMock(
					async () =>
						new Response(
							new ReadableStream<Uint8Array>({
								start(controller) {
									controller.enqueue(encoder.encode("first"));
								},
							}),
						),
				).fetch,
			},
		);

		await response.body?.cancel("test cancellation");
		const terminals = recorder
			.events()
			.filter((event) => event.type === "inference.terminal");
		expect(terminals).toHaveLength(1);
		expect(terminals[0]).toMatchObject({
			type: "inference.terminal",
			result: { outcome: "cancelled" },
		});
	});

	it("keeps inference working when observer creation fails", async () => {
		const response = await handleGatewayRequest(
			postRequest("chat/completions", "{}"),
			ENDPOINTS["chat/completions"],
			{
				createLifecycleObserver() {
					throw new Error("observer setup failed");
				},
				fetch: createFetchMock(async () => new Response("done")).fetch,
			},
		);

		expect(await response.text()).toBe("done");
	});
});
