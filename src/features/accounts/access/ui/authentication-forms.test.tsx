// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "./login-form";
import { RegistrationForm } from "./registration-form";

const accountFunctions = vi.hoisted(() => ({
	loginAccount: vi.fn(),
	registerAccount: vi.fn(),
}));
const router = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("../account-access.functions", () => accountFunctions);
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
	useRouter: () => router,
}));

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(cleanup);

describe("account entry forms", () => {
	it("navigates directly to the account after successful sign in", async () => {
		accountFunctions.loginAccount.mockResolvedValue({
			ok: true,
			value: { restricted: false },
		});
		render(<LoginForm />);

		fireEvent.change(screen.getByLabelText("Username"), {
			target: { value: "member" },
		});
		fireEvent.change(screen.getByLabelText("Password"), {
			target: { value: "a sufficiently long password" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

		await waitFor(() =>
			expect(router.navigate).toHaveBeenCalledWith({ to: "/account" }),
		);
	});

	it("auto-enters the API-key onboarding after registration", async () => {
		accountFunctions.registerAccount.mockResolvedValue({ ok: true, value: {} });
		render(
			<RegistrationForm
				state={{
					configurationValid: true,
					registrationEnabled: true,
					setupRequired: false,
				}}
			/>,
		);

		expect(
			screen.getByText(/never persists prompts, responses, reasoning/u),
		).toBeTruthy();
		expect(
			screen.getByText(/personal API keys that expire seven days/u),
		).toBeTruthy();
		expect(screen.getByText(/cannot be extended or converted/u)).toBeTruthy();
		fireEvent.change(screen.getByLabelText("Username"), {
			target: { value: "new-member" },
		});
		fireEvent.change(screen.getByLabelText("Password"), {
			target: { value: "a sufficiently long password" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create account" }));

		await waitFor(() =>
			expect(router.navigate).toHaveBeenCalledWith({
				to: "/account/api-keys",
			}),
		);
	});
});
