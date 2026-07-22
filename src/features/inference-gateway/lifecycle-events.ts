import type { AdmissionSnapshot } from "./admission";
import type { StreamMetadata } from "./metadata";

export type GatewayRequestKind =
	| "discovery"
	| "generation"
	| "routing_rejection";

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

export type GatewayFailureStage =
	| "authentication_configuration"
	| "backend_configuration";

export type UpstreamFailureStage = "connection" | "error_body" | "stream_body";

export type GatewayTerminalResult =
	| { readonly outcome: "cancelled" }
	| { readonly outcome: "completed" }
	| {
			readonly outcome: "configuration_error";
			readonly stage: GatewayFailureStage;
	  }
	| {
			readonly outcome: "rejected";
			readonly reason: GatewayRejectionReason;
	  }
	| {
			readonly outcome: "upstream_error";
			readonly stage: UpstreamFailureStage;
	  };

interface GatewayLifecycleEventBase {
	readonly requestId: string;
	readonly occurredAt: string;
	readonly requestKind: GatewayRequestKind;
}

/**
 * The complete privacy-filtered lifecycle contract. Every field is safe for
 * delivery to the account that owns the authenticated inference request.
 */
export type GatewayLifecycleEvent =
	| (GatewayLifecycleEventBase & {
			readonly type: "inference.request_started";
	  })
	| (GatewayLifecycleEventBase & {
			readonly type: "inference.admission_decided";
			readonly decision: Exclude<GatewayAdmissionStatus, "not_applicable">;
			readonly capacity: AdmissionSnapshot;
	  })
	| (GatewayLifecycleEventBase & {
			readonly type: "inference.first_output";
			readonly ttftMs: number;
	  })
	| (GatewayLifecycleEventBase & {
			readonly type: "inference.terminal";
			readonly result: GatewayTerminalResult;
			readonly admissionStatus: GatewayAdmissionStatus;
			readonly responseStatus: number;
			readonly upstreamStatus: number | null;
			readonly upstreamHeadersMs: number | null;
			readonly durationMs: number;
			readonly capacity: AdmissionSnapshot | null;
			readonly metrics: StreamMetadata;
	  });

export type GatewayLifecycleObserver = (event: GatewayLifecycleEvent) => void;

export type GatewayLifecycleObserverFactory = (context: {
	readonly principalId: string;
}) => GatewayLifecycleObserver | undefined;
