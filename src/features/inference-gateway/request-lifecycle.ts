import type { AdmissionSnapshot, GenerationLease } from "./admission";
import {
	createStreamMetadataObserver,
	type StreamMetadata,
	type StreamMetadataObserver,
} from "./metadata";

export type GatewayOutcome =
	| "cancelled"
	| "completed"
	| "configuration_error"
	| "rejected"
	| "upstream_error";

export type GatewayRejectionReason =
	| "authentication_failed"
	| "capacity_exceeded"
	| "method_not_allowed"
	| "not_found";

export type GatewayAdmissionStatus = "admitted" | "not_applicable" | "rejected";

export type GatewayAuthenticationStatus =
	| "authenticated"
	| "configuration_error"
	| "rejected";

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
	upstreamHeadersMs: number | null;
	durationMs: number;
}

export type MetadataRecorder = (metadata: InferenceRequestMetadata) => void;

export interface GatewayRequestLifecycle {
	readonly requestId: string;
	elapsed(): number;
	setAuthenticationStatus(status: GatewayAuthenticationStatus): void;
	setRejectionReason(reason: GatewayRejectionReason): void;
	setAdmission(
		status: GatewayAdmissionStatus,
		snapshot: AdmissionSnapshot,
		lease?: GenerationLease,
	): void;
	setUpstreamStatus(status: number): void;
	finalize(
		outcome: GatewayOutcome,
		responseStatus: number,
		metadataObserver?: StreamMetadataObserver,
	): void;
}

export function createGatewayRequestLifecycle(options: {
	endpoint: string;
	now: () => number;
	wallClock: () => Date;
	createRequestId?: () => string;
	record?: MetadataRecorder;
}): GatewayRequestLifecycle {
	const startedAtMs = options.now();
	const startedAt = options.wallClock().toISOString();
	const requestId =
		options.createRequestId?.() ?? globalThis.crypto.randomUUID();
	const emptyObserver = createStreamMetadataObserver("none");
	let upstreamStatus: number | null = null;
	let upstreamHeadersMs: number | null = null;
	let rejectionReason: GatewayRejectionReason | null = null;
	let authenticationStatus: GatewayAuthenticationStatus = "rejected";
	let admissionStatus: GatewayAdmissionStatus = "not_applicable";
	let admissionSnapshot: AdmissionSnapshot | null = null;
	let generationLease: GenerationLease | null = null;
	let finalized = false;

	const elapsed = () => elapsedMilliseconds(options.now, startedAtMs);

	return {
		requestId,
		elapsed,
		setAuthenticationStatus(status) {
			authenticationStatus = status;
		},
		setRejectionReason(reason) {
			rejectionReason = reason;
		},
		setAdmission(status, snapshot, lease) {
			admissionStatus = status;
			admissionSnapshot = snapshot;
			generationLease = lease ?? null;
		},
		setUpstreamStatus(status) {
			upstreamStatus = status;
			upstreamHeadersMs = elapsed();
		},
		finalize(outcome, responseStatus, metadataObserver = emptyObserver) {
			if (finalized) {
				return;
			}
			finalized = true;
			generationLease?.release();

			const metadata: InferenceRequestMetadata = {
				event: "inference_request",
				requestId,
				endpoint: options.endpoint,
				startedAt,
				responseStatus,
				upstreamStatus,
				outcome,
				rejectionReason,
				authenticationStatus,
				admissionStatus,
				concurrencyLimit: admissionSnapshot?.concurrencyLimit ?? null,
				activeGenerationsAtAdmission:
					admissionSnapshot?.activeGenerations ?? null,
				queuedGenerationsAtAdmission:
					admissionSnapshot?.queuedGenerations ?? null,
				upstreamHeadersMs,
				durationMs: elapsed(),
				...metadataObserver.snapshot(),
			};

			try {
				options.record?.(metadata);
			} catch {
				// Observability must never interrupt the proxied response.
			}
		},
	};
}

function elapsedMilliseconds(now: () => number, startedAtMs: number): number {
	return Math.round((now() - startedAtMs) * 1000) / 1000;
}
