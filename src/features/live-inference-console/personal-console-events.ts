import type { GatewayLifecycleEvent } from "#/features/inference-gateway/lifecycle-events";

export const PERSONAL_CONSOLE_EVENT_NAMES = [
	"inference.request_started",
	"inference.queued",
	"inference.admission_decided",
	"inference.first_output",
	"inference.terminal",
	"console.gap",
] as const;

export interface PersonalConsoleLine {
	readonly occurredAt: string | null;
	readonly requestId: string | null;
	readonly title: string;
	readonly details: readonly string[];
	readonly tone: "activity" | "error" | "muted" | "success" | "warning";
}

type JsonObject = Record<string, unknown>;
type LifecycleObject = JsonObject &
	Pick<GatewayLifecycleEvent, "occurredAt" | "requestId" | "requestKind">;

export function projectPersonalConsoleEvent(
	eventName: string,
	data: string,
): PersonalConsoleLine | null {
	let value: unknown;
	try {
		value = JSON.parse(data);
	} catch {
		return null;
	}

	if (!isObject(value) || value.type !== eventName) {
		return null;
	}
	if (eventName === "console.gap") {
		return projectGap(value);
	}
	if (!isLifecycleBase(value)) {
		return null;
	}

	switch (eventName) {
		case "inference.request_started":
			return lifecycleLine(
				value,
				"Request started",
				[formatRequestKind(value.requestKind)],
				"activity",
			);
		case "inference.queued":
			return projectQueued(value);
		case "inference.admission_decided":
			return projectAdmission(value);
		case "inference.first_output":
			return projectFirstOutput(value);
		case "inference.terminal":
			return projectTerminal(value);
		default:
			return null;
	}
}

function projectQueued(value: LifecycleObject): PersonalConsoleLine | null {
	if (!isCapacity(value.capacity)) {
		return null;
	}
	const capacity = value.capacity;
	return lifecycleLine(
		value,
		"Queued for capacity",
		[
			`${capacity.activeGenerations}/${capacity.concurrencyLimit} active`,
			`${capacity.queuedGenerations}/${capacity.queueLimit} queued globally`,
			`${capacity.principalQueuedGenerations}/${capacity.principalQueueLimit} queued by you`,
		],
		"warning",
	);
}

function projectGap(value: JsonObject): PersonalConsoleLine | null {
	if (!isPositiveInteger(value.droppedEvents)) {
		return null;
	}
	return {
		occurredAt: null,
		requestId: null,
		title: "Live event gap",
		details: [
			`${value.droppedEvents} ${value.droppedEvents === 1 ? "event was" : "events were"} dropped before this tab could read them.`,
		],
		tone: "warning",
	};
}

function projectAdmission(value: LifecycleObject): PersonalConsoleLine | null {
	if (
		(value.decision !== "admitted" && value.decision !== "rejected") ||
		!isCapacity(value.capacity)
	) {
		return null;
	}
	const capacity = value.capacity;
	return lifecycleLine(
		value,
		value.decision === "admitted" ? "Capacity admitted" : "Capacity rejected",
		[
			`${capacity.activeGenerations}/${capacity.concurrencyLimit} active`,
			`${capacity.queuedGenerations} queued`,
		],
		value.decision === "admitted" ? "activity" : "warning",
	);
}

function projectFirstOutput(
	value: LifecycleObject,
): PersonalConsoleLine | null {
	if (!isNonNegativeNumber(value.ttftMs)) {
		return null;
	}
	return lifecycleLine(
		value,
		"First output",
		[`TTFT ${formatDuration(value.ttftMs)}`],
		"activity",
	);
}

function projectTerminal(value: LifecycleObject): PersonalConsoleLine | null {
	if (
		!isTerminalResult(value.result) ||
		!isAdmissionStatus(value.admissionStatus) ||
		!isHttpStatus(value.responseStatus) ||
		!isNullableHttpStatus(value.upstreamStatus) ||
		!isNullableNonNegativeNumber(value.upstreamHeadersMs) ||
		!isNullableNonNegativeNumber(value.queueWaitMs) ||
		!isNonNegativeNumber(value.durationMs) ||
		!isCapacityOrNull(value.capacity) ||
		!isMetadata(value.metrics)
	) {
		return null;
	}

	const event = value as unknown as Extract<
		GatewayLifecycleEvent,
		{ type: "inference.terminal" }
	>;
	const details = [
		`gateway HTTP ${event.responseStatus}`,
		event.upstreamStatus === null
			? null
			: `upstream HTTP ${event.upstreamStatus}`,
		`duration ${formatDuration(event.durationMs)}`,
		event.queueWaitMs === null
			? null
			: `queue wait ${formatDuration(event.queueWaitMs)}`,
		event.metrics.ttftMs === null
			? null
			: `TTFT ${formatDuration(event.metrics.ttftMs)}`,
		metric("input", event.metrics.inputTokens, "tokens"),
		metric("output", event.metrics.outputTokens, "tokens"),
		metric("cached", event.metrics.cachedTokens, "tokens"),
		metric("prompt", event.metrics.promptTokensPerSecond, "tokens/s"),
		metric("generation", event.metrics.generationTokensPerSecond, "tokens/s"),
	].filter((detail): detail is string => detail !== null);

	return lifecycleLine(
		event,
		formatOutcome(event.result.outcome),
		details,
		terminalTone(event),
	);
}

