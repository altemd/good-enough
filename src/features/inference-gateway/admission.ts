export const GENERATION_CONCURRENCY_LIMIT = 1;
export const DEFAULT_MAX_QUEUED_GENERATIONS = 64;
export const DEFAULT_MAX_QUEUED_GENERATIONS_PER_PRINCIPAL = 8;
export const DEFAULT_QUEUE_TIMEOUT_SECONDS = 600;

export interface GenerationAdmissionConfig {
	readonly maxQueuedGenerations: number;
	readonly maxQueuedGenerationsPerPrincipal: number;
	readonly queueTimeoutMs: number;
}

export interface AdmissionSnapshot {
	readonly activeGenerations: number;
	readonly queuedGenerations: number;
	readonly concurrencyLimit: number;
	readonly queueLimit: number;
	readonly principalQueuedGenerations: number;
	readonly principalQueueLimit: number;
}

export interface GenerationLease {
	readonly snapshot: AdmissionSnapshot;
	release(): void;
}

type AdmittedDecision = {
	readonly status: "admitted";
	readonly lease: GenerationLease;
};

type RejectedDecision = {
	readonly status: "rejected";
	readonly reason: "capacity_exceeded";
	readonly snapshot: AdmissionSnapshot;
};

export type QueuedAdmissionDecision =
	| AdmittedDecision
	| {
			readonly status: "cancelled";
			readonly snapshot: AdmissionSnapshot;
	  }
	| {
			readonly status: "timed_out";
			readonly snapshot: AdmissionSnapshot;
	  };

export type AdmissionAttempt =
	| AdmittedDecision
	| RejectedDecision
	| {
			readonly status: "queued";
			readonly snapshot: AdmissionSnapshot;
			readonly wait: Promise<QueuedAdmissionDecision>;
	  };

export interface GenerationAdmissionController {
	acquire(input: {
		readonly principalId: string;
		readonly signal: AbortSignal;
	}): AdmissionAttempt;
	snapshot(principalId?: string): AdmissionSnapshot;
}

interface QueuedWaiter {
	readonly principalId: string;
	readonly signal: AbortSignal;
	readonly onAbort: () => void;
	readonly resolve: (decision: QueuedAdmissionDecision) => void;
	timer: ReturnType<typeof setTimeout> | undefined;
	settled: boolean;
}

export function readGenerationAdmissionConfig(
	environment: NodeJS.ProcessEnv,
): GenerationAdmissionConfig {
	const maxQueuedGenerations = readPositiveInteger(
		environment.INFERENCE_MAX_QUEUED_GENERATIONS,
		"INFERENCE_MAX_QUEUED_GENERATIONS",
		DEFAULT_MAX_QUEUED_GENERATIONS,
	);
	const maxQueuedGenerationsPerPrincipal = readPositiveInteger(
		environment.INFERENCE_MAX_QUEUED_GENERATIONS_PER_PRINCIPAL,
		"INFERENCE_MAX_QUEUED_GENERATIONS_PER_PRINCIPAL",
		DEFAULT_MAX_QUEUED_GENERATIONS_PER_PRINCIPAL,
	);
	const queueTimeoutSeconds = readPositiveInteger(
		environment.INFERENCE_QUEUE_TIMEOUT_SECONDS,
		"INFERENCE_QUEUE_TIMEOUT_SECONDS",
		DEFAULT_QUEUE_TIMEOUT_SECONDS,
	);

	if (maxQueuedGenerationsPerPrincipal > maxQueuedGenerations) {
		throw new Error(
			"INFERENCE_MAX_QUEUED_GENERATIONS_PER_PRINCIPAL must not exceed INFERENCE_MAX_QUEUED_GENERATIONS",
		);
	}

	return {
		maxQueuedGenerations,
		maxQueuedGenerationsPerPrincipal,
		queueTimeoutMs: queueTimeoutSeconds * 1000,
	};
}

