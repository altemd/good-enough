import { describe, expect, it, vi } from "vitest";

import { DemoChatDeltaBuffer } from "./demo-chat-delta-buffer.ts";

describe("demo chat delta buffer", () => {
	it("coalesces streamed text and reasoning into one scheduled update", () => {
		const scheduler = createManualScheduler();
		const onFlush = vi.fn();
		const buffer = new DemoChatDeltaBuffer(onFlush, scheduler);

		buffer.enqueue({ reasoning: "think" });
		buffer.enqueue({ reasoning: "ing", content: "Hel" });
		buffer.enqueue({ content: "lo" });
		expect(onFlush).not.toHaveBeenCalled();

		scheduler.runAll();
		expect(onFlush).toHaveBeenCalledOnce();
		expect(onFlush).toHaveBeenCalledWith({
			content: "Hello",
			reasoning: "thinking",
		});
	});

	it("flushes pending deltas exactly once before terminal state", () => {
		const scheduler = createManualScheduler();
		const onFlush = vi.fn();
		const buffer = new DemoChatDeltaBuffer(onFlush, scheduler);

		buffer.enqueue({ content: "complete" });
		buffer.flush();
		scheduler.runAll();

		expect(onFlush).toHaveBeenCalledOnce();
		expect(onFlush).toHaveBeenCalledWith({
			content: "complete",
			reasoning: undefined,
		});
	});
});

function createManualScheduler() {
	let nextFrame = 1;
	const callbacks = new Map<number, () => void>();
	return {
		schedule(callback: () => void) {
			const frame = nextFrame++;
			callbacks.set(frame, callback);
			return frame;
		},
		cancel(frame: number) {
			callbacks.delete(frame);
		},
		runAll() {
			const scheduled = [...callbacks.values()];
			callbacks.clear();
			for (const callback of scheduled) callback();
		},
	};
}
