import { describe, expect, it, vi } from "vitest";

import { createAnonymousAnalyticsRecorder } from "./anonymous-analytics-recorder.server";

describe("bounded anonymous analytics recorder", () => {
	it("coalesces request-path events into one persistence batch", () => {
		const persist = vi.fn();
		const recorder = createAnonymousAnalyticsRecorder({
			persist,
			flushIntervalMs: 60_000,
		});
		const now = Date.UTC(2026, 6, 23, 2, 34);

		recorder.record("landing_page_loaded", now);
		recorder.record("landing_page_loaded", now + 1_000);
		recorder.record("demo_credential_issued", now);
		expect(persist).not.toHaveBeenCalled();
		expect(recorder.flush()).toBe(true);
		expect(persist).toHaveBeenCalledOnce();
		expect(persist).toHaveBeenCalledWith([
			{
				bucketStartedAt: Date.UTC(2026, 6, 23, 2),
				metric: "landing_page_loaded",
				count: 2,
			},
			{
				bucketStartedAt: Date.UTC(2026, 6, 23, 2),
				metric: "demo_credential_issued",
				count: 1,
			},
		]);
		recorder.dispose();
	});

	it("bounds distinct pending hour and metric entries", () => {
		const recorder = createAnonymousAnalyticsRecorder({
			persist: vi.fn(),
			flushIntervalMs: 60_000,
			maxPendingEntries: 2,
		});
		const now = Date.UTC(2026, 6, 23, 2);

		expect(recorder.record("landing_page_loaded", now)).toBe(true);
		expect(recorder.record("demo_credential_issued", now)).toBe(true);
		expect(recorder.record("landing_page_loaded", now)).toBe(true);
		expect(recorder.record("demo_inference_started", now)).toBe(false);
		expect(recorder.pendingEntryCount()).toBe(2);
		recorder.dispose();
	});

	it("retains a failed batch for a later retry without throwing", () => {
		const persist = vi
			.fn()
			.mockImplementationOnce(() => {
				throw new Error("synthetic database failure");
			})
			.mockImplementationOnce(() => {});
		const recorder = createAnonymousAnalyticsRecorder({
			persist,
			flushIntervalMs: 60_000,
		});

		recorder.record("landing_page_loaded", 0);
		expect(recorder.flush()).toBe(false);
		expect(recorder.pendingEntryCount()).toBe(1);
		expect(recorder.flush()).toBe(true);
		expect(recorder.pendingEntryCount()).toBe(0);
		expect(persist).toHaveBeenCalledTimes(2);
		recorder.dispose();
	});
});
