import "@tanstack/react-start/server-only";

const MAX_ENTRIES = 10_000;

interface WindowEntry {
	count: number;
	resetAt: number;
}

const windows = new Map<string, WindowEntry>();

export type RateLimitDecision =
	| { allowed: true }
	| { allowed: false; retryAfterSeconds: number };

export function consumeRateLimit(
	key: string,
	maximum: number,
	windowMs: number,
	now = Date.now(),
): RateLimitDecision {
	prune(now);
	const current = windows.get(key);
	if (!current || current.resetAt <= now) {
		windows.set(key, { count: 1, resetAt: now + windowMs });
		return { allowed: true };
	}
	if (current.count >= maximum) {
		return {
			allowed: false,
			retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
		};
	}
	current.count += 1;
	return { allowed: true };
}

export function clearRateLimit(key: string) {
	windows.delete(key);
}

function prune(now: number) {
	for (const [key, entry] of windows) {
		if (entry.resetAt <= now) {
			windows.delete(key);
		}
	}
	while (windows.size >= MAX_ENTRIES) {
		const oldest = windows.keys().next().value as string;
		windows.delete(oldest);
	}
}
