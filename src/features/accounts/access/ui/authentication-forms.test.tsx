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
import { PasswordChangePage } from "./password-change-page";
import { RegistrationForm } from "./registration-form";
import { SetupPage } from "./setup-page";

const accountFunctions = vi.hoisted(() => ({
	loginAccount: vi.fn(),
	registerAccount: vi.fn(),
	bootstrapAccount: vi.fn(),
	changeAccountPassword: vi.fn(),
}));
const router = vi.hoisted(() => ({ navigate: vi.fn(), invalidate: vi.fn() }));

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
		expect(screen.getByText(/does not extend that key/u)).toBeTruthy();
		expect(screen.getByText(/There is no paid tier/u)).toBeTruthy();
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

	it("shows a recoverable error when the bootstrap request fails", async () => {
		accountFunctions.bootstrapAccount.mockRejectedValue(new Error("network"));
		render(
			<SetupPage
				state={{
					configurationValid: true,
					registrationEnabled: false,
					setupRequired: true,
				}}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Username"), {
			target: { value: "admin" },
		});
		fireEvent.change(screen.getByLabelText("Password"), {
			target: { value: "a sufficiently long password" },
		});
		fireEvent.change(screen.getByLabelText("Bootstrap token"), {
			target: { value: "bootstrap-token" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Create administrator" }),
		);

		expect(
			await screen.findByText("Setup could not be completed. Try again."),
		).toBeTruthy();
	});

	it("disables the bootstrap button while the request is in flight", async () => {
		let resolveBootstrap: (value: unknown) => void = () => {};
		const bootstrapPromise = new Promise((resolve) => {
			resolveBootstrap = resolve;
		});
		accountFunctions.bootstrapAccount.mockReturnValue(bootstrapPromise);
		render(
			<SetupPage
				state={{
					configurationValid: true,
					registrationEnabled: false,
					setupRequired: true,
				}}
			/>,
		);
		fireEvent.change(screen.getByLabelText("Username"), {
			target: { value: "admin" },
		});
		fireEvent.change(screen.getByLabelText("Password"), {
			target: { value: "a sufficiently long password" },
		});
		fireEvent.change(screen.getByLabelText("Bootstrap token"), {
			target: { value: "bootstrap-token" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Create administrator" }),
		);

		const busy = await screen.findByRole("button", {
			name: "Creating administrator…",
		});
		expect(busy.hasAttribute("disabled")).toBe(true);

		resolveBootstrap({ ok: true, value: {} });
		await waitFor(() =>
			expect(router.navigate).toHaveBeenCalledWith({ to: "/login" }),
		);
	});

	describe("password change", () => {
		const account = {
			id: "user-1",
			username: "member",
			role: "member" as const,
			mustChangePassword: false,
		};

		it("distinguishes a wrong current password from a server failure", async () => {
			accountFunctions.changeAccountPassword.mockResolvedValueOnce({
				ok: false,
				code: "invalid_credentials",
			});
			accountFunctions.changeAccountPassword.mockRejectedValueOnce(
				new Error("network"),
			);
			render(<PasswordChangePage account={account} />);

			const fill = () => {
				fireEvent.change(screen.getByLabelText("Current password"), {
					target: { value: "a sufficiently long password" },
				});
				fireEvent.change(screen.getByLabelText("New password"), {
					target: { value: "a different long password here" },
				});
				fireEvent.click(
					screen.getByRole("button", { name: "Change password" }),
				);
			};
			fill();
			expect(
				await screen.findByText("The current password is incorrect."),
			).toBeTruthy();
			fill();
			expect(
				await screen.findByText("Password could not be changed. Try again."),
			).toBeTruthy();
		});

		it("announces success through the polite status channel", async () => {
			accountFunctions.changeAccountPassword.mockResolvedValue({
				ok: true,
				value: {},
			});
			render(<PasswordChangePage account={account} />);

			fireEvent.change(screen.getByLabelText("Current password"), {
				target: { value: "a sufficiently long password" },
			});
			fireEvent.change(screen.getByLabelText("New password"), {
				target: { value: "a different long password here" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Change password" }));

			expect(await screen.findByText("Password changed.")).toBeTruthy();
			await screen.findByRole("status");
			await waitFor(() => expect(router.invalidate).toHaveBeenCalled());
		});
	});
});
