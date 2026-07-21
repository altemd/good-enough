import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeAccountFunction } from "./account-authorization.middleware.ts";
import type { CurrentAccount } from "./account-contract.ts";

const runtime = vi.hoisted(() => ({
	readCurrentAccount: vi.fn(),
}));

vi.mock("./account-function-runtime.server.ts", () => runtime);

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
	it("injects a granted authorization into server-only context", async () => {
		runtime.readCurrentAccount.mockResolvedValue(administrator);

		const context = await executeMiddleware("administrator");

		expect(context).toEqual({
			accountAuthorization: { status: "granted", account: administrator },
		});
		expect(runtime.readCurrentAccount).toHaveBeenCalledOnce();
	});

	it("injects a denial without exposing its reason", async () => {
		runtime.readCurrentAccount.mockResolvedValue({
			...administrator,
			mustChangePassword: true,
		});

		expect(await executeMiddleware("administrator")).toEqual({
			accountAuthorization: { status: "denied" },
		});
	});

	it("converts session lookup errors to a sanitized failure", async () => {
		runtime.readCurrentAccount.mockRejectedValue(
			new Error("synthetic private database failure"),
		);

		expect(await executeMiddleware("authenticated")).toEqual({
			accountAuthorization: { status: "failure" },
		});
	});
});

async function executeMiddleware(
	requirement: "authenticated" | "unrestricted" | "administrator",
) {
	const middleware = authorizeAccountFunction(requirement);
	const server = middleware.options.server;
	if (!server) throw new Error("Missing server middleware");
	const next = vi.fn(async (value: { context: unknown }) => value);

	await server({ next } as never);

	expect(next).toHaveBeenCalledOnce();
	return next.mock.calls[0]?.[0].context;
}
