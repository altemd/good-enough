// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { type DemoChatMessage, DemoChatMessageView } from "./demo-chat-message";

afterEach(cleanup);

describe("demo chat message", () => {
	it("renders safe Markdown in assistant text and reasoning", () => {
		const { container } = render(
			<DemoChatMessageView
				message={assistantMessage({
					content:
						"## Result\n\n- **first** item\n\n![tracker](https://example.invalid/pixel.png)",
					reasoning: "Reasoning with `code` and <script>ignored()</script>.",
				})}
			/>,
		);

		expect(screen.getByRole("heading", { name: "Result" })).toBeTruthy();
		expect(screen.getByText("first").tagName).toBe("STRONG");
		expect(screen.getByText("code").tagName).toBe("CODE");
		expect(screen.getByText("[Remote image omitted: tracker]")).toBeTruthy();
		expect(container.querySelector("img")).toBeNull();
		expect(container.querySelector("script")).toBeNull();
	});

	it("opens reasoning while streaming and closes it when complete", () => {
		const { container, rerender } = render(
			<DemoChatMessageView
				message={assistantMessage({ status: "streaming" })}
			/>,
		);
		const trigger = screen.getByRole("button", { name: "Reasoning" });
		const panel = () =>
			container.querySelector('[data-slot="collapsible-content"]');
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(panel()?.hasAttribute("hidden")).toBe(false);

		rerender(
			<DemoChatMessageView
				message={assistantMessage({ status: "complete" })}
			/>,
		);
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(panel()?.hasAttribute("hidden")).toBe(true);
	});

	it("lets the reader reopen the reasoning after completion", () => {
		const { container } = render(
			<DemoChatMessageView
				message={assistantMessage({ status: "complete" })}
			/>,
		);
		const trigger = screen.getByRole("button", { name: "Reasoning" });
		expect(trigger.getAttribute("aria-expanded")).toBe("false");

		fireEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(
			container
				.querySelector('[data-slot="collapsible-content"]')
				?.hasAttribute("hidden"),
		).toBe(false);
	});
});

function assistantMessage(
	overrides: Partial<DemoChatMessage> = {},
): DemoChatMessage {
	return {
		id: 1,
		role: "assistant",
		content: "Answer",
		reasoning: "Thinking",
		status: "complete",
		...overrides,
	};
}
