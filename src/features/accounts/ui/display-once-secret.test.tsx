// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DisplayOnceSecret } from "./display-once-secret.tsx";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("display-once secret", () => {
	it("copies the secret and delegates dismissal to its owner", () => {
		const writeText = vi.fn(() => Promise.resolve());
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		const onDismiss = vi.fn();

		render(
			<DisplayOnceSecret
				title="Temporary credential"
				description="Shown once."
				secret="private-secret"
				onDismiss={onDismiss}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Copy" }));
		expect(writeText).toHaveBeenCalledWith("private-secret");

		fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
		expect(onDismiss).toHaveBeenCalledOnce();
	});
});
