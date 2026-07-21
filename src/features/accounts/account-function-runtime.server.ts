import "@tanstack/react-start/server-only";

import {
	deleteCookie,
	getCookie,
	setCookie,
	setResponseHeader,
	setResponseStatus,
} from "@tanstack/react-start/server";

import type {
	AccountMutationResult,
	CurrentAccount,
} from "./account-contract.ts";
import {
	deleteBrowserSession,
	getSessionCookiePolicy,
	readBrowserSession,
} from "./sessions.server.ts";

export async function readCurrentSession() {
	const { name } = getSessionCookiePolicy();
	const token = getCookie(name) ?? null;
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
		setResponseStatus(500);
		throw new Error("Account service unavailable");
	}
}

export async function setBrowserSessionCookie(session: {
	token: string;
	expiresAt: number;
}) {
	const policy = getSessionCookiePolicy();
	setCookie(policy.name, session.token, {
		httpOnly: true,
		secure: policy.secure,
		sameSite: "lax",
		path: "/",
		maxAge: Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)),
	});
}

export async function logoutCurrentSession() {
	const policy = getSessionCookiePolicy();
	try {
		const accountSession = await readCurrentSession();
		if (accountSession) {
			deleteBrowserSession(accountSession.id);
		}
	} catch {
		// Clearing the browser cookie remains safe if persistence is unavailable.
	}
	deleteCookie(policy.name, {
		httpOnly: true,
		secure: policy.secure,
		sameSite: "lax",
		path: "/",
	});
	return { ok: true as const, value: {} };
}

async function applyResultStatus(result: AccountMutationResult<unknown>) {
	if (!result.ok) {
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
