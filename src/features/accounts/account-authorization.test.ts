import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type AccountAuthorization,
	evaluateAccountAuthorization,
} from "./account-authorization.middleware.ts";
import type { CurrentAccount } from "./account-contract.ts";
import {
	runAuthorizedAccountMutation,
	runAuthorizedAccountRead,
} from "./account-function-runtime.server.ts";

const startServer = vi.hoisted(() => ({
	setResponseHeader: vi.fn(),
	setResponseStatus: vi.fn(),
}));

vi.mock("@tanstack/react-start/server", () => startServer);

const member: CurrentAccount = {
	id: "member-id",
	username: "Member",
	role: "member",
	mustChangePassword: false,
};

const administrator: CurrentAccount = {
	id: "administrator-id",
	username: "Administrator",
	role: "admin",
	mustChangePassword: false,
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("account authorization policy", () => {
	it("denies missing accounts for every requirement", () => {
		for (const requirement of [
			"authenticated",
			"unrestricted",
			"administrator",
		] as const) {
			expect(evaluateAccountAuthorization(null, requirement)).toEqual({
				status: "denied",
			});
		}
	});

	it("allows restricted accounts only for authenticated operations", () => {
		const restrictedMember = { ...member, mustChangePassword: true };
		const restrictedAdministrator = {
			...administrator,
			mustChangePassword: true,
		};

		for (const account of [restrictedMember, restrictedAdministrator]) {
			expect(evaluateAccountAuthorization(account, "authenticated")).toEqual({
				status: "granted",
				account,
			});
			expect(evaluateAccountAuthorization(account, "unrestricted")).toEqual({
				status: "denied",
			});
			expect(evaluateAccountAuthorization(account, "administrator")).toEqual({
				status: "denied",
			});
		}
	});

	it("separates unrestricted member and administrator access", () => {
		expect(evaluateAccountAuthorization(member, "authenticated")).toEqual({
			status: "granted",
			account: member,
		});
		expect(evaluateAccountAuthorization(member, "unrestricted")).toEqual({
			status: "granted",
			account: member,
		});
		expect(evaluateAccountAuthorization(member, "administrator")).toEqual({
			status: "denied",
		});
		for (const requirement of [
			"authenticated",
			"unrestricted",
			"administrator",
		] as const) {
			expect(evaluateAccountAuthorization(administrator, requirement)).toEqual({
				status: "granted",
				account: administrator,
			});
		}
	});
});

describe("account authorization result adapters", () => {
	it("returns null without invoking denied reads", async () => {
		const operation = vi.fn(() => "private");

		expect(
			await runAuthorizedAccountRead({ status: "denied" }, operation),
		).toBeNull();
		expect(operation).not.toHaveBeenCalled();
		expect(startServer.setResponseStatus).not.toHaveBeenCalled();
	});

	it("sanitizes authorization failures for reads", async () => {
		const operation = vi.fn(() => "private");

		await expect(
			runAuthorizedAccountRead({ status: "failure" }, operation),
		).rejects.toThrow("Account service unavailable");
		expect(operation).not.toHaveBeenCalled();
		expect(startServer.setResponseStatus).toHaveBeenCalledOnce();
		expect(startServer.setResponseStatus).toHaveBeenCalledWith(500);
	});

	it("invokes granted reads exactly once with the account", async () => {
		const authorization: AccountAuthorization = {
			status: "granted",
			account: member,
		};
		const operation = vi.fn(() => "private");

		expect(await runAuthorizedAccountRead(authorization, operation)).toBe(
			"private",
		);
		expect(operation).toHaveBeenCalledOnce();
		expect(operation).toHaveBeenCalledWith(member);
	});

	it("returns the stable forbidden mutation result", async () => {
		const operation = vi.fn(() => ({ ok: true as const, value: {} }));

		expect(
			await runAuthorizedAccountMutation({ status: "denied" }, operation),
		).toEqual({ ok: false, code: "forbidden" });
		expect(operation).not.toHaveBeenCalled();
		expect(startServer.setResponseStatus).toHaveBeenCalledOnce();
		expect(startServer.setResponseStatus).toHaveBeenCalledWith(403);
	});

	it("turns authorization failures into internal mutation errors", async () => {
		const operation = vi.fn(() => ({ ok: true as const, value: {} }));

		expect(
			await runAuthorizedAccountMutation({ status: "failure" }, operation),
		).toEqual({ ok: false, code: "internal_error" });
		expect(operation).not.toHaveBeenCalled();
		expect(startServer.setResponseStatus).toHaveBeenCalledOnce();
		expect(startServer.setResponseStatus).toHaveBeenCalledWith(500);
	});

	it("runs granted mutations and success callbacks exactly once", async () => {
		const authorization: AccountAuthorization = {
			status: "granted",
			account: administrator,
		};
		const operation = vi.fn(() => ({
			ok: true as const,
			value: { token: "synthetic-token" },
		}));
		const onSuccess = vi.fn();

		expect(
			await runAuthorizedAccountMutation(authorization, operation, onSuccess),
		).toEqual({ ok: true, value: { token: "synthetic-token" } });
		expect(operation).toHaveBeenCalledOnce();
		expect(operation).toHaveBeenCalledWith(administrator);
		expect(onSuccess).toHaveBeenCalledOnce();
		expect(onSuccess).toHaveBeenCalledWith({ token: "synthetic-token" });
	});

	it("does not run success callbacks after domain rejection", async () => {
		const authorization: AccountAuthorization = {
			status: "granted",
			account: administrator,
		};
		const operation = vi.fn(() => ({
			ok: false as const,
			code: "forbidden" as const,
		}));
		const onSuccess = vi.fn();

		expect(
			await runAuthorizedAccountMutation(authorization, operation, onSuccess),
		).toEqual({ ok: false, code: "forbidden" });
		expect(operation).toHaveBeenCalledOnce();
		expect(onSuccess).not.toHaveBeenCalled();
	});
});