export function createGenerationAdmissionController(
	config: GenerationAdmissionConfig = {
		maxQueuedGenerations: DEFAULT_MAX_QUEUED_GENERATIONS,
		maxQueuedGenerationsPerPrincipal:
			DEFAULT_MAX_QUEUED_GENERATIONS_PER_PRINCIPAL,
		queueTimeoutMs: DEFAULT_QUEUE_TIMEOUT_SECONDS * 1000,
	},
): GenerationAdmissionController {
	validateConfig(config);

	let activeGenerations = 0;
	let queuedGenerations = 0;
	const waitersByPrincipal = new Map<string, QueuedWaiter[]>();
	const principalOrder: string[] = [];

	const snapshot = (principalId?: string): AdmissionSnapshot => ({
		activeGenerations,
		queuedGenerations,
		concurrencyLimit: GENERATION_CONCURRENCY_LIMIT,
		queueLimit: config.maxQueuedGenerations,
		principalQueuedGenerations:
			principalId === undefined
				? 0
				: (waitersByPrincipal.get(principalId)?.length ?? 0),
		principalQueueLimit: config.maxQueuedGenerationsPerPrincipal,
	});

	const removeWaiter = (waiter: QueuedWaiter): boolean => {
		if (waiter.settled) {
			return false;
		}
		const principalWaiters = waitersByPrincipal.get(waiter.principalId);
		const index = principalWaiters?.indexOf(waiter) ?? -1;
		if (!principalWaiters || index < 0) {
			return false;
		}

		principalWaiters.splice(index, 1);
		queuedGenerations -= 1;
		waiter.settled = true;
		if (waiter.timer !== undefined) {
			clearTimeout(waiter.timer);
		}
		waiter.signal.removeEventListener("abort", waiter.onAbort);
		if (principalWaiters.length === 0) {
			waitersByPrincipal.delete(waiter.principalId);
			const orderIndex = principalOrder.indexOf(waiter.principalId);
			if (orderIndex >= 0) {
				principalOrder.splice(orderIndex, 1);
			}
		}
		return true;
	};

	const createLease = (principalId: string): GenerationLease => {
		activeGenerations += 1;
		let released = false;
		return {
			snapshot: snapshot(principalId),
			release() {
				if (released) {
					return;
				}
				released = true;
				activeGenerations -= 1;
				dispatchNext();
			},
		};
	};

	const dispatchNext = () => {
		if (
			activeGenerations >= GENERATION_CONCURRENCY_LIMIT ||
			principalOrder.length === 0
		) {
			return;
		}

		const principalId = principalOrder.shift();
		if (principalId === undefined) {
			return;
		}
		const principalWaiters = waitersByPrincipal.get(principalId);
		const waiter = principalWaiters?.[0];
		if (!principalWaiters || waiter === undefined) {
			waitersByPrincipal.delete(principalId);
			dispatchNext();
			return;
		}

		removeWaiter(waiter);
		if (principalWaiters.length > 0) {
			principalOrder.push(principalId);
		}
		waiter.resolve({ status: "admitted", lease: createLease(principalId) });
	};

	return {
		acquire({ principalId, signal }) {
			if (signal.aborted) {
				return {
					status: "queued",
					snapshot: snapshot(principalId),
					wait: Promise.resolve({
						status: "cancelled",
						snapshot: snapshot(principalId),
					}),
				};
			}

			if (activeGenerations < GENERATION_CONCURRENCY_LIMIT) {
				return { status: "admitted", lease: createLease(principalId) };
			}

			const principalQueuedGenerations =
				waitersByPrincipal.get(principalId)?.length ?? 0;
			if (
				queuedGenerations >= config.maxQueuedGenerations ||
				principalQueuedGenerations >= config.maxQueuedGenerationsPerPrincipal
			) {
				return {
					status: "rejected",
					reason: "capacity_exceeded",
					snapshot: snapshot(principalId),
				};
			}

			let resolveWaiter: (decision: QueuedAdmissionDecision) => void = () => {};
			const wait = new Promise<QueuedAdmissionDecision>((resolve) => {
				resolveWaiter = resolve;
			});
			let waiter: QueuedWaiter;
			waiter = {
				principalId,
				signal,
				resolve: resolveWaiter,
				settled: false,
				timer: undefined,
				onAbort: () => {
					if (removeWaiter(waiter)) {
						waiter.resolve({
							status: "cancelled",
							snapshot: snapshot(principalId),
						});
					}
				},
			};

			const principalWaiters = waitersByPrincipal.get(principalId);
			if (principalWaiters) {
				principalWaiters.push(waiter);
			} else {
				waitersByPrincipal.set(principalId, [waiter]);
				principalOrder.push(principalId);
			}
			queuedGenerations += 1;
			waiter.timer = setTimeout(() => {
				if (removeWaiter(waiter)) {
					waiter.resolve({
						status: "timed_out",
						snapshot: snapshot(principalId),
					});
				}
			}, config.queueTimeoutMs);
			signal.addEventListener("abort", waiter.onAbort, { once: true });
			if (signal.aborted) {
				waiter.onAbort();
			}

			return {
				status: "queued",
				snapshot: snapshot(principalId),
				wait,
			};
		},
		snapshot,
	};
}

function readPositiveInteger(
	value: string | undefined,
	name: string,
	fallback: number,
): number {
	if (value === undefined || value === "") {
		return fallback;
	}
	if (!/^[1-9]\d*$/.test(value)) {
		throw new Error(`${name} must be a positive integer`);
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) {
		throw new Error(`${name} must be a safe positive integer`);
	}
	return parsed;
}

function validateConfig(config: GenerationAdmissionConfig): void {
	for (const [name, value] of Object.entries(config)) {
		if (!Number.isSafeInteger(value) || value <= 0) {
			throw new Error(`${name} must be a safe positive integer`);
		}
	}
	if (config.maxQueuedGenerationsPerPrincipal > config.maxQueuedGenerations) {
		throw new Error(
			"maxQueuedGenerationsPerPrincipal must not exceed maxQueuedGenerations",
		);
	}
}
