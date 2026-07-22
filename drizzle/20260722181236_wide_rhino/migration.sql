CREATE TABLE `anonymous_hourly_analytics` (
	`bucket_started_at` integer NOT NULL,
	`metric` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `anonymous_hourly_analytics_pk` PRIMARY KEY(`bucket_started_at`, `metric`),
	CONSTRAINT "anonymous_hourly_analytics_metric_check" CHECK("metric" in ('landing_page_loaded', 'demo_credential_issued', 'demo_inference_started', 'demo_inference_completed', 'demo_inference_rejected', 'demo_inference_failed', 'demo_inference_cancelled')),
	CONSTRAINT "anonymous_hourly_analytics_count_check" CHECK("count" >= 0)
);
