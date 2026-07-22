import "@tanstack/react-start/server-only";

import { asc, sql } from "drizzle-orm";

import {
	type AccountDatabase,
	getAccountDatabase,
} from "#/features/accounts/db.server";
import {
	type AnonymousAnalyticsMetric,
	anonymousHourlyAnalytics,
} from "./schema";

const HOUR_MS = 60 * 60 * 1000;
const RECENT_HOURS = 24;

export interface AnonymousAnalyticsCounts {
	landingPageLoads: number;
	demoCredentialsIssued: number;
	demoInferenceStarted: number;
	demoInferenceCompleted: number;
	demoInferenceRejected: number;
	demoInferenceFailed: number;
	demoInferenceCancelled: number;
}

export interface AnonymousAnalyticsBucket extends AnonymousAnalyticsCounts {
	bucketStartedAt: number;
}

export interface AnonymousAnalyticsSummary {
	generatedAt: number;
	totals: AnonymousAnalyticsCounts;
	recentBuckets: AnonymousAnalyticsBucket[];
}

export interface AnonymousAnalyticsIncrement {
	bucketStartedAt: number;
	metric: AnonymousAnalyticsMetric;
	count: number;
}

export function persistAnonymousAnalyticsBatch(
	increments: readonly AnonymousAnalyticsIncrement[],
	database: AccountDatabase = getAccountDatabase(),
): void {
	if (increments.length === 0) return;
	database.db.transaction(
		(transaction) => {
			for (const increment of increments) {
				transaction
					.insert(anonymousHourlyAnalytics)
					.values(increment)
					.onConflictDoUpdate({
						target: [
							anonymousHourlyAnalytics.bucketStartedAt,
							anonymousHourlyAnalytics.metric,
						],
						set: {
							count: sql`${anonymousHourlyAnalytics.count} + ${increment.count}`,
						},
					})
					.run();
			}
		},
		{ behavior: "immediate" },
	);
}

export function readAnonymousAnalyticsSummary(
	database: AccountDatabase = getAccountDatabase(),
	now = Date.now(),
): AnonymousAnalyticsSummary {
	const currentBucket = analyticsHour(now);
	const recentMinimumBucket = currentBucket - (RECENT_HOURS - 1) * HOUR_MS;
	const rows = database.db
		.select()
		.from(anonymousHourlyAnalytics)
		.orderBy(
			asc(anonymousHourlyAnalytics.bucketStartedAt),
			asc(anonymousHourlyAnalytics.metric),
		)
		.all();
	const totals = emptyCounts();
	const buckets = new Map<number, AnonymousAnalyticsBucket>();

	for (const row of rows) {
		incrementCounts(totals, row.metric, row.count);
		if (row.bucketStartedAt < recentMinimumBucket) continue;
		const bucket =
			buckets.get(row.bucketStartedAt) ??
			({
				bucketStartedAt: row.bucketStartedAt,
				...emptyCounts(),
			} satisfies AnonymousAnalyticsBucket);
		incrementCounts(bucket, row.metric, row.count);
		buckets.set(row.bucketStartedAt, bucket);
	}

	return {
		generatedAt: now,
		totals,
		recentBuckets: [...buckets.values()].reverse(),
	};
}

export function analyticsHour(timestamp: number): number {
	return Math.floor(timestamp / HOUR_MS) * HOUR_MS;
}

function emptyCounts(): AnonymousAnalyticsCounts {
	return {
		landingPageLoads: 0,
		demoCredentialsIssued: 0,
		demoInferenceStarted: 0,
		demoInferenceCompleted: 0,
		demoInferenceRejected: 0,
		demoInferenceFailed: 0,
		demoInferenceCancelled: 0,
	};
}

function incrementCounts(
	counts: AnonymousAnalyticsCounts,
	metric: AnonymousAnalyticsMetric,
	amount: number,
): void {
	switch (metric) {
		case "landing_page_loaded":
			counts.landingPageLoads += amount;
			break;
		case "demo_credential_issued":
			counts.demoCredentialsIssued += amount;
			break;
		case "demo_inference_started":
			counts.demoInferenceStarted += amount;
			break;
		case "demo_inference_completed":
			counts.demoInferenceCompleted += amount;
			break;
		case "demo_inference_rejected":
			counts.demoInferenceRejected += amount;
			break;
		case "demo_inference_failed":
			counts.demoInferenceFailed += amount;
			break;
		case "demo_inference_cancelled":
			counts.demoInferenceCancelled += amount;
			break;
	}
}
