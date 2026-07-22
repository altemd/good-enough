import "@tanstack/react-start/server-only";

import {
	type AnonymousAnalyticsIncrement,
	analyticsHour,
	persistAnonymousAnalyticsBatch,
} from "./anonymous-analytics.server";
import type { AnonymousAnalyticsMetric } from "./schema";

const DEFAULT_FLUSH_INTERVAL_MS = 5_000;
const DEFAULT_MAX_PENDING_ENTRIES = 512;

type BatchPersister = (
	increments: readonly AnonymousAnalyticsIncrement[],
) => void;

export interface AnonymousAnalyticsRecorder {
	record(metric: AnonymousAnalyticsMetric, now?: number): boolean;
	flush(): boolean;
	dispose(): void;
	pendingEntryCount(): number;
}

export function createAnonymousAnalyticsRecorder(options: {
	persist: BatchPersister;
	flushIntervalMs?: number;
	maxPendingEntries?: number;
}): AnonymousAnalyticsRecorder {
	const pending = new Map<string, AnonymousAnalyticsIncrement>();
	const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
	const maxPendingEntries =
		options.maxPendingEntries ?? DEFAULT_MAX_PENDING_ENTRIES;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const schedule = () => {
		if (timer !== undefined || pending.size === 0) return;
		timer = setTimeout(() => {
			timer = undefined;
			flush();
		}, flushIntervalMs);
		timer.unref?.();
	};
	const merge = (increment: AnonymousAnalyticsIncrement): boolean => {
		const key = `${increment.bucketStartedAt}:${increment.metric}`;
		const current = pending.get(key);
		if (current) {
			current.count += increment.count;
			return true;
		}
		if (pending.size >= maxPendingEntries) return false;
		pending.set(key, { ...increment });
		return true;
	};
	const flush = (): boolean => {
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
		if (pending.size === 0) return true;
		const batch = [...pending.values()];
		pending.clear();
		try {
			options.persist(batch);
			return true;
		} catch {
			for (const increment of batch) merge(increment);
			schedule();
			return false;
		}
	};

	return {
		record(metric, now = Date.now()) {
			const accepted = merge({
				bucketStartedAt: analyticsHour(now),
				metric,
				count: 1,
			});
			if (accepted) schedule();
			return accepted;
		},
		flush,
		dispose() {
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
			pending.clear();
		},
		pendingEntryCount: () => pending.size,
	};
}

const anonymousAnalyticsRecorder = createAnonymousAnalyticsRecorder({
	persist: persistAnonymousAnalyticsBatch,
});

export function enqueueAnonymousAnalyticsMetric(
	metric: AnonymousAnalyticsMetric,
	now = Date.now(),
): boolean {
	return anonymousAnalyticsRecorder.record(metric, now);
}

export function flushAnonymousAnalyticsMetrics(): boolean {
	return anonymousAnalyticsRecorder.flush();
}
