// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
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
		const disclosure = container.querySelector("details");
		expect(disclosure?.open).toBe(true);

		rerender(
			<DemoChatMessageView
				message={assistantMessage({ status: "complete" })}
			/>,
		);
		expect(disclosure?.open).toBe(false);
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
