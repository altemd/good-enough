import { describe, expect, it, vi } from "vitest";

import type { GatewayLifecycleEvent } from "#/features/inference-gateway/lifecycle-events";
import { createLiveInferenceEventSource } from "./live-event-source.server";

const startedEvent: GatewayLifecycleEvent = {
	type: "inference.request_started",
	requestId: "request-1",
	occurredAt: "2026-07-22T00:00:00.000Z",
	requestKind: "generation",
};

describe("principal-scoped live inference event source", () => {
	it("does not replay events published before a subscriber connects", () => {
		const source = createLiveInferenceEventSource();
		const listener = vi.fn();

		source.publishToPrincipal("alice", startedEvent);
		const unsubscribe = source.subscribe("alice", listener);

		expect(listener).not.toHaveBeenCalled();
		source.publishToPrincipal("alice", startedEvent);
		expect(listener).toHaveBeenCalledOnce();
		unsubscribe();
	});

	it("delivers an event only to subscribers for the matching principal", () => {
		const source = createLiveInferenceEventSource();
		const aliceListener = vi.fn();
		const bobListener = vi.fn();
		source.subscribe("alice", aliceListener);
		source.subscribe("bob", bobListener);

		source.publishToPrincipal("alice", startedEvent);

		expect(aliceListener).toHaveBeenCalledWith(startedEvent);
		expect(bobListener).not.toHaveBeenCalled();
	});

	it("isolates failing subscribers from inference and sibling tabs", () => {
		const source = createLiveInferenceEventSource();
		const healthyListener = vi.fn();
		source.subscribe("alice", () => {
			throw new Error("observer failed");
		});
		source.subscribe("alice", healthyListener);

		expect(() =>
			source.publishToPrincipal("alice", startedEvent),
		).not.toThrow();
		expect(healthyListener).toHaveBeenCalledWith(startedEvent);
	});

	it("returns an idempotent unsubscribe function", () => {
		const source = createLiveInferenceEventSource();
		const listener = vi.fn();
		const unsubscribe = source.subscribe("alice", listener);

		unsubscribe();
		unsubscribe();
		source.publishToPrincipal("alice", startedEvent);

		expect(listener).not.toHaveBeenCalled();
	});
});
