// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DemoChatMessage } from "./demo-chat-message.tsx";
import { DemoChatTranscript } from "./demo-chat-transcript.tsx";

const FIRST_MESSAGE: DemoChatMessage = {
	id: 1,
	role: "assistant",
	content: "First response",
	reasoning: "",
	status: "complete",
};

describe("demo chat transcript", () => {
	it("does not create an internal scroll boundary for an empty conversation", () => {
		const { unmount } = renderTranscript([], 0);
		const transcript = screen.getByRole("log", { name: "Demo conversation" });

		expect(transcript.className).not.toContain("overflow-y-auto");
		expect(transcript.className).not.toContain("overscroll-contain");
		expect(transcript.getAttribute("tabindex")).toBeNull();
		unmount();
	});

	it("follows new output until the reader scrolls away from the bottom", () => {
		let scrollHeight = 1_000;
		const { rerender } = renderTranscript([FIRST_MESSAGE], 0);
		const transcript = screen.getByRole("log", { name: "Demo conversation" });
		Object.defineProperties(transcript, {
			clientHeight: { configurable: true, get: () => 200 },
			scrollHeight: { configurable: true, get: () => scrollHeight },
			scrollTop: { configurable: true, value: 800, writable: true },
		});
		expect(transcript.className).toContain("overflow-y-auto");
		expect(transcript.className).not.toContain("overscroll-contain");
		expect(transcript.getAttribute("tabindex")).toBe("0");

		scrollHeight = 1_200;
		rerender(transcriptView([FIRST_MESSAGE, message(2)], 0));
		expect(transcript.scrollTop).toBe(1_200);

		transcript.scrollTop = 300;
		fireEvent.scroll(transcript);
		scrollHeight = 1_400;
		rerender(transcriptView([FIRST_MESSAGE, message(2), message(3)], 0));
		expect(transcript.scrollTop).toBe(300);

		rerender(transcriptView([FIRST_MESSAGE, message(2), message(3)], 1));
		expect(transcript.scrollTop).toBe(1_400);
	});
});

function renderTranscript(messages: DemoChatMessage[], forceScrollKey: number) {
	return render(transcriptView(messages, forceScrollKey));
}

function transcriptView(messages: DemoChatMessage[], forceScrollKey: number) {
	return (
		<DemoChatTranscript messages={messages} forceScrollKey={forceScrollKey} />
	);
}

function message(id: number): DemoChatMessage {
	return {
		id,
		role: "assistant",
		content: `Response ${id}`,
		reasoning: "",
		status: "streaming",
	};
}
