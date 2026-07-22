import { sql } from "drizzle-orm";
import {
	check,
	integer,
	primaryKey,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";

export const anonymousAnalyticsMetrics = [
	"landing_page_loaded",
	"demo_credential_issued",
	"demo_inference_started",
	"demo_inference_completed",
	"demo_inference_rejected",
	"demo_inference_failed",
	"demo_inference_cancelled",
] as const;

export type AnonymousAnalyticsMetric =
	(typeof anonymousAnalyticsMetrics)[number];

export const anonymousHourlyAnalytics = sqliteTable(
	"anonymous_hourly_analytics",
	{
		bucketStartedAt: integer("bucket_started_at").notNull(),
		metric: text("metric", { enum: anonymousAnalyticsMetrics }).notNull(),
		count: integer("count").notNull().default(0),
	},
	(table) => [
		primaryKey({ columns: [table.bucketStartedAt, table.metric] }),
		check(
			"anonymous_hourly_analytics_metric_check",
			sql`${table.metric} in ('landing_page_loaded', 'demo_credential_issued', 'demo_inference_started', 'demo_inference_completed', 'demo_inference_rejected', 'demo_inference_failed', 'demo_inference_cancelled')`,
		),
		check("anonymous_hourly_analytics_count_check", sql`${table.count} >= 0`),
	],
);