function lifecycleLine(
	value: Pick<GatewayLifecycleEvent, "occurredAt" | "requestId">,
	title: string,
	details: readonly string[],
	tone: PersonalConsoleLine["tone"],
): PersonalConsoleLine {
	return {
		occurredAt: value.occurredAt,
		requestId: value.requestId,
		title,
		details,
		tone,
	};
}

function terminalTone(
	event: Extract<GatewayLifecycleEvent, { type: "inference.terminal" }>,
): PersonalConsoleLine["tone"] {
	if (event.result.outcome === "completed" && event.responseStatus < 400) {
		return "success";
	}
	if (event.result.outcome === "cancelled") {
		return "muted";
	}
	return event.responseStatus >= 500 ? "error" : "warning";
}

function formatRequestKind(
	value: GatewayLifecycleEvent["requestKind"],
): string {
	return value.replaceAll("_", " ");
}

function formatOutcome(
	value: Extract<
		GatewayLifecycleEvent,
		{ type: "inference.terminal" }
	>["result"]["outcome"],
): string {
	return value.replaceAll("_", " ");
}

function formatDuration(value: number): string {
	if (value < 1_000) {
		return `${Math.round(value)} ms`;
	}
	return `${(value / 1_000).toFixed(value < 10_000 ? 2 : 1)} s`;
}

function metric(
	label: string,
	value: number | null,
	unit: string,
): string | null {
	return value === null ? null : `${label} ${formatNumber(value)} ${unit}`;
}

function formatNumber(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function isLifecycleBase(value: JsonObject): value is LifecycleObject {
	return (
		typeof value.requestId === "string" &&
		value.requestId.length > 0 &&
		typeof value.occurredAt === "string" &&
		!Number.isNaN(Date.parse(value.occurredAt)) &&
		(value.requestKind === "discovery" ||
			value.requestKind === "generation" ||
			value.requestKind === "routing_rejection")
	);
}

function isCapacity(value: unknown): value is {
	readonly activeGenerations: number;
	readonly queuedGenerations: number;
	readonly concurrencyLimit: number;
	readonly queueLimit: number;
	readonly principalQueuedGenerations: number;
	readonly principalQueueLimit: number;
} {
	return (
		isObject(value) &&
		isNonNegativeInteger(value.activeGenerations) &&
		isNonNegativeInteger(value.queuedGenerations) &&
		isPositiveInteger(value.concurrencyLimit) &&
		isPositiveInteger(value.queueLimit) &&
		isNonNegativeInteger(value.principalQueuedGenerations) &&
		isPositiveInteger(value.principalQueueLimit)
	);
}

function isCapacityOrNull(value: unknown): boolean {
	return value === null || isCapacity(value);
}

function isMetadata(value: unknown): boolean {
	if (!isObject(value)) {
		return false;
	}
	return [
		value.ttftMs,
		value.inputTokens,
		value.outputTokens,
		value.totalTokens,
		value.cachedTokens,
		value.promptTokensPerSecond,
		value.generationTokensPerSecond,
	].every(isNullableNonNegativeNumber);
}

function isTerminalResult(value: unknown): boolean {
	if (!isObject(value)) {
		return false;
	}
	return (
		value.outcome === "cancelled" ||
		value.outcome === "completed" ||
		value.outcome === "configuration_error" ||
		value.outcome === "rejected" ||
		value.outcome === "upstream_error"
	);
}

function isAdmissionStatus(value: unknown): boolean {
	return (
		value === "admitted" || value === "not_applicable" || value === "rejected"
	);
}

function isHttpStatus(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= 100 &&
		value <= 599
	);
}

function isNullableHttpStatus(value: unknown): value is number | null {
	return value === null || isHttpStatus(value);
}

function isNullableNonNegativeNumber(value: unknown): value is number | null {
	return value === null || isNonNegativeNumber(value);
}

function isNonNegativeNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
