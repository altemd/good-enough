import { describe, expect, it, vi } from "vitest";

import type { ApiProtocol } from "./api-protocol";
import {
	createProtocolErrorResponse,
	createProtocolStreamErrorEvent,
	normalizeUpstreamErrorResponse,
} from "./protocol-errors";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("protocol error responses", () => {
	it("formats OpenAI errors with stable codes and method headers", async () => {
		const response = createProtocolErrorResponse({
			protocol: "openai",
			status: 405,
			code: "method_not_allowed",
			message: "Method not allowed for this endpoint.",
			requestId: "request-openai",
			allowedMethods: ["POST"],
		});

		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("POST");
		expect(response.headers.get("x-request-id")).toBe("request-openai");
		expect(response.headers.get("request-id")).toBeNull();
		expect(response.headers.get("content-type")).toBe(
			"application/json; charset=utf-8",
		);
		expect(await response.json()).toEqual({
			error: {
				message: "Method not allowed for this endpoint.",
				type: "invalid_request_error",
				param: null,
				code: "method_not_allowed",
			},
		});
	});

	it("formats Anthropic errors with one authoritative request ID", async () => {
		const response = createProtocolErrorResponse({
			protocol: "anthropic",
			status: 429,
			code: "capacity_exceeded",
			message:
				"Inference capacity is currently in use. Retry the request later.",
			requestId: "request-anthropic",
		});

		expect(response.headers.get("x-request-id")).toBeNull();
		expect(response.headers.get("request-id")).toBe("request-anthropic");
		expect(response.headers.get("retry-after")).toBeNull();
		expect(await response.json()).toEqual({
			type: "error",
			error: {
				type: "rate_limit_error",
				message:
					"Inference capacity is currently in use. Retry the request later.",
			},
			request_id: "request-anthropic",
		});
	});

	it.each([
		["openai", 429, "rate_limit_error"],
		["openai", 499, "invalid_request_error"],
		["openai", 500, "server_error"],
		["openai", 502, "server_error"],
		["anthropic", 404, "not_found_error"],
		["anthropic", 405, "invalid_request_error"],
		["anthropic", 500, "api_error"],
		["anthropic", 502, "api_error"],
		["anthropic", 504, "timeout_error"],
		["anthropic", 529, "overloaded_error"],
	] as const)("maps %s status %s to %s", async (protocol, status, expectedType) => {
		const response = createProtocolErrorResponse({
			protocol,
			status,
			code: "upstream_error",
			message: "Sanitized error.",
			requestId: "mapping-request",
		});

		expect(await response.json()).toMatchObject({
			error: { type: expectedType },
		});
	});

	it("creates terminal SDK-compatible SSE error events", () => {
		expect(decoder.decode(createProtocolStreamErrorEvent("openai"))).toBe(
			'\n\nevent: error\ndata: {"error":{"message":"Inference stream ended unexpectedly.","type":"server_error","param":null,"code":"upstream_stream_error"}}\n\n',
		);
		expect(decoder.decode(createProtocolStreamErrorEvent("anthropic"))).toBe(
			'\n\nevent: error\ndata: {"type":"error","error":{"type":"api_error","message":"Inference stream ended unexpectedly."}}\n\n',
		);
	});
});

