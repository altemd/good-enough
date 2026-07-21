import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	runDisplayOnceSecretMutation,
	runMutation,
} from "./account-function-runtime.server.ts";
import {
	logoutCurrentSession,
	readCurrentSession,
	runBrowserSessionMutation,
	setBrowserSessionCookie,
} from "./sessions/session-function-runtime.server.ts";

const startServer = vi.hoisted(() => ({
	deleteCookie: vi.fn(),
	getCookie: vi.fn(),
	setCookie: vi.fn(),
	setResponseHeader: vi.fn(),
	setResponseStatus: vi.fn(),
}));
const sessionStore = vi.hoisted(() => ({
	deleteBrowserSession: vi.fn(),
	getSessionCookiePolicy: vi.fn(),
	readBrowserSession: vi.fn(),
}));

vi.mock("@tanstack/react-start/server", () => startServer);
vi.mock("./sessions/sessions.server.ts", () => sessionStore);

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("account function cookie boundary", () => {
	it("reads only the cookie selected by the trusted origin policy", async () => {
		sessionStore.getSessionCookiePolicy.mockReturnValue({
			name: "__Host-ge_session",
			secure: true,
		});
		startServer.getCookie.mockReturnValue("secure-session-token");
		const session = { id: "session-id", user: { id: "user-id" } };
		sessionStore.readBrowserSession.mockReturnValue(session);

		await expect(readCurrentSession()).resolves.toBe(session);
		expect(startServer.getCookie).toHaveBeenCalledOnce();
		expect(startServer.getCookie).toHaveBeenCalledWith("__Host-ge_session");
		expect(sessionStore.readBrowserSession).toHaveBeenCalledWith(
			"secure-session-token",
		);
	});

	it("writes the selected cookie with the complete session policy", async () => {
		vi.spyOn(Date, "now").mockReturnValue(1_000);
		sessionStore.getSessionCookiePolicy.mockReturnValue({
			name: "ge_session_dev",
			secure: false,
		});

		await setBrowserSessionCookie({ token: "session-token", expiresAt: 6_999 });

		expect(startServer.setCookie).toHaveBeenCalledOnce();
		expect(startServer.setCookie).toHaveBeenCalledWith(
			"ge_session_dev",
			"session-token",
			{
				httpOnly: true,
				secure: false,
				sameSite: "lax",
				path: "/",
				maxAge: 5,
			},
		);
	});

	it("revokes the database session and deletes only the selected cookie", async () => {
		sessionStore.getSessionCookiePolicy.mockReturnValue({
			name: "__Host-ge_session",
			secure: true,
		});
		startServer.getCookie.mockReturnValue("session-token");
		sessionStore.readBrowserSession.mockReturnValue({ id: "session-id" });

		await expect(logoutCurrentSession()).resolves.toEqual({
			ok: true,
			value: {},
		});
		expect(sessionStore.deleteBrowserSession).toHaveBeenCalledWith(
			"session-id",
		);
		expect(startServer.deleteCookie).toHaveBeenCalledOnce();
		expect(startServer.deleteCookie).toHaveBeenCalledWith("__Host-ge_session", {
			httpOnly: true,
			secure: true,
			sameSite: "lax",
			path: "/",
		});
	});

	it.each([
		["capacity_reached", 429, 17],
		["rate_limited", 429, 23],
		["demo_disabled", 403, undefined],
		["configuration_error", 500, undefined],
	] as const)("maps the %s mutation result through the shared server-function boundary", async (code, status, retryAfterSeconds) => {
		const result = await runMutation(() => ({
			ok: false,
			code,
			...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
		}));

		expect(result).toEqual({
			ok: false,
			code,
			...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
		});
		expect(startServer.setResponseStatus).toHaveBeenCalledWith(status);
		expect(startServer.setResponseHeader).toHaveBeenCalledTimes(
			retryAfterSeconds === undefined ? 0 : 1,
		);
		if (retryAfterSeconds !== undefined) {
			expect(startServer.setResponseHeader).toHaveBeenCalledWith(
				"Retry-After",
				String(retryAfterSeconds),
			);
		}
	});

	it("marks display-once secret responses as non-storable", async () => {
		const result = await runDisplayOnceSecretMutation(() => ({
			ok: true,
			value: { secret: "display-once-secret" },
		}));

		expect(result).toEqual({
			ok: true,
			value: { secret: "display-once-secret" },
		});
		expect(startServer.setResponseHeader).toHaveBeenCalledWith(
			"Cache-Control",
			"no-store",
		);
	});

	it("sets the session cookie without returning its token to client code", async () => {
		vi.spyOn(Date, "now").mockReturnValue(1_000);
		sessionStore.getSessionCookiePolicy.mockReturnValue({
			name: "ge_session_dev",
			secure: false,
		});

		const result = await runBrowserSessionMutation(
			() => ({
				ok: true,
				value: {
					token: "private-session-token",
					expiresAt: 6_999,
					restricted: true,
				},
			}),
			(session) => ({ restricted: session.restricted }),
		);

		expect(result).toEqual({ ok: true, value: { restricted: true } });
		expect(JSON.stringify(result)).not.toContain("private-session-token");
		expect(startServer.setCookie).toHaveBeenCalledWith(
			"ge_session_dev",
			"private-session-token",
			expect.objectContaining({ httpOnly: true, maxAge: 5 }),
		);
		expect(startServer.setResponseHeader).toHaveBeenCalledWith(
			"Cache-Control",
			"no-store",
		);
	});
});
