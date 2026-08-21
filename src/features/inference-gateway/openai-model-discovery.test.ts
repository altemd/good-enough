import { describe, expect, it, vi } from "vitest";

import {
	discoverOpenAiModelIds,
	OpenAiModelDiscoveryError,
} from "./openai-model-discovery";

const API_KEY = "ge_personal_selector_private-secret";

describe("OpenAI model discovery", () => {
	it("returns only unique, bounded model IDs", async () => {
		const fetcher = vi.fn(async () =>
			jsonResponse({
				object: "list",
				privateMetadata: "must-not-cross-the-adapter",
				data: [
					{ id: "second-model", privateField: "ignored" },
					{ id: "first-model" },
					{ id: "second-model" },
					{ id: "" },
					{ notAnId: "ignored" },
				],
			}),
		) as unknown as typeof fetch;

		await expect(discoverOpenAiModelIds(API_KEY, { fetcher })).resolves.toEqual(
			["second-model", "first-model"],
		);
		expect(fetcher).toHaveBeenCalledWith(
			"/v1/models",
			expect.objectContaining({
				cache: "no-store",
				credentials: "omit",
				headers: {
					accept: "application/json",
					authorization: `Bearer ${API_KEY}`,
				},
			}),
		);
	});

	it("rejects oversized and malformed responses without exposing their bodies", async () => {
		const privateSentinel = "private-upstream-body";
		const oversizedFetcher = vi.fn(
			async () => new Response(privateSentinel.repeat(4_000)),
		) as unknown as typeof fetch;

		const oversized = discoverOpenAiModelIds(API_KEY, {
			fetcher: oversizedFetcher,
		});
		await expect(oversized).rejects.toBeInstanceOf(OpenAiModelDiscoveryError);
		await expect(oversized).rejects.not.toThrow(privateSentinel);

		const malformed = discoverOpenAiModelIds(API_KEY, {
			fetcher: vi.fn(async () =>
				jsonResponse({ data: [] }),
			) as unknown as typeof fetch,
		});
		await expect(malformed).rejects.toBeInstanceOf(OpenAiModelDiscoveryError);
	});

	it("maps authentication and connection failures to a sanitized error", async () => {
		await expect(
			discoverOpenAiModelIds(API_KEY, {
				fetcher: vi.fn(
					async () =>
						new Response("private-auth-body", {
							status: 401,
						}),
				) as unknown as typeof fetch,
			}),
		).rejects.toEqual(new OpenAiModelDiscoveryError());

		await expect(
			discoverOpenAiModelIds(API_KEY, {
				fetcher: vi.fn(async () => {
					throw new Error("private-network-detail");
				}) as unknown as typeof fetch,
			}),
		).rejects.toEqual(new OpenAiModelDiscoveryError());
	});

	it("preserves cancellation", async () => {
		const controller = new AbortController();
		const fetcher = vi.fn(
			async (_input, init) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(new DOMException("Aborted", "AbortError")),
					);
				}),
		) as unknown as typeof fetch;
		const discovery = discoverOpenAiModelIds(API_KEY, {
			fetcher,
			signal: controller.signal,
		});

		controller.abort();
		await expect(discovery).rejects.toMatchObject({ name: "AbortError" });
	});
});

function jsonResponse(value: unknown) {
	return new Response(JSON.stringify(value), {
		headers: { "content-type": "application/json" },
	});
}
