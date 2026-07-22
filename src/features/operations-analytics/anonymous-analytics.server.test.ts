import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AccountTestContext } from "#/features/accounts/testing/account-test-context";
import { createAccountTestContext } from "#/features/accounts/testing/account-test-context";
import {
	analyticsHour,
	persistAnonymousAnalyticsBatch,
	readAnonymousAnalyticsSummary,
} from "./anonymous-analytics.server";
import type { AnonymousAnalyticsMetric } from "./schema";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

let context: AccountTestContext;

beforeEach(() => {
	context = createAccountTestContext();
});

afterEach(() => {
	context.dispose();
});

describe("anonymous operations analytics", () => {
	it("stores only hourly metrics and counts", () => {
		const now = Date.UTC(2026, 6, 23, 2, 34);
		record("landing_page_loaded", now);
		record("landing_page_loaded", now + 1_000);
		record("demo_credential_issued", now);
		record("demo_inference_started", now + HOUR_MS);

		const summary = readAnonymousAnalyticsSummary(
			context.database,
			now + HOUR_MS,
		);
		expect(summary.totals).toMatchObject({
			landingPageLoads: 2,
			demoCredentialsIssued: 1,
			demoInferenceStarted: 1,
		});
		expect(summary.recentBuckets).toHaveLength(2);
		expect(summary.recentBuckets[0]).toMatchObject({
			demoInferenceStarted: 1,
		});

		const columns = context.database.sqlite
			.prepare("pragma table_info(anonymous_hourly_analytics)")
			.all()
			.map((column) => (column as { name: string }).name);
		expect(columns).toEqual(["bucket_started_at", "metric", "count"]);
		expect(
			JSON.stringify(
				context.database.sqlite
					.prepare("select * from anonymous_hourly_analytics")
					.all(),
			),
		).not.toMatch(
			/private|prompt|response|reasoning|username|api.key|request.id|model/iu,
		);
	});

	it("retains historical aggregate buckets", () => {
		const startedAt = Date.UTC(2026, 5, 1);
		record("landing_page_loaded", startedAt);
		record("demo_credential_issued", startedAt + 31 * DAY_MS);

		const summary = readAnonymousAnalyticsSummary(
			context.database,
			startedAt + 31 * DAY_MS,
		);
		expect(summary.totals).toMatchObject({
			landingPageLoads: 1,
			demoCredentialsIssued: 1,
		});
		expect(
			context.database.sqlite
				.prepare("select count(*) as count from anonymous_hourly_analytics")
				.get(),
		).toEqual({ count: 2 });
	});
});

function record(metric: AnonymousAnalyticsMetric, now: number): void {
	persistAnonymousAnalyticsBatch(
		[{ bucketStartedAt: analyticsHour(now), metric, count: 1 }],
		context.database,
	);
}
