// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadDemoModels, streamDemoChat } from "./demo-chat-transport.ts";
import { PublicDemoPage } from "./public-demo-page.tsx";

vi.mock("./demo-chat-transport.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("./demo-chat-transport.ts")>()),
	loadDemoModels: vi.fn(),
	streamDemoChat: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	ClientOnly: ({ children }: { children: React.ReactNode }) => children,
	Link: ({
		children,
		to,
		...props
	}: React.ComponentProps<"a"> & { to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

beforeEach(() => {
	vi.mocked(loadDemoModels).mockReset();
	vi.mocked(loadDemoModels).mockResolvedValue(["local-model"]);
	vi.mocked(streamDemoChat).mockReset();
	vi.mocked(streamDemoChat).mockImplementation(async ({ onDelta }) => {
		onDelta({ reasoning: "Brief reasoning" });
		onDelta({ content: "Streaming answer" });
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("public demo page", () => {
	it("issues one token only after an explicit click and keeps it out of browser storage", async () => {
		const issueDemoToken = vi.fn(async () => ({
			ok: true as const,
			value: {
				apiKey: "ge_demo_selector_private-secret",
				createdAt: Date.UTC(2026, 6, 22, 0, 0),
				expiresAt: Date.UTC(2026, 6, 22, 1, 0),
			},
		}));
		const storageWrite = vi.spyOn(Storage.prototype, "setItem");

		render(<PublicDemoPage account={null} issueDemoToken={issueDemoToken} />);

		expect(issueDemoToken).not.toHaveBeenCalled();
		expect(screen.queryByText("ge_demo_selector_private-secret")).toBeNull();
		expect(
			screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
		).toBe("/login");

		fireEvent.click(
			screen.getByRole("button", { name: "Start one-hour demo" }),
		);

		await screen.findByText("ge_demo_selector_private-secret");
		expect(issueDemoToken).toHaveBeenCalledOnce();
		expect(storageWrite).not.toHaveBeenCalled();
		await screen.findByRole("heading", { name: "Live demo chat" });
		expect(loadDemoModels).toHaveBeenCalledWith(
			"ge_demo_selector_private-secret",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);

		fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
		expect(screen.queryByText("ge_demo_selector_private-secret")).toBeNull();
		expect(
			screen.queryByRole("heading", { name: "Live demo chat" }),
		).toBeNull();
	});

	it("streams a chat response with the memory-only token", async () => {
		const issueDemoToken = vi.fn(async () => ({
			ok: true as const,
			value: {
				apiKey: "ge_demo_selector_private-secret",
				createdAt: Date.UTC(2026, 6, 22, 0, 0),
				expiresAt: Date.UTC(2026, 6, 22, 1, 0),
			},
		}));
		const storageWrite = vi.spyOn(Storage.prototype, "setItem");

		render(<PublicDemoPage account={null} issueDemoToken={issueDemoToken} />);
		fireEvent.click(
			screen.getByRole("button", { name: "Start one-hour demo" }),
		);
		const prompt = await screen.findByRole("textbox", {
			name: "Message the local model",
		});
		fireEvent.change(prompt, { target: { value: "Hello locally" } });
		fireEvent.click(screen.getByRole("button", { name: "Send" }));

		await screen.findByText("Streaming answer");
		expect(streamDemoChat).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "ge_demo_selector_private-secret",
				model: "local-model",
				messages: [{ role: "user", content: "Hello locally" }],
				signal: expect.any(AbortSignal),
			}),
		);
		expect(screen.getByText("Brief reasoning")).toBeTruthy();

		fireEvent.change(prompt, { target: { value: "Follow up" } });
		fireEvent.click(screen.getByRole("button", { name: "Send" }));
		await waitFor(() => expect(streamDemoChat).toHaveBeenCalledTimes(2));
		expect(vi.mocked(streamDemoChat).mock.calls[1]?.[0].messages).toEqual([
			{ role: "user", content: "Hello locally" },
			{
				role: "assistant",
				content: "Streaming answer",
				reasoning_content: "Brief reasoning",
			},
			{ role: "user", content: "Follow up" },
		]);

		fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
		expect(screen.queryByText("Streaming answer")).toBeNull();
		expect(screen.getByText("Ask the local model")).toBeTruthy();
		expect(storageWrite).not.toHaveBeenCalled();
	});

	it("retains long streamed reasoning for the next request", async () => {
		const longReasoning = "reasoning".repeat(5_000);
		vi.mocked(streamDemoChat)
			.mockImplementationOnce(async ({ onDelta }) => {
				onDelta({ reasoning: longReasoning });
				onDelta({ content: "First answer" });
			})
			.mockResolvedValueOnce();
		const issueDemoToken = vi.fn(async () => ({
			ok: true as const,
			value: {
				apiKey: "ge_demo_selector_private-secret",
				createdAt: Date.UTC(2026, 6, 22, 0, 0),
				expiresAt: Date.UTC(2026, 6, 22, 1, 0),
			},
		}));

		render(<PublicDemoPage account={null} issueDemoToken={issueDemoToken} />);
		fireEvent.click(
			screen.getByRole("button", { name: "Start one-hour demo" }),
		);
		const prompt = await screen.findByRole("textbox", {
			name: "Message the local model",
		});
		fireEvent.change(prompt, { target: { value: "First question" } });
		fireEvent.click(screen.getByRole("button", { name: "Send" }));
		await screen.findByText("First answer");
		fireEvent.change(prompt, { target: { value: "Second question" } });
		fireEvent.click(screen.getByRole("button", { name: "Send" }));

		await waitFor(() => expect(streamDemoChat).toHaveBeenCalledTimes(2));
		expect(vi.mocked(streamDemoChat).mock.calls[1]?.[0].messages).toEqual([
			{ role: "user", content: "First question" },
			{
				role: "assistant",
				content: "First answer",
				reasoning_content: longReasoning,
			},
			{ role: "user", content: "Second question" },
		]);
	});

	it("aborts an active chat response from the stop control", async () => {
		vi.mocked(streamDemoChat).mockImplementation(
			({ signal }) =>
				new Promise((_resolve, reject) => {
					signal.addEventListener("abort", () =>
						reject(new DOMException("Aborted", "AbortError")),
					);
				}),
		);
		const issueDemoToken = vi.fn(async () => ({
			ok: true as const,
			value: {
				apiKey: "ge_demo_selector_private-secret",
				createdAt: Date.UTC(2026, 6, 22, 0, 0),
				expiresAt: Date.UTC(2026, 6, 22, 1, 0),
			},
		}));

		render(<PublicDemoPage account={null} issueDemoToken={issueDemoToken} />);
		fireEvent.click(
			screen.getByRole("button", { name: "Start one-hour demo" }),
		);
		const prompt = await screen.findByRole("textbox", {
			name: "Message the local model",
		});
		fireEvent.change(prompt, { target: { value: "Keep streaming" } });
		fireEvent.click(screen.getByRole("button", { name: "Send" }));
		fireEvent.click(await screen.findByRole("button", { name: "Stop" }));

		await screen.findByText("Generation stopped.");
		const request = vi.mocked(streamDemoChat).mock.calls[0]?.[0];
		expect(request?.signal.aborted).toBe(true);
	});

	it("shows a stable capacity message and retry estimate", async () => {
		const issueDemoToken = vi.fn(async () => ({
			ok: false as const,
			code: "capacity_reached" as const,
			retryAfterSeconds: 120,
		}));

		render(<PublicDemoPage account={null} issueDemoToken={issueDemoToken} />);
		fireEvent.click(
			screen.getByRole("button", { name: "Start one-hour demo" }),
		);

		await waitFor(() =>
			expect(screen.getByRole("alert").textContent).toBe(
				"All temporary demo credentials are currently allocated. Try again in about 2 minutes.",
			),
		);
	});

	it("links an authenticated visitor back to their account", () => {
		render(
			<PublicDemoPage
				account={{
					id: "account-id",
					username: "Member",
					role: "member",
					mustChangePassword: false,
				}}
				issueDemoToken={vi.fn()}
			/>,
		);

		expect(
			screen.getByRole("link", { name: "Open account" }).getAttribute("href"),
		).toBe("/account");
		expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
	});
});
