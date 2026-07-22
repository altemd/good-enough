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
		const busyRequestId = busy.headers.get("request-id");
		expect(busyRequestId).toBeTruthy();
		expect(busy.headers.get("x-request-id")).toBeNull();
		expect(busy.headers.get("request-id")).toBe(busyRequestId);
		expect(await busy.json()).toEqual({
			type: "error",
			error: {
				type: "rate_limit_error",
				message:
					"Inference capacity is currently in use. Retry the request later.",
			},
			request_id: busyRequestId,
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
