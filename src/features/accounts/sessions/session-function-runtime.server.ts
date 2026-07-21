import "@tanstack/react-start/server-only";

import {
	deleteCookie,
	getCookie,
	setCookie,
	setResponseHeader,
} from "@tanstack/react-start/server";

import type {
	AccountMutationResult,
	CurrentAccount,
} from "../account-contract.ts";
import { runMutation } from "../account-function-runtime.server.ts";
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

export async function runBrowserSessionMutation<
	TSession extends { token: string; expiresAt: number },
	TPublic,
>(
	operation: () =>
		| AccountMutationResult<TSession>
		| Promise<AccountMutationResult<TSession>>,
	mapPublicValue: (session: TSession) => TPublic,
): Promise<AccountMutationResult<TPublic>> {
	setResponseHeader("Cache-Control", "no-store");
	const result = await runMutation(operation, setBrowserSessionCookie);
	return result.ok ? { ok: true, value: mapPublicValue(result.value) } : result;
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
