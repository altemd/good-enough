import { beforeEach, describe, expect, it, vi } from "vitest";

import { authorizeAccountFunction } from "./account-authorization.middleware.ts";
import type { CurrentAccount } from "./account-contract.ts";

const runtime = vi.hoisted(() => ({
	readCurrentAccount: vi.fn(),
}));
const startServer = vi.hoisted(() => ({
	setResponseStatus: vi.fn(),
}));

vi.mock("./account-function-runtime.server.ts", () => runtime);
vi.mock("@tanstack/react-start/server", () => startServer);

const administrator: CurrentAccount = {
	id: "administrator-id",
	username: "Administrator",
	role: "admin",
	mustChangePassword: false,
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("account authorization middleware", () => {
	it("admits a granted account into server-only context", async () => {
		runtime.readCurrentAccount.mockResolvedValue(administrator);
		const { execution, next } = executeMiddleware("administrator");

		await expect(execution).resolves.toEqual({
			context: { account: administrator },
		});
		expect(next).toHaveBeenCalledOnce();
		expect(runtime.readCurrentAccount).toHaveBeenCalledOnce();
		expect(startServer.setResponseStatus).not.toHaveBeenCalled();
	});

	it("stops denied requests before the handler", async () => {
		runtime.readCurrentAccount.mockResolvedValue({
			...administrator,
			mustChangePassword: true,
		});
		const { execution, next } = executeMiddleware("administrator");

		await expect(execution).rejects.toThrow("Forbidden");
		expect(next).not.toHaveBeenCalled();
		expect(startServer.setResponseStatus).toHaveBeenCalledOnce();
		expect(startServer.setResponseStatus).toHaveBeenCalledWith(403);
	});

	it("stops lookup failures with a sanitized error", async () => {
		runtime.readCurrentAccount.mockRejectedValue(
			new Error("synthetic private database failure"),
		);
		const { execution, next } = executeMiddleware("authenticated");

		await expect(execution).rejects.toThrow("Account service unavailable");
		expect(next).not.toHaveBeenCalled();
		expect(startServer.setResponseStatus).toHaveBeenCalledOnce();
		expect(startServer.setResponseStatus).toHaveBeenCalledWith(500);
	});
});

function executeMiddleware(
	requirement: "authenticated" | "unrestricted" | "administrator",
) {
	const middleware = authorizeAccountFunction(requirement);
	const server = middleware.options.server;
	if (!server) throw new Error("Missing server middleware");
	const next = vi.fn(async (value: { context: unknown }) => value);
	return {
		next,
		execution: server({ next } as never),
	};
}
