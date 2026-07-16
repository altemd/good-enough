export const GENERATION_CONCURRENCY_LIMIT = 1;

export interface AdmissionSnapshot {
	readonly activeGenerations: number;
	readonly queuedGenerations: number;
	readonly concurrencyLimit: number;
}

export interface GenerationLease {
	readonly snapshot: AdmissionSnapshot;
	release(): void;
}

export type AdmissionDecision =
	| {
			readonly admitted: true;
			readonly lease: GenerationLease;
	  }
	| {
			readonly admitted: false;
			readonly snapshot: AdmissionSnapshot;
	  };

export interface GenerationAdmissionController {
	tryAcquire(): AdmissionDecision;
	snapshot(): AdmissionSnapshot;
}

export function createGenerationAdmissionController(): GenerationAdmissionController {
	let activeGenerations = 0;

	const snapshot = (): AdmissionSnapshot => ({
		activeGenerations,
		queuedGenerations: 0,
		concurrencyLimit: GENERATION_CONCURRENCY_LIMIT,
	});

	return {
		tryAcquire() {
			if (activeGenerations >= GENERATION_CONCURRENCY_LIMIT) {
				return { admitted: false, snapshot: snapshot() };
			}

			activeGenerations += 1;
			let released = false;
			const lease: GenerationLease = {
				snapshot: snapshot(),
				release() {
					if (released) {
						return;
					}

					released = true;
					activeGenerations -= 1;
				},
			};

			return { admitted: true, lease };
		},
		snapshot,
	};
}
