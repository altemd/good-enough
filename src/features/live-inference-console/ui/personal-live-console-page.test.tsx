// @vitest-environment jsdom

import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	PERSONAL_CONSOLE_MAX_LINES,
	type PersonalConsoleEventSource,
	PersonalLiveConsolePage,
} from "./personal-live-console-page";

vi.mock("#/components/ui/page-layout", () => ({
	PageLayout: ({
		title,
		children,
	}: {
		title: string;
		children: React.ReactNode;
	}) => (
		<main>
			<h1>{title}</h1>
			{children}
		</main>
	),
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("personal live inference console page", () => {
	it("starts empty and renders only allowlisted fields from live events", () => {
		const source = new FakeEventSource();
		const createEventSource = vi.fn(() => source);

		render(<PersonalLiveConsolePage createEventSource={createEventSource} />);

		expect(createEventSource).toHaveBeenCalledWith("/api/live-console/events");
		expect(screen.getByText("Waiting for a personal request…")).toBeTruthy();
		expect(screen.getByText(/Request timing is live-only/)).toBeTruthy();
		expect(screen.getByRole("status")).toBeTruthy();
		expect(screen.getByText("connecting")).toBeTruthy();
		expect(screen.getByRole("list")).toBeTruthy();

		act(() => source.open());
		expect(screen.getByText("live")).toBeTruthy();

		act(() =>
			source.emit("inference.request_started", {
				type: "inference.request_started",
				requestId: "request-visible",
				occurredAt: "2026-07-22T01:02:03.000Z",
				requestKind: "generation",
				prompt: "private prompt sentinel",
				principalId: "private principal sentinel",
			}),
		);

		expect(screen.getByText("Request started")).toBeTruthy();
		expect(screen.getByText("request-visible")).toBeTruthy();
		expect(screen.getByText("generation")).toBeTruthy();
		expect(screen.getByText("01:02:03Z")).toBeTruthy();
		expect(screen.queryByText(/private prompt sentinel/)).toBeNull();
		expect(screen.queryByText(/private principal sentinel/)).toBeNull();
	});

	it("shows terminal measurements and an explicit transport gap", () => {
		const source = new FakeEventSource();
		render(<PersonalLiveConsolePage createEventSource={() => source} />);

		act(() =>
			source.emit("inference.queued", {
				type: "inference.queued",
				requestId: "terminal-request",
				occurredAt: "2026-07-22T01:02:02.000Z",
				requestKind: "generation",
				capacity: {
					activeGenerations: 1,
					queuedGenerations: 3,
					concurrencyLimit: 1,
					queueLimit: 64,
					principalQueuedGenerations: 2,
					principalQueueLimit: 8,
				},
			}),
		);
		act(() =>
			source.emit("inference.admission_decided", {
				type: "inference.admission_decided",
				requestId: "terminal-request",
				occurredAt: "2026-07-22T01:02:03.000Z",
				requestKind: "generation",
				decision: "admitted",
				capacity: {
					activeGenerations: 1,
					queuedGenerations: 0,
					concurrencyLimit: 1,
					queueLimit: 64,
					principalQueuedGenerations: 0,
					principalQueueLimit: 8,
				},
			}),
		);
		act(() =>
			source.emit("inference.first_output", {
				type: "inference.first_output",
				requestId: "terminal-request",
				occurredAt: "2026-07-22T01:02:03.125Z",
				requestKind: "generation",
				ttftMs: 125,
			}),
		);
		act(() =>
			source.emit("inference.terminal", {
				type: "inference.terminal",
				requestId: "terminal-request",
				occurredAt: "2026-07-22T01:02:04.000Z",
				requestKind: "generation",
				result: { outcome: "completed" },
				admissionStatus: "admitted",
				responseStatus: 200,
				upstreamStatus: 200,
				upstreamHeadersMs: 25,
				queueWaitMs: null,
				durationMs: 1_250,
				capacity: {
					activeGenerations: 1,
					queuedGenerations: 0,
					concurrencyLimit: 1,
					queueLimit: 64,
					principalQueuedGenerations: 0,
					principalQueueLimit: 8,
				},
				metrics: {
					ttftMs: 125,
					inputTokens: 42,
					outputTokens: 8,
					totalTokens: 50,
					cachedTokens: 30,
					promptTokensPerSecond: 84.5,
					generationTokensPerSecond: 12.25,
				},
			}),
		);
		act(() =>
			source.emit("console.gap", {
				type: "console.gap",
				droppedEvents: 3,
			}),
		);

		expect(screen.getByText("Capacity admitted")).toBeTruthy();
		expect(screen.getByText("Queued for capacity")).toBeTruthy();
		expect(
			screen.getByText("1/1 active · 3/64 queued globally · 2/8 queued by you"),
		).toBeTruthy();
		expect(screen.getByText("1/1 active · 0 queued")).toBeTruthy();
		expect(screen.getByText("First output")).toBeTruthy();
		expect(screen.getByText("completed")).toBeTruthy();
		expect(
			screen.getByText(
				"gateway HTTP 200 · upstream HTTP 200 · duration 1.25 s · TTFT 125 ms · input 42 tokens · output 8 tokens · cached 30 tokens · prompt 84.50 tokens/s · generation 12.25 tokens/s",
			),
		).toBeTruthy();
		expect(screen.getByText("Live event gap")).toBeTruthy();
		expect(
			screen.getByText(
				"3 events were dropped before this tab could read them.",
			),
		).toBeTruthy();
	});

	it("retains only the latest 200 projected lines", () => {
		const source = new FakeEventSource();
		render(<PersonalLiveConsolePage createEventSource={() => source} />);

		act(() => {
			for (let index = 1; index <= PERSONAL_CONSOLE_MAX_LINES + 1; index += 1) {
				source.emit("inference.request_started", {
					type: "inference.request_started",
					requestId: `request-${String(index).padStart(3, "0")}`,
					occurredAt: "2026-07-22T01:02:03.000Z",
					requestKind: "generation",
				});
			}
		});

		expect(screen.getAllByRole("listitem")).toHaveLength(
			PERSONAL_CONSOLE_MAX_LINES,
		);
		expect(screen.queryByText("request-001")).toBeNull();
		expect(screen.getByText("request-201")).toBeTruthy();
	});

	it("reconnects through a fresh event source after a failure", () => {
		const sources: FakeEventSource[] = [];
		const createEventSource = vi.fn(() => {
			const source = new FakeEventSource();
			sources.push(source);
			return source;
		});

		render(<PersonalLiveConsolePage createEventSource={createEventSource} />);

		act(() => sources[0].fail());
		expect(screen.getByRole("status")).toBeTruthy();
		expect(screen.getByText("disconnected")).toBeTruthy();
		expect(sources[0].close).toHaveBeenCalled();

		act(() => {
			fireEvent.click(screen.getByRole("button", { name: "Try to reconnect" }));
		});

		expect(createEventSource).toHaveBeenCalledTimes(2);
		expect(sources[1]).toBeTruthy();
		act(() => sources[1].open());
		expect(screen.getByText("live")).toBeTruthy();
	});

	it("keeps history in component memory only and closes the stream", () => {
		const storageWrite = vi.spyOn(Storage.prototype, "setItem");
		const firstSource = new FakeEventSource();
		const firstRender = render(
			<PersonalLiveConsolePage createEventSource={() => firstSource} />,
		);
		act(() =>
			firstSource.emit("inference.request_started", {
				type: "inference.request_started",
				requestId: "old-request",
				occurredAt: "2026-07-22T01:02:03.000Z",
				requestKind: "generation",
			}),
		);
		expect(screen.getByText("old-request")).toBeTruthy();

		firstRender.unmount();
		expect(firstSource.close).toHaveBeenCalledOnce();

		const secondSource = new FakeEventSource();
		render(<PersonalLiveConsolePage createEventSource={() => secondSource} />);
		expect(screen.getByText("Waiting for a personal request…")).toBeTruthy();
		expect(screen.queryByText("old-request")).toBeNull();
		expect(storageWrite).not.toHaveBeenCalled();

		act(() => secondSource.fail());
		expect(screen.getByText("disconnected")).toBeTruthy();
		expect(secondSource.close).toHaveBeenCalledOnce();
	});
});

class FakeEventSource implements PersonalConsoleEventSource {
	readonly listeners = new Map<
		string,
		Array<(event: MessageEvent<string>) => void>
	>();
	readonly close = vi.fn();
	onerror: ((event: Event) => void) | null = null;
	onopen: ((event: Event) => void) | null = null;

	addEventListener(
		type: string,
		listener: (event: MessageEvent<string>) => void,
	) {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	emit(type: string, value: unknown) {
		const event = new MessageEvent<string>(type, {
			data: JSON.stringify(value),
		});
		for (const listener of this.listeners.get(type) ?? []) {
			listener(event);
		}
	}

	open() {
		this.onopen?.(new Event("open"));
	}

	fail() {
		this.onerror?.(new Event("error"));
	}
}
