import { describe, expect, it } from "vitest";

import { createGenerationAdmissionController } from "./admission";

describe("generation admission", () => {
	it("admits one generation and rejects concurrent work without queueing", () => {
		const admission = createGenerationAdmissionController();

		expect(admission.snapshot()).toEqual({
			activeGenerations: 0,
			queuedGenerations: 0,
			concurrencyLimit: 1,
		});

		const first = admission.tryAcquire();
		expect(first).toMatchObject({
			admitted: true,
			lease: {
				snapshot: {
					activeGenerations: 1,
					queuedGenerations: 0,
					concurrencyLimit: 1,
				},
			},
		});

		const second = admission.tryAcquire();
		expect(second).toEqual({
			admitted: false,
			snapshot: {
				activeGenerations: 1,
				queuedGenerations: 0,
				concurrencyLimit: 1,
			},
		});
	});

	it("reopens capacity after an idempotent release", () => {
		const admission = createGenerationAdmissionController();
		const first = admission.tryAcquire();
		if (!first.admitted) {
			throw new Error("Expected the first generation to be admitted");
		}

		first.lease.release();
		first.lease.release();

		expect(admission.snapshot().activeGenerations).toBe(0);
		expect(admission.tryAcquire().admitted).toBe(true);
	});
});
