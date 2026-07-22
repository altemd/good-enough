import "@tanstack/react-start/server-only";

import {
	type BrowserSession,
	getSessionCookiePolicy,
	readBrowserSession,
} from "#/features/accounts/sessions/sessions.server";
import type { GatewayLifecycleEvent } from "#/features/inference-gateway/lifecycle-events";
import {
	liveInferenceEventSource,
	type PrincipalLifecycleEventSource,
} from "./live-event-source.server";

export const LIVE_CONSOLE_MAX_PENDING_EVENTS = 64;
export const LIVE_CONSOLE_SESSION_REVALIDATION_MS = 15_000;

const encoder = new TextEncoder();
const successHeaders = {
	"Cache-Control": "no-store",
	"Content-Type": "text/event-stream; charset=utf-8",
	Vary: "Cookie",
	"X-Accel-Buffering": "no",
} as const;
const privateResponseHeaders = {
	"Cache-Control": "no-store",
	Vary: "Cookie",
} as const;

type PendingStreamItem =
	| { kind: "comment"; value: string }
	| { kind: "event"; value: GatewayLifecycleEvent }
	| { kind: "gap"; droppedEvents: number };

type ScheduledHandle = ReturnType<typeof setTimeout>;

export interface PersonalEventStreamDependencies {
	getCookieName?: () => string;
	readSession?: (token: string, now: number) => BrowserSession | null;
	eventSource?: PrincipalLifecycleEventSource;
	now?: () => number;
	maxPendingEvents?: number;
	revalidationIntervalMs?: number;
	schedule?: (callback: () => void, delayMs: number) => ScheduledHandle;
	cancelScheduled?: (handle: ScheduledHandle) => void;
}

export function handlePersonalEventStreamRequest(
	request: Request,
	dependencies: PersonalEventStreamDependencies = {},
): Response {
	if (request.method !== "GET") {
		return new Response(null, {
			status: 405,
			headers: { ...privateResponseHeaders, Allow: "GET" },
		});
	}

	const now = dependencies.now ?? Date.now;
	const readSession = dependencies.readSession ?? readBrowserSession;
	let token: string | null;
	let session: BrowserSession | null;
	try {
		const cookieName =
			dependencies.getCookieName?.() ?? getSessionCookiePolicy().name;
		token = readCookie(request.headers.get("cookie"), cookieName);
		session = token === null ? null : readSession(token, now());
	} catch {
		return new Response(null, {
			status: 500,
			headers: privateResponseHeaders,
		});
	}

	if (token === null || session === null) {
		return new Response(null, {
			status: 401,
			headers: privateResponseHeaders,
		});
	}
	if (isRestricted(session)) {
		return new Response(null, {
			status: 403,
			headers: privateResponseHeaders,
		});
	}

	return createAuthenticatedEventStream(request, token, session, {
		eventSource: dependencies.eventSource ?? liveInferenceEventSource,
		readSession,
		now,
		maxPendingEvents:
			dependencies.maxPendingEvents ?? LIVE_CONSOLE_MAX_PENDING_EVENTS,
		revalidationIntervalMs:
			dependencies.revalidationIntervalMs ??
			LIVE_CONSOLE_SESSION_REVALIDATION_MS,
		schedule:
			dependencies.schedule ??
			((callback, delayMs) => setTimeout(callback, delayMs)),
		cancelScheduled:
			dependencies.cancelScheduled ?? ((handle) => clearTimeout(handle)),
	});
}

