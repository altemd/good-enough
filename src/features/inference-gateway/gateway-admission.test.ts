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

describe("generation admission", () => {
	it("queues generation across protocols while discovery bypasses admission", async () => {
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

		const queuedMetadata = createRecorder();
		const queuedResponse = handleGatewayRequest(
			postRequest("messages", "PRIVATE_BUSY_PROMPT"),
			ENDPOINTS.messages,
			{ admission, fetch: fetchMock.fetch, record: queuedMetadata.record },
		);
		await vi.waitFor(() => {
			expect(admission.snapshot().queuedGenerations).toBe(1);
		});
		const models = await handleGatewayRequest(
			new Request("https://gateway.example/v1/models"),
			ENDPOINTS.models,
			{ admission, fetch: fetchMock.fetch },
		);

		expect(await models.text()).toBe('{"data":[]}');
		expect(fetchMock.mock).toHaveBeenCalledTimes(2);

		await first.body?.cancel("release the active slot");
		expect(upstreamCancel).toHaveBeenCalledTimes(1);
		const queued = await queuedResponse;
		expect(queued.status).toBe(200);
		expect(queued.headers.get("request-id")).toBeTruthy();
		expect(fetchMock.mock).toHaveBeenCalledTimes(3);
		await queued.body?.cancel("finish queued request");
		expect(queuedMetadata.events).toHaveLength(1);
		expect(queuedMetadata.events[0]).toMatchObject({
			responseStatus: 200,
			upstreamStatus: 200,
			outcome: "cancelled",
			rejectionReason: null,
			admissionStatus: "admitted",
			concurrencyLimit: 1,
			activeGenerationsAtAdmission: 1,
			queuedGenerationsAtAdmission: 0,
			queueWaitMs: expect.any(Number),
		});
		expect(JSON.stringify(queuedMetadata.events[0])).not.toContain(
			"PRIVATE_BUSY_PROMPT",
		);
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

	it("does not read or forward a queued body before capacity is available", async () => {
		const admission = createGenerationAdmissionController();
		const active = admission.acquire({
			principalId: "active-account",
			signal: new AbortController().signal,
		});
		if (active.status !== "admitted") {
			throw new Error("Expected an active lease");
		}
		const request = new Request("https://gateway.example/v1/chat/completions", {
			method: "POST",
			body: new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(encoder.encode("PRIVATE_QUEUED_BODY"));
					controller.close();
				},
			}),
			duplex: "half",
		} as RequestInit & { duplex: "half" });
		const fetchMock = createFetchMock(async (upstreamRequest) => {
			expect(await upstreamRequest.text()).toBe("PRIVATE_QUEUED_BODY");
			return new Response("done");
		});

		const pendingResponse = handleGatewayRequest(
			request,
			ENDPOINTS["chat/completions"],
			{ admission, fetch: fetchMock.fetch },
		);
		await vi.waitFor(() => {
			expect(admission.snapshot().queuedGenerations).toBe(1);
		});
		expect(request.bodyUsed).toBe(false);
		expect(fetchMock.mock).not.toHaveBeenCalled();

		active.lease.release();
		const response = await pendingResponse;
		expect(await response.text()).toBe("done");
		expect(fetchMock.mock).toHaveBeenCalledTimes(1);
		expect(admission.snapshot().activeGenerations).toBe(0);
	});

	it("returns a protocol-compatible 429 when queue waiting times out", async () => {
		vi.useFakeTimers();
		try {
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
				throw new Error("Expected an active lease");
			}
			const request = postRequest("chat/completions", "PRIVATE_TIMEOUT_BODY");
			const metadata = createRecorder();
			const fetchMock = createFetchMock(async () => new Response());
			const pendingResponse = handleGatewayRequest(
				request,
				ENDPOINTS["chat/completions"],
				{ admission, fetch: fetchMock.fetch, record: metadata.record },
			);
			await vi.advanceTimersByTimeAsync(1_000);
			const response = await pendingResponse;

			expect(response.status).toBe(429);
			expect(response.headers.get("retry-after")).toBeNull();
			expect(await response.json()).toMatchObject({
				error: {
					type: "rate_limit_error",
					code: "queue_timeout",
				},
			});
			expect(request.bodyUsed).toBe(false);
			expect(fetchMock.mock).not.toHaveBeenCalled();
			expect(metadata.events[0]).toMatchObject({
				responseStatus: 429,
				upstreamStatus: null,
				outcome: "rejected",
				rejectionReason: "queue_timeout",
				admissionStatus: "rejected",
				queueWaitMs: expect.any(Number),
			});
			active.lease.release();
		} finally {
			vi.useRealTimers();
		}
	});

	it("returns a sanitized configuration error before queueing", async () => {
		const admission = createGenerationAdmissionController();
		const fetchMock = createFetchMock(async () => new Response());
		const response = await handleGatewayRequest(
			postRequest("messages", "PRIVATE_CONFIG_BODY"),
			ENDPOINTS.messages,
			{
				admission,
				admissionConfigurationError: true,
				fetch: fetchMock.fetch,
			},
		);

		expect(response.status).toBe(500);
		expect(await response.json()).toMatchObject({
			type: "error",
			error: { type: "api_error" },
		});
		expect(fetchMock.mock).not.toHaveBeenCalled();
		expect(admission.snapshot().queuedGenerations).toBe(0);
	});

	it("does not let routing rejections consume or depend on capacity", async () => {
		const admission = createGenerationAdmissionController();
		const active = admission.acquire({
			principalId: "test-account",
			signal: new AbortController().signal,
		});
		if (active.status !== "admitted") {
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

	it("releases capacity even when the lifecycle observer fails", async () => {
		const admission = createGenerationAdmissionController();
		const response = await handleGatewayRequest(
			postRequest("messages", "{}"),
			ENDPOINTS.messages,
			{
				admission,
				fetch: createFetchMock(async () => new Response("done")).fetch,
				createLifecycleObserver() {
					return () => {
						throw new Error("observer failed");
					};
				},
			},
		);

		expect(await response.text()).toBe("done");
		expect(admission.snapshot().activeGenerations).toBe(0);
		const nextDecision = admission.acquire({
			principalId: "test-account",
			signal: new AbortController().signal,
		});
		expect(nextDecision.status).toBe("admitted");
		if (nextDecision.status === "admitted") {
			nextDecision.lease.release();
		}
	});
});
