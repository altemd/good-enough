// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthenticatedLayout } from "./authenticated-layout";

const accountFunctions = vi.hoisted(() => ({
	logoutAccount: vi.fn(),
}));
const router = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("../../access/account-access.functions", () => accountFunctions);
vi.mock("@tanstack/react-start", () => ({
	useServerFn: (serverFunction: unknown) => serverFunction,
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		...props
	}: React.ComponentProps<"a"> & { to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
	Outlet: () => null,
	useRouter: () => router,
}));

beforeEach(() => {
	vi.clearAllMocks();
	accountFunctions.logoutAccount.mockResolvedValue({ ok: true, value: {} });
});

afterEach(cleanup);

describe("authenticated account layout", () => {
	it("returns to the home page after signing out", async () => {
		render(
			<AuthenticatedLayout
				account={{
					id: "account-id",
					username: "member",
					role: "member",
					mustChangePassword: false,
				}}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

		await waitFor(() =>
			expect(accountFunctions.logoutAccount).toHaveBeenCalled(),
		);
		expect(router.navigate).toHaveBeenCalledWith({ to: "/", replace: true });
	});
});
