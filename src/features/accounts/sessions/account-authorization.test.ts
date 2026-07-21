import { describe, expect, it } from "vitest";
import type { CurrentAccount } from "../account-contract.ts";
import { evaluateAccountAuthorization } from "./account-authorization.middleware.ts";

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
