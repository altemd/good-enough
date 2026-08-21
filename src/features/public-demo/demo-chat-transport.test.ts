import { describe, expect, it, vi } from "vitest";

import {
	DemoChatError,
	type DemoChatRequestMessage,
	streamDemoChat,
} from "./demo-chat-transport.ts";

const API_KEY = "ge_demo_selector_private-secret";

describe("demo chat transport", () => {
	it("parses content and reasoning across arbitrary SSE chunk boundaries", async () => {
		const deltas: Array<{ content?: string; reasoning?: string }> = [];
		const fetcher = vi.fn(async (_input, init) => {
			expect(init?.method).toBe("POST");
			expect(init?.credentials).toBe("omit");
			expect(init?.headers).toEqual({
				accept: "text/event-stream",
				authorization: `Bearer ${API_KEY}`,
				"content-type": "application/json",
			});
			expect(JSON.parse(String(init?.body))).toEqual({
				model: "local-model",
				messages: [{ role: "user", content: "Hello" }],
				stream: true,
			});
			return sseResponse([
				'data: {"choices":[{"delta":{"reasoning_content":"thin',
				'king","tool_calls":[{"function":{"arguments":"private-tool"}}]}}]}\n\n',
				'data: {"choices":[{"delta":{"content":"Hel',
				'lo"}}]}\n\ndata: [DONE]\n\n',
			]);
		}) as unknown as typeof fetch;

		await streamDemoChat({
			apiKey: API_KEY,
			model: "local-model",
			messages: [{ role: "user", content: "Hello" }],
			signal: new AbortController().signal,
			onDelta: (delta) => deltas.push(delta),
			fetcher,
		});

		expect(deltas).toEqual([
			{ content: undefined, reasoning: "thinking" },
			{ content: "Hello", reasoning: undefined },
		]);
		expect(JSON.stringify(deltas)).not.toContain("private-tool");
	});

	it("forwards append-only history with reasoning beyond the former client limits", async () => {
		const messages: DemoChatRequestMessage[] = [
			{ role: "user", content: "First question" },
			{
				role: "assistant",
				content: "a".repeat(70 * 1024),
				reasoning_content: "r".repeat(70 * 1024),
			},
			...Array.from({ length: 11 }, (_, index) => [
				{ role: "user" as const, content: `Question ${index}` },
				{ role: "assistant" as const, content: `Answer ${index}` },
			]).flat(),
		];
		const fetcher = vi.fn(async (_input, init) => {
			expect(JSON.parse(String(init?.body))).toEqual({
				model: "local-model",
				messages,
				stream: true,
			});
			return sseResponse(["data: [DONE]\n\n"]);
		}) as unknown as typeof fetch;

		await streamDemoChat({
			apiKey: API_KEY,
			model: "local-model",
			messages,
			signal: new AbortController().signal,
			onDelta: vi.fn(),
			fetcher,
		});

		expect(messages).toHaveLength(24);
		expect(fetcher).toHaveBeenCalledOnce();
	});

	it("maps capacity failures without reading or exposing the error body", async () => {
		const fetcher = vi.fn(
			async () => new Response("private-upstream-error", { status: 429 }),
		) as unknown as typeof fetch;

		const result = streamDemoChat({
			apiKey: API_KEY,
			model: "local-model",
			messages: [{ role: "user", content: "Hello" }],
			signal: new AbortController().signal,
			onDelta: vi.fn(),
			fetcher,
		});

		await expect(result).rejects.toMatchObject({
			message: "The model is currently busy. Try again shortly.",
		});
		await expect(result).rejects.not.toThrow("private-upstream-error");
	});

	it.each([
		[401, "The demo credential is invalid or has expired."],
		[503, "The local model is temporarily unavailable. Try again."],
	] as const)("maps HTTP %s to a fixed sanitized failure", async (status, message) => {
		const fetcher = vi.fn(
			async () => new Response("private-error-detail", { status }),
		) as unknown as typeof fetch;

		await expect(
			streamDemoChat({
				apiKey: API_KEY,
				model: "local-model",
				messages: [{ role: "user", content: "Hello" }],
				signal: new AbortController().signal,
				onDelta: vi.fn(),
				fetcher,
			}),
		).rejects.toMatchObject({ message });
	});

	it("rejects an oversized incomplete event", async () => {
		const fetcher = vi.fn(async () =>
			sseResponse([`data: ${"x".repeat(65 * 1024)}`]),
		) as unknown as typeof fetch;

		await expect(
			streamDemoChat({
				apiKey: API_KEY,
				model: "local-model",
				messages: [{ role: "user", content: "Hello" }],
				signal: new AbortController().signal,
				onDelta: vi.fn(),
				fetcher,
			}),
		).rejects.toBeInstanceOf(DemoChatError);
	});

	it("drains the response after DONE instead of cancelling a completed stream", async () => {
		const encoder = new TextEncoder();
		let cancelled = false;
		const fetcher = vi.fn(
			async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(encoder.encode("data: [DONE]\n\n"));
							controller.enqueue(encoder.encode(": stream trailer\n\n"));
							controller.close();
						},
						cancel() {
							cancelled = true;
						},
					}),
					{ headers: { "content-type": "text/event-stream" } },
				),
		) as unknown as typeof fetch;

		await streamDemoChat({
			apiKey: API_KEY,
			model: "local-model",
			messages: [{ role: "user", content: "Hello" }],
			signal: new AbortController().signal,
			onDelta: vi.fn(),
			fetcher,
		});

		expect(cancelled).toBe(false);
	});

	it("propagates cancellation without translating it into a service error", async () => {
		const controller = new AbortController();
		const fetcher = vi.fn(
			(_input: RequestInfo | URL, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(new DOMException("Aborted", "AbortError")),
					);
				}),
		) as unknown as typeof fetch;
		const request = streamDemoChat({
			apiKey: API_KEY,
			model: "local-model",
			messages: [{ role: "user", content: "Hello" }],
			signal: controller.signal,
			onDelta: vi.fn(),
			fetcher,
		});

		controller.abort();

		await expect(request).rejects.toMatchObject({ name: "AbortError" });
	});
});

function sseResponse(chunks: string[]) {
	const encoder = new TextEncoder();
	return new Response(
		new ReadableStream({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
				controller.close();
			},
		}),
		{
			headers: { "content-type": "text/event-stream" },
		},
	);
}
