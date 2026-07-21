import "@tanstack/react-start/server-only";

import type {
	AccountMutationResult,
	CurrentAccount,
} from "./account-contract.ts";
import {
	createExpiredSessionCookies,
	createSessionCookie,
	deleteBrowserSession,
	readBrowserSession,
	readSessionTokenFromCookie,
} from "./sessions.server.ts";

export async function readCurrentSession() {
	const { getRequestHeader } = await import("@tanstack/react-start/server");
	const token = readSessionTokenFromCookie(getRequestHeader("cookie") ?? null);
	return readBrowserSession(token);
}

export async function readCurrentAccount(): Promise<CurrentAccount | null> {
	return (await readCurrentSession())?.user ?? null;
}

export async function runMutation<T>(
	operation: () => AccountMutationResult<T> | Promise<AccountMutationResult<T>>,
	onSuccess?: (value: T) => void | Promise<void>,
): Promise<AccountMutationResult<T>> {
	let result: AccountMutationResult<T>;
	try {
		result = await operation();
		if (result.ok) await onSuccess?.(result.value);
	} catch {
		result = { ok: false, code: "internal_error" };
	}
	await applyResultStatus(result);
	return result;
}

export async function runAccountRead<T>(
	operation: () => T | Promise<T>,
): Promise<T> {
	try {
		return await operation();
	} catch {
		const { setResponseStatus } = await import("@tanstack/react-start/server");
		setResponseStatus(500);
		throw new Error("Account service unavailable");
	}
}

export async function setBrowserSessionCookie(session: {
	token: string;
	expiresAt: number;
}) {
	const { setResponseHeader } = await import("@tanstack/react-start/server");
	setResponseHeader(
		"Set-Cookie",
		createSessionCookie(session.token, session.expiresAt),
	);
}

export async function logoutCurrentSession() {
	const { setResponseHeader } = await import("@tanstack/react-start/server");
	try {
		const accountSession = await readCurrentSession();
		if (accountSession) {
			deleteBrowserSession(accountSession.id);
		}
	} catch {
		// Clearing the browser cookie remains safe if persistence is unavailable.
	}
	setResponseHeader("Set-Cookie", createExpiredSessionCookies());
	return { ok: true as const, value: {} };
}

async function applyResultStatus(result: AccountMutationResult<unknown>) {
	if (!result.ok) {
		const { setResponseHeader, setResponseStatus } = await import(
			"@tanstack/react-start/server"
		);
		if (result.retryAfterSeconds !== undefined) {
			setResponseHeader("Retry-After", String(result.retryAfterSeconds));
		}
		setResponseStatus(
			result.code === "rate_limited"
				? 429
				: result.code === "configuration_error" ||
						result.code === "internal_error"
					? 500
					: result.code === "forbidden" || result.code === "registration_closed"
						? 403
						: 400,
		);
	}
}
