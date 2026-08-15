// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { discoverOpenAiModelIds } from "#/features/inference-gateway/openai-model-discovery";

import { streamDemoChat } from "./demo-chat-transport.ts";
import { PublicDemoPage } from "./public-demo-page.tsx";

vi.mock("#/features/inference-gateway/openai-model-discovery", () => ({
	discoverOpenAiModelIds: vi.fn(),
}));

vi.mock("./demo-chat-transport.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("./demo-chat-transport.ts")>()),
	streamDemoChat: vi.fn(),
}));

vi.mock("./public-auth-controls", () => ({
	PublicAuthControls: ({
		account,
	}: {
		account: { username: string } | null;
	}) =>
		account ? (
			<a href="/account">Open account</a>
		) : (
			<button type="button">Sign in</button>
		),
	PublicRegistrationControl: () => (
		<button type="button">Create account</button>
	),
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
	vi.mocked(discoverOpenAiModelIds).mockReset();
	vi.mocked(discoverOpenAiModelIds).mockResolvedValue(["local-model"]);
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

		render(
			<PublicDemoPage
				account={null}
				entryState={ENTRY_STATE}
				issueDemoToken={issueDemoToken}
			/>,
		);

		expect(issueDemoToken).not.toHaveBeenCalled();
		expect(screen.queryByText("ge_demo_selector_private-secret")).toBeNull();
		expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Are local models good enough?" }),
		).toBeTruthy();
		expect(screen.getByText("GE").getAttribute("aria-hidden")).toBe("true");
		expect(screen.queryByText("Personal project · Local inference")).toBeNull();
		expect(
			screen.getByText(/personal project built to help you find out/u),
		).toBeTruthy();
		expect(
			screen.getByText(/free temporary API key that works for one hour/u),
		).toBeTruthy();
		expect(screen.getByText(/No account or payment is required/u)).toBeTruthy();
		const privacyHeading = screen.getByRole("heading", {
			name: "What gets stored?",
		});
		expect(privacyHeading).toBeTruthy();
		expect(
			screen.getByText(/does not persist inference content/u),
		).toBeTruthy();
		expect(privacyHeading.closest("section")?.textContent).toMatch(
			/anonymous hourly counts of rendered landing views/iu,
		);
		expect(privacyHeading.closest("section")?.textContent).not.toMatch(
			/live request timing/iu,
		);
		expect(
			privacyHeading.closest("section")?.querySelector("ul")?.className,
		).toContain("xl:grid-cols-2");
		expect(
			screen.getByRole("heading", {
				name: "Seven-day API keys and live request timing",
			}),
		).toBeTruthy();
		expect(screen.getByText(/There is no paid tier/u)).toBeTruthy();
		expect(screen.getByText("example preview · synthetic events")).toBeTruthy();

		fireEvent.click(
			screen.getByRole("button", { name: "Get a free one-hour API key" }),
		);

		await screen.findByText("ge_demo_selector_private-secret");
		expect(issueDemoToken).toHaveBeenCalledOnce();
		expect(storageWrite).not.toHaveBeenCalled();
		expect(
			await screen.findByRole("heading", { name: "Live demo", level: 1 }),
		).toBeTruthy();
		const chatHeading = await screen.findByRole("heading", {
			name: "Live demo chat",
		});
		const setupPanel = screen.getByRole("complementary", {
			name: "Temporary API key and client setup",
		});
		expect(setupPanel.className).toContain("order-1");
		expect(setupPanel.className).toContain("lg:order-2");
		expect(chatHeading.closest("section")?.className).toContain("order-2");
		expect(chatHeading.closest("section")?.className).toContain("lg:order-1");
		expect(
			screen.queryByRole("heading", { name: "Are local models good enough?" }),
		).toBeNull();
		expect(
			screen.queryByRole("heading", {
				name: "Seven-day API keys and live request timing",
			}),
		).toBeNull();
		expect(
			screen.queryByRole("region", { name: "Inference privacy" }),
		).toBeNull();
		expect(discoverOpenAiModelIds).toHaveBeenCalledWith(
			"ge_demo_selector_private-secret",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(discoverOpenAiModelIds).toHaveBeenCalledOnce();
		expect(await screen.findByLabelText("OpenCode configuration")).toBeTruthy();

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

		render(
			<PublicDemoPage
				account={null}
				entryState={ENTRY_STATE}
				issueDemoToken={issueDemoToken}
			/>,
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Get a free one-hour API key" }),
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

		render(
			<PublicDemoPage
				account={null}
				entryState={ENTRY_STATE}
				issueDemoToken={issueDemoToken}
			/>,
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Get a free one-hour API key" }),
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

		render(
			<PublicDemoPage
				account={null}
				entryState={ENTRY_STATE}
				issueDemoToken={issueDemoToken}
			/>,
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Get a free one-hour API key" }),
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

		render(
			<PublicDemoPage
				account={null}
				entryState={ENTRY_STATE}
				issueDemoToken={issueDemoToken}
			/>,
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Get a free one-hour API key" }),
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
				entryState={ENTRY_STATE}
				issueDemoToken={vi.fn()}
			/>,
		);

		expect(
			screen.getByRole("link", { name: "Open account" }).getAttribute("href"),
		).toBe("/account");
		expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
	});
});

const ENTRY_STATE = {
	configurationValid: true,
	registrationEnabled: true,
	setupRequired: false,
};
