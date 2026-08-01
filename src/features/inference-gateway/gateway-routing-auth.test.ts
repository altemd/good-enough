import { describe, expect, it, vi } from "vitest";

import { createGenerationAdmissionController } from "./admission";
import {
	handleAnthropicMessagesRequest,
	handleModelsRequest,
	handleOpenAiChatCompletionsRequest,
	handleUnknownV1Request,
} from "./gateway.server";
import {
	createFetchMock,
	createRecorder,
	ENDPOINTS,
	encoder,
	handleGatewayRequest,
	installGatewayTestHooks,
	TEST_API_KEY,
} from "./gateway.test-support";

installGatewayTestHooks();

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
		expect(response.headers.get("x-request-id")).toBe(
			path === "messages" ? null : "request-1",
		);
		expect(response.headers.get("request-id")).toBe(
			path === "messages" ? "request-1" : null,
		);
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
			authenticationStatus: "authenticated",
			admissionStatus: method === "POST" ? "admitted" : "not_applicable",
		});
	});

	it("preserves a client-provided Content-Length for the upstream stream", async () => {
		const body = '{"stream":true}';
		const contentLength = String(encoder.encode(body).byteLength);
		let upstreamRequest: Request | undefined;
		const fetchMock = createFetchMock(async (request) => {
			upstreamRequest = request;
			return new Response("upstream-response");
		});
		const request = new Request("https://gateway.example/v1/chat/completions", {
			method: "POST",
			body,
			headers: {
				authorization: `Bearer ${TEST_API_KEY}`,
				"content-length": contentLength,
				"content-type": "application/json",
			},
		});

		const response = await handleGatewayRequest(
			request,
			ENDPOINTS["chat/completions"],
			{ fetch: fetchMock.fetch },
		);

		expect(await response.text()).toBe("upstream-response");
		expect(upstreamRequest?.headers.get("content-length")).toBe(contentLength);
		expect(await upstreamRequest?.text()).toBe(body);
	});

	it("rejects unknown paths without contacting llama-server", async () => {
		const fetchMock = createFetchMock(async () => new Response());
		const metadata = createRecorder();
		const response = await handleGatewayRequest(
			new Request("https://gateway.example/v1/slots"),
			null,
			{
				fetch: fetchMock.fetch,
				record: metadata.record,
				createRequestId: () => "unknown-request",
			},
		);

		expect(response.status).toBe(404);
		expect(response.headers.get("x-request-id")).toBe("unknown-request");
		expect(await response.json()).toEqual({
			error: {
				message: "Endpoint not found.",
				type: "invalid_request_error",
				param: null,
				code: "not_found",
			},
		});
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
			{
				fetch: fetchMock.fetch,
				record: metadata.record,
				createRequestId: () => "method-request",
			},
		);

		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("POST");
		expect(response.headers.get("x-request-id")).toBeNull();
		expect(response.headers.get("request-id")).toBe("method-request");
		expect(await response.json()).toEqual({
			type: "error",
			error: {
				type: "invalid_request_error",
				message: "Method not allowed for this endpoint.",
			},
			request_id: "method-request",
		});
		expect(fetchMock.mock).not.toHaveBeenCalled();
		expect(metadata.events[0]).toMatchObject({
			responseStatus: 405,
			upstreamStatus: null,
			rejectionReason: "method_not_allowed",
			admissionStatus: "not_applicable",
		});
	});
});

