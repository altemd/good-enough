// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemberAdministrationPage } from "./member-administration-page";

const memberFunctions = vi.hoisted(() => ({
	setMemberDisabled: vi.fn(),
	issueMemberTemporaryPassword: vi.fn(),
}));
const router = vi.hoisted(() => ({ navigate: vi.fn(), invalidate: vi.fn() }));

vi.mock("../member-administration.functions", () => memberFunctions);
vi.mock("@tanstack/react-start", () => ({
	useServerFn: (serverFunction: unknown) => serverFunction,
}));
vi.mock("@tanstack/react-router", () => ({
	useRouter: () => router,
}));

const member = {
	id: "member-1",
	username: "ada",
	status: "active",
	mustChangePassword: false,
} as const;

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(cleanup);

describe("member administration page", () => {
	it("reports a failed disable instead of swallowing it", async () => {
		memberFunctions.setMemberDisabled.mockRejectedValue(new Error("network"));
		render(<MemberAdministrationPage members={[member]} />);

		fireEvent.click(screen.getByRole("button", { name: "Disable" }));
		expect(
			await screen.findByText("The member could not be updated. Try again."),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Disable" }).hasAttribute("disabled"),
		).toBe(false);
	});

	it("disables status and password actions while one is in flight", async () => {
		let resolveDisable: (value: unknown) => void = () => {};
		const disablePromise = new Promise((resolve) => {
			resolveDisable = resolve;
		});
		memberFunctions.setMemberDisabled.mockReturnValue(disablePromise);
		render(<MemberAdministrationPage members={[member]} />);

		fireEvent.click(screen.getByRole("button", { name: "Disable" }));

		const busy = await screen.findByRole("button", { name: "Updating…" });
		expect(busy.hasAttribute("disabled")).toBe(true);
		expect(
			screen
				.getByRole("button", { name: "Reset password" })
				.hasAttribute("disabled"),
		).toBe(true);

		resolveDisable({ ok: true, value: {} });
		await waitFor(() => expect(router.invalidate).toHaveBeenCalled());
	});

	it("shows a failed temporary-password issue instead of staying silent", async () => {
		memberFunctions.issueMemberTemporaryPassword.mockResolvedValue({
			ok: false,
			code: "forbidden",
		});
		render(<MemberAdministrationPage members={[member]} />);

		fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
		expect(
			await screen.findByText(
				"The temporary password could not be issued. Try again.",
			),
		).toBeTruthy();
		expect(
			screen.queryByRole("heading", { name: "Temporary password" }),
		).toBeNull();
	});

	it("shows the issued temporary password once", async () => {
		memberFunctions.issueMemberTemporaryPassword.mockResolvedValue({
			ok: true,
			value: { temporaryPassword: "temporary-password-value" },
		});
		render(<MemberAdministrationPage members={[member]} />);

		await fireEvent.click(
			screen.getByRole("button", { name: "Reset password" }),
		);
		await screen.findByText("temporary-password-value");
	});
});
