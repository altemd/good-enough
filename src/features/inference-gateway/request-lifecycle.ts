import type { AdmissionSnapshot, GenerationLease } from "./admission";
import type {
	GatewayAdmissionStatus,
	GatewayAuthenticationStatus,
	GatewayLifecycleEvent,
	GatewayLifecycleObserver,
	GatewayRejectionReason,
	GatewayRequestKind,
	GatewayTerminalResult,
} from "./lifecycle-events";
import {
	createStreamMetadataObserver,
	type StreamMetadata,
	type StreamMetadataObserver,
} from "./metadata";

export type GatewayOutcome = GatewayTerminalResult["outcome"];

export type {
	GatewayAdmissionStatus,
	GatewayAuthenticationStatus,
	GatewayRejectionReason,
} from "./lifecycle-events";

export interface InferenceRequestMetadata extends StreamMetadata {
	event: "inference_request";
	requestId: string;
	endpoint: string;
	startedAt: string;
	responseStatus: number;
	upstreamStatus: number | null;
	outcome: GatewayOutcome;
	rejectionReason: GatewayRejectionReason | null;
	authenticationStatus: GatewayAuthenticationStatus;
	admissionStatus: GatewayAdmissionStatus;
	concurrencyLimit: number | null;
	activeGenerationsAtAdmission: number | null;
	queuedGenerationsAtAdmission: number | null;
	queueWaitMs: number | null;
	upstreamHeadersMs: number | null;
	durationMs: number;
}

export type MetadataRecorder = (metadata: InferenceRequestMetadata) => void;

export interface GatewayRequestLifecycle {
	readonly requestId: string;
	elapsed(): number;
	recordFirstOutput(ttftMs: number): void;
	recordQueued(snapshot: AdmissionSnapshot): void;
	setAuthenticationStatus(status: GatewayAuthenticationStatus): void;
	setAdmission(
		status: GatewayAdmissionStatus,
		snapshot: AdmissionSnapshot,
		lease?: GenerationLease,
	): void;
	setUpstreamStatus(status: number): void;
	startObservation(observer: GatewayLifecycleObserver | undefined): void;
	finalize(
		result: GatewayTerminalResult,
		responseStatus: number,
		metadataObserver?: StreamMetadataObserver,
	): void;
}

export function createGatewayRequestLifecycle(options: {
	endpoint: string;
	requestKind: GatewayRequestKind;
	now: () => number;
	wallClock: () => Date;
	createRequestId?: () => string;
	readCapacitySnapshot?: () => AdmissionSnapshot;
	record?: MetadataRecorder;
}): GatewayRequestLifecycle {
	const startedAtMs = options.now();
	const startedAt = options.wallClock().toISOString();
	const requestId =
		options.createRequestId?.() ?? globalThis.crypto.randomUUID();
	const emptyObserver = createStreamMetadataObserver("none");
	let upstreamStatus: number | null = null;
	let upstreamHeadersMs: number | null = null;
	let queueStartedMs: number | null = null;
	let queueWaitMs: number | null = null;
	let authenticationStatus: GatewayAuthenticationStatus = "rejected";
	let admissionStatus: GatewayAdmissionStatus = "not_applicable";
	let admissionSnapshot: AdmissionSnapshot | null = null;
	let generationLease: GenerationLease | null = null;
	let lifecycleObserver: GatewayLifecycleObserver | null = null;
	let firstOutputObserved = false;
	let finalized = false;

	const elapsed = () => elapsedMilliseconds(options.now, startedAtMs);
	const observe = (createEvent: () => GatewayLifecycleEvent) => {
		if (lifecycleObserver === null) {
			return;
		}
		try {
			lifecycleObserver(createEvent());
		} catch {
			// Observability must never interrupt the proxied response.
		}
	};
	const eventBase = () => ({
		requestId,
		occurredAt: options.wallClock().toISOString(),
		requestKind: options.requestKind,
	});

	return {
		requestId,
		elapsed,
		recordFirstOutput(ttftMs) {
			if (firstOutputObserved || finalized) {
				return;
			}
			firstOutputObserved = true;
			observe(() => ({
				...eventBase(),
				type: "inference.first_output",
				ttftMs,
			}));
		},
		recordQueued(snapshot) {
			if (queueStartedMs !== null || finalized) {
				return;
			}
			queueStartedMs = elapsed();
			admissionSnapshot = snapshot;
			observe(() => ({
				...eventBase(),
				type: "inference.queued",
				capacity: snapshot,
			}));
		},
		setAuthenticationStatus(status) {
			authenticationStatus = status;
		},
		setAdmission(status, snapshot, lease) {
			if (queueStartedMs !== null && queueWaitMs === null) {
				queueWaitMs = Math.max(0, elapsed() - queueStartedMs);
			}
			admissionStatus = status;
			admissionSnapshot = snapshot;
			generationLease = lease ?? null;
			if (status !== "not_applicable") {
				observe(() => ({
					...eventBase(),
					type: "inference.admission_decided",
					decision: status,
					capacity: snapshot,
				}));
			}
		},
		setUpstreamStatus(status) {
			upstreamStatus = status;
			upstreamHeadersMs = elapsed();
		},
		startObservation(observer) {
			if (observer === undefined || lifecycleObserver !== null || finalized) {
				return;
			}
			lifecycleObserver = observer;
			observe(() => ({
				...eventBase(),
				type: "inference.request_started",
			}));
		},
		finalize(result, responseStatus, metadataObserver = emptyObserver) {
			if (finalized) {
				return;
			}
			finalized = true;
			generationLease?.release();

			const streamMetadata = metadataObserver.snapshot();
			const metadata: InferenceRequestMetadata = {
				event: "inference_request",
				requestId,
				endpoint: options.endpoint,
				startedAt,
				responseStatus,
				upstreamStatus,
				outcome: result.outcome,
				rejectionReason: result.outcome === "rejected" ? result.reason : null,
				authenticationStatus,
				admissionStatus,
				concurrencyLimit: admissionSnapshot?.concurrencyLimit ?? null,
				activeGenerationsAtAdmission:
					admissionSnapshot?.activeGenerations ?? null,
				queuedGenerationsAtAdmission:
					admissionSnapshot?.queuedGenerations ?? null,
				queueWaitMs,
				upstreamHeadersMs,
				durationMs: elapsed(),
				...streamMetadata,
			};

			observe(() => ({
				...eventBase(),
				type: "inference.terminal",
				result,
				admissionStatus,
				responseStatus,
				upstreamStatus,
				upstreamHeadersMs,
				queueWaitMs,
				durationMs: metadata.durationMs,
				capacity: readCurrentCapacity(
					options.readCapacitySnapshot,
					admissionSnapshot,
				),
				metrics: streamMetadata,
			}));

			try {
				options.record?.(metadata);
			} catch {
				// Observability must never interrupt the proxied response.
			}
		},
	};
}

function readCurrentCapacity(
	readCapacitySnapshot: (() => AdmissionSnapshot) | undefined,
	admissionSnapshot: AdmissionSnapshot | null,
): AdmissionSnapshot | null {
	if (admissionSnapshot === null) {
		return null;
	}

	try {
		return readCapacitySnapshot?.() ?? admissionSnapshot;
	} catch {
		return admissionSnapshot;
	}
}

function elapsedMilliseconds(now: () => number, startedAtMs: number): number {
	return Math.round((now() - startedAtMs) * 1000) / 1000;
}