describe("authentication boundary", () => {
	it("rejects OpenAI authentication before body reads, upstream, or admission", async () => {
		const request = new Request("https://gateway.example/v1/chat/completions", {
			method: "POST",
			body: new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(encoder.encode("PRIVATE_UNREAD_BODY"));
					controller.close();
				},
			}),
			duplex: "half",
		} as RequestInit & { duplex: "half" });
		const fetchMock = createFetchMock(async () => new Response());
		const admission = createGenerationAdmissionController();
		const metadata = createRecorder();

		const response = await handleGatewayRequest(
			request,
			ENDPOINTS["chat/completions"],
			{
				authenticate: () => ({ status: "rejected" }),
				admission,
				fetch: fetchMock.fetch,
				record: metadata.record,
				createRequestId: () => "openai-auth-request",
			},
		);

		expect(response.status).toBe(401);
		expect(response.headers.get("x-request-id")).toBe("openai-auth-request");
		expect(response.headers.get("request-id")).toBeNull();
		expect(await response.json()).toEqual({
			error: {
				message: "Authentication failed.",
				type: "invalid_request_error",
				param: null,
				code: "invalid_api_key",
			},
		});
		expect(request.bodyUsed).toBe(false);
		expect(fetchMock.mock).not.toHaveBeenCalled();
		expect(admission.snapshot().activeGenerations).toBe(0);
		expect(metadata.events).toHaveLength(1);
		expect(metadata.events[0]).toMatchObject({
			responseStatus: 401,
			upstreamStatus: null,
			outcome: "rejected",
			rejectionReason: "authentication_failed",
			authenticationStatus: "rejected",
			admissionStatus: "not_applicable",
		});
	});

	it("uses the independent Anthropic 401 contract before method validation", async () => {
		const fetchMock = createFetchMock(async () => new Response());
		const metadata = createRecorder();
		const response = await handleGatewayRequest(
			new Request("https://gateway.example/v1/messages", { method: "GET" }),
			ENDPOINTS.messages,
			{
				authenticate: () => ({ status: "rejected" }),
				fetch: fetchMock.fetch,
				record: metadata.record,
				createRequestId: () => "anthropic-auth-request",
			},
		);

		expect(response.status).toBe(401);
		expect(response.headers.get("x-request-id")).toBeNull();
		expect(response.headers.get("request-id")).toBe("anthropic-auth-request");
		expect(await response.json()).toEqual({
			type: "error",
			error: {
				type: "authentication_error",
				message: "Authentication failed.",
			},
			request_id: "anthropic-auth-request",
		});
		expect(response.headers.get("allow")).toBeNull();
		expect(fetchMock.mock).not.toHaveBeenCalled();
		expect(metadata.events[0]).toMatchObject({
			responseStatus: 401,
			rejectionReason: "authentication_failed",
			authenticationStatus: "rejected",
		});
	});

	it("fails closed before exposing an unknown route when auth config is invalid", async () => {
		const fetchMock = createFetchMock(async () => new Response());
		const metadata = createRecorder();
		const response = await handleGatewayRequest(
			new Request("https://gateway.example/v1/slots"),
			null,
			{
				authenticate: () => ({ status: "configuration_error" }),
				fetch: fetchMock.fetch,
				record: metadata.record,
				createRequestId: () => "auth-config-request",
			},
		);

		expect(response.status).toBe(500);
		expect(await response.text()).not.toContain("GOOD_ENOUGH_DATABASE_PATH");
		expect(fetchMock.mock).not.toHaveBeenCalled();
		expect(metadata.events[0]).toMatchObject({
			responseStatus: 500,
			upstreamStatus: null,
			outcome: "configuration_error",
			rejectionReason: null,
			authenticationStatus: "configuration_error",
			admissionStatus: "not_applicable",
		});
	});

	it("does not record the authenticated principal identifier", async () => {
		const metadata = createRecorder();
		const response = await handleGatewayRequest(
			new Request("https://gateway.example/v1/models"),
			ENDPOINTS.models,
			{
				authenticate: () => ({
					status: "authenticated",
					principalId: "PRIVATE_PRINCIPAL_SENTINEL",
				}),
				fetch: createFetchMock(async () => new Response("ok")).fetch,
				record: metadata.record,
			},
		);

		expect(await response.text()).toBe("ok");
		expect(JSON.stringify(metadata.events)).not.toContain(
			"PRIVATE_PRINCIPAL_SENTINEL",
		);
	});
});

describe("server endpoint adapters", () => {
	it("does not accept the removed static-key configuration", async () => {
		const legacyStaticKey = "legacy-static-key-000000000000001";
		vi.stubEnv(
			"INFERENCE_API_KEYS",
			JSON.stringify([{ id: "legacy", key: legacyStaticKey }]),
		);
		const fetchMock = createFetchMock(async () => new Response());
		vi.stubGlobal("fetch", fetchMock.fetch);
		vi.spyOn(console, "info").mockImplementation(() => {});

		const response = await handleModelsRequest(
			new Request("https://gateway.example/v1/models", {
				headers: { authorization: `Bearer ${legacyStaticKey}` },
			}),
		);

		expect(response.status).toBe(401);
		expect(fetchMock.mock).not.toHaveBeenCalled();
	});

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
				headers:
					path === "messages"
						? { "x-api-key": TEST_API_KEY }
						: { authorization: `Bearer ${TEST_API_KEY}` },
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
			new Request("https://gateway.example/v1/slots", {
				headers: { authorization: `Bearer ${TEST_API_KEY}` },
			}),
		);

		expect(response.status).toBe(404);
		expect(fetchMock.mock).not.toHaveBeenCalled();
	});

	it("rejects HEAD /v1/models instead of falling back to GET", async () => {
		const fetchMock = createFetchMock(async () => new Response());
		vi.stubGlobal("fetch", fetchMock.fetch);
		vi.spyOn(console, "info").mockImplementation(() => {});

		const response = await handleModelsRequest(
			new Request("https://gateway.example/v1/models", {
				method: "HEAD",
				headers: { authorization: `Bearer ${TEST_API_KEY}` },
			}),
		);

		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("GET");
		expect(fetchMock.mock).not.toHaveBeenCalled();
	});
});
