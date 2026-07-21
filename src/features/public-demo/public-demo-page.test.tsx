// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicDemoPage } from "./public-demo-page.tsx";

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

		fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
		expect(screen.queryByText("ge_demo_selector_private-secret")).toBeNull();
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
