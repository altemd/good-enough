import "@tanstack/react-start/server-only";

import type { GatewayLifecycleEvent } from "#/features/inference-gateway/lifecycle-events";
import { enqueueAnonymousAnalyticsMetric } from "./anonymous-analytics-recorder.server";
import type { AnonymousAnalyticsMetric } from "./schema";

type AnalyticsRecorder = (metric: AnonymousAnalyticsMetric) => unknown;

export function observeDemoInferenceAnalytics(
	principalId: string,
	event: GatewayLifecycleEvent,
	record: AnalyticsRecorder = enqueueAnonymousAnalyticsMetric,
): void {
	if (!principalId.startsWith("demo:") || event.requestKind !== "generation") {
		return;
	}
	const metric = metricForEvent(event);
	if (metric) record(metric);
}

function metricForEvent(
	event: GatewayLifecycleEvent,
): AnonymousAnalyticsMetric | null {
	if (event.type === "inference.request_started") {
		return "demo_inference_started";
	}
	if (event.type !== "inference.terminal") return null;

	switch (event.result.outcome) {
		case "completed":
			if (event.responseStatus >= 200 && event.responseStatus < 300) {
				return "demo_inference_completed";
			}
			if (event.responseStatus >= 400 && event.responseStatus < 500) {
				return "demo_inference_rejected";
			}
			return "demo_inference_failed";
		case "rejected":
			return "demo_inference_rejected";
		case "cancelled":
			return "demo_inference_cancelled";
		case "configuration_error":
		case "upstream_error":
			return "demo_inference_failed";
	}
}