describe("bounded upstream error normalization", () => {
	it("passes through a conforming OpenAI error across arbitrary chunks", async () => {
		const body = JSON.stringify({
			error: {
				message: "Known upstream failure.",
				type: "server_error",
				param: null,
				code: "server_error",
			},
		});
		const upstreamResponse = chunkedResponse(
			[body.slice(0, 7), body.slice(7, 31), body.slice(31)],
			{
				status: 503,
				statusText: "Backend Busy",
				headers: {
					"content-type": "application/problem+json; charset=utf-8",
					"content-length": String(body.length),
					"retry-after": "7",
				},
			},
		);

		const normalized = await normalize(upstreamResponse, "openai");

		expect(normalized.bodyReadFailed).toBe(false);
		expect(normalized.response.status).toBe(503);
		expect(normalized.response.statusText).toBe("Backend Busy");
		expect(normalized.response.headers.get("retry-after")).toBe("7");
		expect(normalized.response.headers.get("content-length")).toBeNull();
		expect(await normalized.response.text()).toBe(body);
	});

	it("passes through Anthropic only when its request ID matches the gateway", async () => {
		const conforming = JSON.stringify({
			type: "error",
			error: { type: "overloaded_error", message: "Known overload." },
			request_id: "gateway-request",
		});
		const mismatch = conforming.replace("gateway-request", "upstream-request");

		const accepted = await normalize(
			chunkedResponse([conforming], {
				status: 529,
				headers: { "content-type": "application/json" },
			}),
			"anthropic",
		);
		const rejected = await normalize(
			chunkedResponse([mismatch], {
				status: 529,
				headers: { "content-type": "application/json" },
			}),
			"anthropic",
		);

		expect(await accepted.response.text()).toBe(conforming);
		expect(await rejected.response.json()).toEqual({
			type: "error",
			error: {
				type: "overloaded_error",
				message: "Inference backend returned an error.",
			},
			request_id: "gateway-request",
		});
		expect(rejected.response.headers.get("request-id")).toBe("gateway-request");
	});

	it.each([
		["malformed", "{PRIVATE_MALFORMED_SENTINEL"],
		[
			"extra field",
			JSON.stringify({
				error: {
					message: "Known error.",
					type: "server_error",
					private_detail: "PRIVATE_FIELD_SENTINEL",
				},
			}),
		],
	] as const)("sanitizes a %s upstream body", async (_case, body) => {
		const normalized = await normalize(
			chunkedResponse([body], {
				status: 502,
				headers: { "content-type": "application/json" },
			}),
			"openai",
		);
		const text = await normalized.response.text();

		expect(text).toContain("Inference backend returned an error.");
		expect(text).not.toContain("PRIVATE_");
	});

	it("enforces the 64 KiB limit and cancels an oversized reader", async () => {
		const cancel = vi.fn();
		let chunkIndex = 0;
		const chunks = [encoder.encode("x".repeat(64 * 1024)), encoder.encode("y")];
		const upstreamResponse = new Response(
			new ReadableStream<Uint8Array>({
				pull(controller) {
					const chunk = chunks[chunkIndex++];
					if (chunk) {
						controller.enqueue(chunk);
					} else {
						controller.close();
					}
				},
				cancel,
			}),
			{ status: 500, headers: { "content-type": "application/json" } },
		);

		const normalized = await normalize(upstreamResponse, "openai");

		expect(cancel).toHaveBeenCalledTimes(1);
		expect(await normalized.response.text()).toContain(
			"Inference backend returned an error.",
		);
	});

	it("marks an upstream body read failure without exposing its error", async () => {
		const upstreamResponse = new Response(
			new ReadableStream<Uint8Array>({
				pull(controller) {
					controller.error(new Error("PRIVATE_BODY_FAILURE"));
				},
			}),
			{ status: 503, headers: { "content-type": "application/json" } },
		);

		const normalized = await normalize(upstreamResponse, "openai");
		const text = await normalized.response.text();

		expect(normalized.bodyReadFailed).toBe(true);
		expect(text).not.toContain("PRIVATE_BODY_FAILURE");
		expect(text).toContain("Inference backend returned an error.");
	});
});

function normalize(upstreamResponse: Response, protocol: ApiProtocol) {
	return normalizeUpstreamErrorResponse({
		protocol,
		upstreamResponse,
		responseHeaders: new Headers(upstreamResponse.headers),
		requestId: "gateway-request",
		signal: new AbortController().signal,
	});
}

function chunkedResponse(
	chunks: ReadonlyArray<string>,
	init: ResponseInit,
): Response {
	let index = 0;
	return new Response(
		new ReadableStream<Uint8Array>({
			pull(controller) {
				const chunk = chunks[index++];
				if (chunk === undefined) {
					controller.close();
					return;
				}
				controller.enqueue(encoder.encode(chunk));
			},
		}),
		init,
	);
}
