// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PublicAuthControls } from "./public-auth-controls";

vi.mock("#/features/accounts/access/ui/login-form", () => ({
	LoginForm: () => <form aria-label="Sign in form" />,
}));

vi.mock("#/features/accounts/access/ui/registration-form", () => ({
	RegistrationForm: () => <form aria-label="Registration form" />,
}));

const ENTRY_STATE = {
	configurationValid: true,
	setupRequired: false,
	registrationEnabled: true,
};

describe("public authentication controls", () => {
	it("opens and closes the Base UI sign-in popover", async () => {
		render(<PublicAuthControls account={null} entryState={ENTRY_STATE} />);

		fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

		expect(await screen.findByLabelText("Sign in form")).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Sign in to Good Enough" }),
		).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Close sign in" }));

		await waitFor(() =>
			expect(screen.queryByLabelText("Sign in form")).toBeNull(),
		);
	});
});
