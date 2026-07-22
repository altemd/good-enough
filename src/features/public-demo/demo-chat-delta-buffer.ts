import type { DemoChatDelta } from "./demo-chat-transport";

interface DeltaFlushScheduler {
	schedule: (callback: () => void) => number;
	cancel: (frame: number) => void;
}

const DEFAULT_SCHEDULER = createAnimationFrameScheduler();

export class DemoChatDeltaBuffer {
	private content = "";
	private reasoning = "";
	private frame: number | null = null;

	constructor(
		private readonly onFlush: (delta: DemoChatDelta) => void,
		private readonly scheduler: DeltaFlushScheduler = DEFAULT_SCHEDULER,
	) {}

	enqueue(delta: DemoChatDelta) {
		this.content += delta.content ?? "";
		this.reasoning += delta.reasoning ?? "";
		if (this.frame !== null) return;
		this.frame = this.scheduler.schedule(() => {
			this.frame = null;
			this.flush();
		});
	}

	flush() {
		if (this.frame !== null) {
			this.scheduler.cancel(this.frame);
			this.frame = null;
		}
		if (!this.content && !this.reasoning) return;
		const delta = {
			content: this.content || undefined,
			reasoning: this.reasoning || undefined,
		};
		this.content = "";
		this.reasoning = "";
		this.onFlush(delta);
	}
}

function createAnimationFrameScheduler(): DeltaFlushScheduler {
	if (
		typeof globalThis.requestAnimationFrame === "function" &&
		typeof globalThis.cancelAnimationFrame === "function"
	) {
		return {
			schedule: (callback) => globalThis.requestAnimationFrame(callback),
			cancel: (frame) => globalThis.cancelAnimationFrame(frame),
		};
	}

	return {
		schedule: (callback) => setTimeout(callback, 0) as unknown as number,
		cancel: (frame) => clearTimeout(frame),
	};
}
