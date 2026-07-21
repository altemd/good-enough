import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	logoutCurrentSession,
	readCurrentSession,
	setBrowserSessionCookie,
} from "./account-function-runtime.server.ts";

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
vi.mock("./sessions.server.ts", () => sessionStore);

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
});
