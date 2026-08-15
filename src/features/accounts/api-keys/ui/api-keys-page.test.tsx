// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiKeysPage } from "./api-keys-page";

const keyFunctions = vi.hoisted(() => ({
	createPersonalApiKey: vi.fn(),
	revokePersonalApiKey: vi.fn(),
}));
const router = vi.hoisted(() => ({ navigate: vi.fn(), invalidate: vi.fn() }));

vi.mock("../api-key.functions", () => keyFunctions);
vi.mock("@tanstack/react-start", () => ({
	useServerFn: (serverFunction: unknown) => serverFunction,
}));
vi.mock("@tanstack/react-router", () => ({
	ClientOnly: ({ children }: { children: React.ReactNode }) => children,
	useRouter: () => router,
}));

const activeKey = {
	prefix: "ge_abcdef",
	createdAt: Date.UTC(2026, 6, 22, 0, 0),
	expiresAt: Date.UTC(2026, 6, 29, 0, 0),
	state: "active",
} as const;

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(cleanup);

describe("api keys page", () => {
	it("reports a failed revocation and recovers the button", async () => {
		keyFunctions.revokePersonalApiKey.mockRejectedValue(new Error("network"));
		render(<ApiKeysPage keys={[activeKey]} />);

		fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
		expect(
			await screen.findByText("The key could not be revoked. Try again."),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Revoke" }).hasAttribute("disabled"),
		).toBe(false);
	});

	it("disables every key action while a request is in flight, then refreshes", async () => {
		let resolveRevoke: (value: unknown) => void = () => {};
		const revokePromise = new Promise((resolve) => {
			resolveRevoke = resolve;
		});
		keyFunctions.revokePersonalApiKey.mockReturnValue(revokePromise);
		render(<ApiKeysPage keys={[activeKey]} />);

		fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

		const busy = await screen.findByRole("button", { name: "Revoking…" });
		expect(busy.hasAttribute("disabled")).toBe(true);
		expect(
			screen
				.getByRole("button", { name: "Create key" })
				.hasAttribute("disabled"),
		).toBe(true);

		resolveRevoke({ ok: true, value: {} });
		await waitFor(() => expect(router.invalidate).toHaveBeenCalled());
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Revoke" }).hasAttribute("disabled"),
			).toBe(false),
		);
	});
});
