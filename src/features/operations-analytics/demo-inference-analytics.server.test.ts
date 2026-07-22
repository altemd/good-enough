import { describe, expect, it, vi } from "vitest";

import type {
	GatewayLifecycleEvent,
	GatewayTerminalResult,
} from "#/features/inference-gateway/lifecycle-events";
import { observeDemoInferenceAnalytics } from "./demo-inference-analytics.server";

const startedEvent = {
	type: "inference.request_started",
	requestId: "private-request-id",
	occurredAt: "2026-07-23T02:00:00.000Z",
	requestKind: "generation",
} as const satisfies GatewayLifecycleEvent;

describe("demo inference analytics adapter", () => {
	it("reduces demo generation lifecycles to anonymous metric names", () => {
		const record = vi.fn();
		observeDemoInferenceAnalytics(
			"demo:private-selector",
			startedEvent,
			record,
		);
		observeDemoInferenceAnalytics(
			"demo:private-selector",
			terminalEvent("completed"),
			record,
		);

		expect(record.mock.calls).toEqual([
			["demo_inference_started"],
			["demo_inference_completed"],
		]);
		expect(JSON.stringify(record.mock.calls)).not.toContain("private-selector");
		expect(JSON.stringify(record.mock.calls)).not.toContain(
			"private-request-id",
		);
	});

	it.each([
		[200, "demo_inference_completed"],
		[400, "demo_inference_rejected"],
		[429, "demo_inference_rejected"],
		[500, "demo_inference_failed"],
	] as const)("classifies a transport-completed %i response as %s", (responseStatus, expectedMetric) => {
		const record = vi.fn();
		observeDemoInferenceAnalytics(
			"demo:private-selector",
			terminalEvent("completed", responseStatus),
			record,
		);
		expect(record).toHaveBeenCalledWith(expectedMetric);
	});

	it("ignores personal requests and model discovery", () => {
		const record = vi.fn();
		observeDemoInferenceAnalytics("account-id", startedEvent, record);
		observeDemoInferenceAnalytics(
			"demo:private-selector",
			{ ...startedEvent, requestKind: "discovery" },
			record,
		);
		expect(record).not.toHaveBeenCalled();
	});
});

function terminalEvent(
	outcome:
		| "cancelled"
		| "completed"
		| "configuration_error"
		| "rejected"
		| "upstream_error",
	responseStatus = 200,
): GatewayLifecycleEvent {
	const result: GatewayTerminalResult =
		outcome === "rejected"
			? ({ outcome, reason: "capacity_exceeded" } as const)
			: outcome === "configuration_error"
				? ({ outcome, stage: "backend_configuration" } as const)
				: outcome === "upstream_error"
					? ({ outcome, stage: "connection" } as const)
					: outcome === "cancelled"
						? ({ outcome: "cancelled" } as const)
						: ({ outcome: "completed" } as const);
	return {
		type: "inference.terminal",
		requestId: "private-request-id",
		occurredAt: "2026-07-23T02:00:01.000Z",
		requestKind: "generation",
		result,
		admissionStatus: "admitted",
		responseStatus,
		upstreamStatus: responseStatus,
		upstreamHeadersMs: 10,
		queueWaitMs: null,
		durationMs: 1_000,
		capacity: {
			concurrencyLimit: 1,
			activeGenerations: 0,
			queuedGenerations: 0,
			queueLimit: 0,
			principalQueuedGenerations: 0,
			principalQueueLimit: 0,
		},
		metrics: {
			ttftMs: 100,
			inputTokens: 10,
			outputTokens: 20,
			totalTokens: 30,
			cachedTokens: 0,
			promptTokensPerSecond: 10,
			generationTokensPerSecond: 20,
		},
	};
}
