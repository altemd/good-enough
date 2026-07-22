import { describe, expect, it, vi } from "vitest";

import type { BrowserSession } from "#/features/accounts/sessions/sessions.server";
import type { GatewayLifecycleEvent } from "#/features/inference-gateway/lifecycle-events";
import { createLiveInferenceEventSource } from "./live-event-source.server";
import {
	handlePersonalEventStreamRequest,
	type PersonalEventStreamDependencies,
} from "./personal-event-stream.server";

const decoder = new TextDecoder();
const baseSession: BrowserSession = {
	id: "session-alice",
	expiresAt: 60_000,
	restricted: false,
	user: {
		id: "alice",
		username: "Alice",
		role: "member",
		mustChangePassword: false,
	},
};

describe("authenticated personal lifecycle SSE transport", () => {
	it("rejects unsupported methods without opening a subscription", () => {
		const eventSource = createLiveInferenceEventSource();
		const subscribe = vi.spyOn(eventSource, "subscribe");
		const response = handlePersonalEventStreamRequest(
			new Request("https://app.example/api/live-console/events", {
				method: "POST",
			}),
			createDependencies({ eventSource }),
		);

		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("GET");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(subscribe).not.toHaveBeenCalled();
	});

	it.each([
		{
			name: "missing session cookie",
			cookie: null,
			readSession: () => baseSession,
			status: 401,
		},
		{
			name: "duplicate session cookie",
			cookie: "ge_session_dev=first; ge_session_dev=second",
			readSession: () => baseSession,
			status: 401,
		},
		{
			name: "unknown or expired session",
			cookie: "ge_session_dev=session-token",
			readSession: () => null,
			status: 401,
		},
		{
			name: "restricted session",
			cookie: "ge_session_dev=session-token",
			readSession: () => ({ ...baseSession, restricted: true }),
			status: 403,
		},
	] as const)("rejects $name", ({ cookie, readSession, status }) => {
		const eventSource = createLiveInferenceEventSource();
		const subscribe = vi.spyOn(eventSource, "subscribe");
		const response = handlePersonalEventStreamRequest(
			createRequest(cookie),
			createDependencies({ eventSource, readSession }),
		);

		expect(response.status).toBe(status);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(subscribe).not.toHaveBeenCalled();
	});

	it("returns a sanitized 500 when session persistence is unavailable", () => {
		const response = handlePersonalEventStreamRequest(
			createRequest("ge_session_dev=session-token"),
			createDependencies({
				readSession() {
					throw new Error("PRIVATE_DATABASE_FAILURE");
				},
			}),
		);

		expect(response.status).toBe(500);
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it("derives the principal from the session and streams only matching events", async () => {
		const eventSource = createLiveInferenceEventSource();
		const response = handlePersonalEventStreamRequest(
			new Request(
				"https://app.example/api/live-console/events?principalId=bob",
				{
					headers: {
						cookie:
							"unrelated=value; ge_session_dev=session-token; another=value",
					},
				},
			),
			createDependencies({ eventSource }),
		);
		const reader = response.body?.getReader();

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe(
			"text/event-stream; charset=utf-8",
		);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("x-accel-buffering")).toBe("no");
		expect(await readFrame(reader)).toBe(": connected\n\n");

		eventSource.publishToPrincipal("bob", startedEvent("bob-request"));
		eventSource.publishToPrincipal("alice", startedEvent("alice-request"));

		const eventFrame = await readFrame(reader);
		expect(eventFrame).toContain("event: inference.request_started");
		expect(eventFrame).toContain('"requestId":"alice-request"');
		expect(eventFrame).not.toContain("bob-request");
		expect(eventFrame).not.toContain("principalId");
		expect(eventFrame).not.toContain("session-token");
		await reader?.cancel();
	});

	it("starts empty instead of replaying events published before connection", async () => {
		const eventSource = createLiveInferenceEventSource();
		eventSource.publishToPrincipal("alice", startedEvent("before-connect"));
		const response = handlePersonalEventStreamRequest(
			createRequest("ge_session_dev=session-token"),
			createDependencies({ eventSource }),
		);
		const reader = response.body?.getReader();

		expect(await readFrame(reader)).toBe(": connected\n\n");
		eventSource.publishToPrincipal("alice", startedEvent("after-connect"));
		const firstEvent = await readFrame(reader);
		expect(firstEvent).toContain("after-connect");
		expect(firstEvent).not.toContain("before-connect");
		await reader?.cancel();
	});

	it("bounds pending events and reports exactly how many were dropped", async () => {
		const eventSource = createLiveInferenceEventSource();
		const response = handlePersonalEventStreamRequest(
			createRequest("ge_session_dev=session-token"),
			createDependencies({ eventSource, maxPendingEvents: 3 }),
		);

		for (let index = 1; index <= 5; index += 1) {
			eventSource.publishToPrincipal("alice", startedEvent(`request-${index}`));
		}

		const reader = response.body?.getReader();
		expect(await readFrame(reader)).toBe(": connected\n\n");
		expect(await readFrame(reader)).toContain('"requestId":"request-1"');
		expect(await readFrame(reader)).toContain('"requestId":"request-2"');
		const gap = await readFrame(reader);
		expect(gap).toContain("event: console.gap");
		expect(gap).toContain('"droppedEvents":3');
		await reader?.cancel();
	});

	it("unsubscribes when the downstream reader cancels", async () => {
		const unsubscribe = vi.fn();
		const response = handlePersonalEventStreamRequest(
			createRequest("ge_session_dev=session-token"),
			createDependencies({
				eventSource: {
					publishToPrincipal: vi.fn(),
					subscribe: vi.fn(() => unsubscribe),
				},
			}),
		);

		await response.body?.cancel();
		expect(unsubscribe).toHaveBeenCalledOnce();
	});

	it("unsubscribes when the incoming request is aborted", async () => {
		const abortController = new AbortController();
		const unsubscribe = vi.fn();
		const response = handlePersonalEventStreamRequest(
			new Request("https://app.example/api/live-console/events", {
				headers: { cookie: "ge_session_dev=session-token" },
				signal: abortController.signal,
			}),
			createDependencies({
				eventSource: {
					publishToPrincipal: vi.fn(),
					subscribe: vi.fn(() => unsubscribe),
				},
			}),
		);
		const reader = response.body?.getReader();

		await readFrame(reader);
		abortController.abort();
		expect((await reader?.read())?.done).toBe(true);
		expect(unsubscribe).toHaveBeenCalledOnce();
	});

	it.each([
		{
			name: "revoked or expired",
			revalidate: () => null,
		},
		{
			name: "newly restricted",
			revalidate: () => ({ ...baseSession, restricted: true }),
		},
	] as const)("closes after session revalidation finds it $name", async ({
		revalidate,
	}) => {
		let scheduledCallback: (() => void) | undefined;
		let scheduledDelay: number | undefined;
		const unsubscribe = vi.fn();
		const readSession = vi
			.fn()
			.mockReturnValueOnce({ ...baseSession, expiresAt: 5_000 })
			.mockImplementation(revalidate);
		const response = handlePersonalEventStreamRequest(
			createRequest("ge_session_dev=session-token"),
			createDependencies({
				eventSource: {
					publishToPrincipal: vi.fn(),
					subscribe: vi.fn(() => unsubscribe),
				},
				now: () => 0,
				readSession,
				schedule(callback, delayMs) {
					scheduledCallback = callback;
					scheduledDelay = delayMs;
					return 1 as unknown as ReturnType<typeof setTimeout>;
				},
			}),
		);
		const reader = response.body?.getReader();

		expect(await readFrame(reader)).toBe(": connected\n\n");
		expect(scheduledDelay).toBe(5_000);
		scheduledCallback?.();
		expect((await reader?.read())?.done).toBe(true);
		expect(unsubscribe).toHaveBeenCalledOnce();
	});

	it("keeps a valid session alive and schedules its next revalidation", async () => {
		const scheduledCallbacks: Array<() => void> = [];
		const schedule = vi.fn((callback: () => void) => {
			scheduledCallbacks.push(callback);
			return scheduledCallbacks.length as unknown as ReturnType<
				typeof setTimeout
			>;
		});
		const response = handlePersonalEventStreamRequest(
			createRequest("ge_session_dev=session-token"),
			createDependencies({ schedule }),
		);
		const reader = response.body?.getReader();

		expect(await readFrame(reader)).toBe(": connected\n\n");
		scheduledCallbacks[0]?.();
		expect(await readFrame(reader)).toBe(": keep-alive\n\n");
		expect(schedule).toHaveBeenCalledTimes(2);
		await reader?.cancel();
	});

	it("closes when session revalidation fails", async () => {
		let scheduledCallback: (() => void) | undefined;
		const readSession = vi
			.fn()
			.mockReturnValueOnce(baseSession)
			.mockImplementation(() => {
				throw new Error("PRIVATE_REVALIDATION_FAILURE");
			});
		const response = handlePersonalEventStreamRequest(
			createRequest("ge_session_dev=session-token"),
			createDependencies({
				readSession,
				schedule(callback) {
					scheduledCallback = callback;
					return 1 as unknown as ReturnType<typeof setTimeout>;
				},
			}),
		);
		const reader = response.body?.getReader();

		await readFrame(reader);
		scheduledCallback?.();
		expect((await reader?.read())?.done).toBe(true);
	});
});

function createDependencies(
	overrides: PersonalEventStreamDependencies = {},
): PersonalEventStreamDependencies {
	return {
		getCookieName: () => "ge_session_dev",
		readSession: () => baseSession,
		now: () => 0,
		schedule: () => 1 as unknown as ReturnType<typeof setTimeout>,
		cancelScheduled: vi.fn(),
		...overrides,
	};
}

function createRequest(cookie: string | null): Request {
	return new Request("https://app.example/api/live-console/events", {
		headers: cookie === null ? undefined : { cookie },
	});
}

function startedEvent(requestId: string): GatewayLifecycleEvent {
	return {
		type: "inference.request_started",
		requestId,
		occurredAt: "2026-07-22T00:00:00.000Z",
		requestKind: "generation",
	};
}

async function readFrame(
	reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
): Promise<string> {
	const result = await reader?.read();
	expect(result?.done).toBe(false);
	return decoder.decode(result?.value);
}