function createAuthenticatedEventStream(
	request: Request,
	token: string,
	initialSession: BrowserSession,
	dependencies: Required<
		Pick<
			PersonalEventStreamDependencies,
			| "cancelScheduled"
			| "eventSource"
			| "maxPendingEvents"
			| "now"
			| "readSession"
			| "revalidationIntervalMs"
			| "schedule"
		>
	>,
): Response {
	const principalId = initialSession.user.id;
	const pending: PendingStreamItem[] = [];
	const maxPendingEvents = normalizePositiveInteger(
		dependencies.maxPendingEvents,
		LIVE_CONSOLE_MAX_PENDING_EVENTS,
	);
	const revalidationIntervalMs = normalizePositiveInteger(
		dependencies.revalidationIntervalMs,
		LIVE_CONSOLE_SESSION_REVALIDATION_MS,
	);
	let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
	let scheduledRevalidation: ScheduledHandle | null = null;
	let closed = false;
	let unsubscribe = () => {};

	const pump = () => {
		if (closed || controller === null) {
			return;
		}
		while ((controller.desiredSize ?? 0) > 0 && pending.length > 0) {
			const item = pending.shift();
			if (item) {
				controller.enqueue(serializeStreamItem(item));
			}
		}
	};
	const queueEvent = (event: GatewayLifecycleEvent) => {
		if (closed) {
			return;
		}
		if (pending.length < maxPendingEvents) {
			pending.push({ kind: "event", value: event });
		} else {
			const last = pending.at(-1);
			if (last?.kind === "gap") {
				last.droppedEvents += 1;
			} else {
				pending.pop();
				pending.push({
					kind: "gap",
					droppedEvents: last?.kind === "event" ? 2 : 1,
				});
			}
		}
		pump();
	};
	const queueKeepAlive = () => {
		if (
			closed ||
			pending.length >= maxPendingEvents ||
			pending.some((item) => item.kind === "comment")
		) {
			return;
		}
		pending.push({ kind: "comment", value: "keep-alive" });
		pump();
	};
	const cleanup = (closeController: boolean) => {
		if (closed) {
			return;
		}
		closed = true;
		unsubscribe();
		request.signal.removeEventListener("abort", handleRequestAbort);
		if (scheduledRevalidation !== null) {
			dependencies.cancelScheduled(scheduledRevalidation);
			scheduledRevalidation = null;
		}
		pending.length = 0;
		if (closeController && controller !== null) {
			try {
				controller.close();
			} catch {
				// The client may already have cancelled the response stream.
			}
		}
	};
	const revalidate = () => {
		scheduledRevalidation = null;
		let currentSession: BrowserSession | null;
		try {
			currentSession = dependencies.readSession(token, dependencies.now());
		} catch {
			cleanup(true);
			return;
		}
		if (
			currentSession === null ||
			currentSession.user.id !== principalId ||
			isRestricted(currentSession)
		) {
			cleanup(true);
			return;
		}
		queueKeepAlive();
		scheduleRevalidation(currentSession);
	};
	const scheduleRevalidation = (currentSession: BrowserSession) => {
		if (closed) {
			return;
		}
		const untilExpiry = currentSession.expiresAt - dependencies.now();
		const delayMs = Math.max(1, Math.min(revalidationIntervalMs, untilExpiry));
		scheduledRevalidation = dependencies.schedule(revalidate, delayMs);
	};
	const handleRequestAbort = () => cleanup(true);

	const body = new ReadableStream<Uint8Array>({
		start(streamController) {
			controller = streamController;
			streamController.enqueue(encoder.encode(": connected\n\n"));
			unsubscribe = dependencies.eventSource.subscribe(principalId, queueEvent);
			request.signal.addEventListener("abort", handleRequestAbort, {
				once: true,
			});
			if (request.signal.aborted) {
				cleanup(true);
				return;
			}
			scheduleRevalidation(initialSession);
		},
		pull() {
			pump();
		},
		cancel() {
			cleanup(false);
		},
	});

	return new Response(body, { headers: successHeaders });
}

function serializeStreamItem(item: PendingStreamItem): Uint8Array {
	if (item.kind === "comment") {
		return encoder.encode(`: ${item.value}\n\n`);
	}
	if (item.kind === "gap") {
		return encoder.encode(
			`event: console.gap\ndata: ${JSON.stringify({ type: "console.gap", droppedEvents: item.droppedEvents })}\n\n`,
		);
	}
	return encoder.encode(
		`event: ${item.value.type}\ndata: ${JSON.stringify(item.value)}\n\n`,
	);
}

function readCookie(cookieHeader: string | null, name: string): string | null {
	if (cookieHeader === null) {
		return null;
	}

	let value: string | null = null;
	for (const cookie of cookieHeader.split(";")) {
		const separator = cookie.indexOf("=");
		if (separator < 0 || cookie.slice(0, separator).trim() !== name) {
			continue;
		}
		if (value !== null) {
			return null;
		}
		value = cookie.slice(separator + 1).trim();
	}
	return value && value.length > 0 ? value : null;
}

function isRestricted(session: BrowserSession): boolean {
	return session.restricted || session.user.mustChangePassword;
}

function normalizePositiveInteger(value: number, fallback: number): number {
	return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
