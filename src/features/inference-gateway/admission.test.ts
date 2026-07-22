import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createGenerationAdmissionController,
	readGenerationAdmissionConfig,
} from "./admission";

const CONFIG = {
	maxQueuedGenerations: 3,
	maxQueuedGenerationsPerPrincipal: 2,
	queueTimeoutMs: 1_000,
};

afterEach(() => {
	vi.useRealTimers();
});

describe("generation admission", () => {
	it("admits one generation and queues the next until release", async () => {
		const admission = createGenerationAdmissionController(CONFIG);
		const first = admission.acquire({
			principalId: "account-a",
			signal: new AbortController().signal,
		});
		expect(first.status).toBe("admitted");
		if (first.status !== "admitted") {
			throw new Error("Expected the first generation to be admitted");
		}

		const second = admission.acquire({
			principalId: "account-a",
			signal: new AbortController().signal,
		});
		expect(second.status).toBe("queued");
		if (second.status !== "queued") {
			throw new Error("Expected the second generation to be queued");
		}
		expect(admission.snapshot("account-a")).toEqual({
			activeGenerations: 1,
			queuedGenerations: 1,
			concurrencyLimit: 1,
			queueLimit: 3,
			principalQueuedGenerations: 1,
			principalQueueLimit: 2,
		});

		first.lease.release();
		const admitted = await second.wait;
		expect(admitted.status).toBe("admitted");
		if (admitted.status === "admitted") {
			admitted.lease.release();
		}
		expect(admission.snapshot().activeGenerations).toBe(0);
	});

	it("keeps FIFO order within a principal and rotates between principals", async () => {
		const admission = createGenerationAdmissionController(CONFIG);
		const active = admission.acquire({
			principalId: "active",
			signal: new AbortController().signal,
		});
		if (active.status !== "admitted") {
			throw new Error("Expected an active lease");
		}

		const a1 = queue(admission, "account-a");
		const a2 = queue(admission, "account-a");
		const b1 = queue(admission, "account-b");
		active.lease.release();

		const admittedA1 = await a1.wait;
		expect(admittedA1.status).toBe("admitted");
		if (admittedA1.status !== "admitted") {
			throw new Error("Expected account A's first waiter");
		}
		admittedA1.lease.release();

		const admittedB1 = await b1.wait;
		expect(admittedB1.status).toBe("admitted");
		if (admittedB1.status !== "admitted") {
			throw new Error("Expected account B's waiter");
		}
		admittedB1.lease.release();

		const admittedA2 = await a2.wait;
		expect(admittedA2.status).toBe("admitted");
		if (admittedA2.status === "admitted") {
			admittedA2.lease.release();
		}
	});

	it("rejects exact per-principal and global queue overflow", () => {
		const admission = createGenerationAdmissionController(CONFIG);
		const active = admission.acquire({
			principalId: "active",
			signal: new AbortController().signal,
		});
		if (active.status !== "admitted") {
			throw new Error("Expected an active lease");
		}
		queue(admission, "account-a");
		queue(admission, "account-a");

		expect(
			admission.acquire({
				principalId: "account-a",
				signal: new AbortController().signal,
			}),
		).toMatchObject({ status: "rejected", reason: "capacity_exceeded" });

		queue(admission, "account-b");
		expect(
			admission.acquire({
				principalId: "account-c",
				signal: new AbortController().signal,
			}),
		).toMatchObject({ status: "rejected", reason: "capacity_exceeded" });

		active.lease.release();
	});

	it("removes timed out and cancelled waiters exactly once", async () => {
		vi.useFakeTimers();
		const admission = createGenerationAdmissionController(CONFIG);
		const active = admission.acquire({
			principalId: "active",
			signal: new AbortController().signal,
		});
		if (active.status !== "admitted") {
			throw new Error("Expected an active lease");
		}

		const timedOut = queue(admission, "account-a");
		const cancellation = new AbortController();
		const cancelled = admission.acquire({
			principalId: "account-b",
			signal: cancellation.signal,
		});
		if (cancelled.status !== "queued") {
			throw new Error("Expected a queued request");
		}
		cancellation.abort();
		expect((await cancelled.wait).status).toBe("cancelled");

		await vi.advanceTimersByTimeAsync(CONFIG.queueTimeoutMs);
		expect((await timedOut.wait).status).toBe("timed_out");
		expect(admission.snapshot().queuedGenerations).toBe(0);
		active.lease.release();
		active.lease.release();
		expect(admission.snapshot().activeGenerations).toBe(0);
	});

	it("reads generous defaults and rejects invalid trusted configuration", () => {
		expect(readGenerationAdmissionConfig({})).toEqual({
			maxQueuedGenerations: 64,
			maxQueuedGenerationsPerPrincipal: 8,
			queueTimeoutMs: 600_000,
		});
		expect(() =>
			readGenerationAdmissionConfig({
				INFERENCE_MAX_QUEUED_GENERATIONS: "2",
				INFERENCE_MAX_QUEUED_GENERATIONS_PER_PRINCIPAL: "3",
			}),
		).toThrow();
		expect(() =>
			readGenerationAdmissionConfig({
				INFERENCE_QUEUE_TIMEOUT_SECONDS: "0",
			}),
		).toThrow();
	});
});

function queue(
	admission: ReturnType<typeof createGenerationAdmissionController>,
	principalId: string,
) {
	const attempt = admission.acquire({
		principalId,
		signal: new AbortController().signal,
	});
	if (attempt.status !== "queued") {
		throw new Error("Expected a queued request");
	}
	return attempt;
}
