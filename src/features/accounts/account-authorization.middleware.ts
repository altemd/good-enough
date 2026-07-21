import { createMiddleware } from "@tanstack/react-start";
import { setResponseStatus } from "@tanstack/react-start/server";

import type { CurrentAccount } from "./account-contract.ts";
import { readCurrentAccount } from "./session-function-runtime.server.ts";

export type AccountAuthorizationRequirement =
	| "authenticated"
	| "unrestricted"
	| "administrator";

export type AccountAuthorization =
	| { status: "granted"; account: CurrentAccount }
	| { status: "denied" }
	| { status: "failure" };

export function evaluateAccountAuthorization(
	account: CurrentAccount | null,
	requirement: AccountAuthorizationRequirement,
): AccountAuthorization {
	if (!account) return { status: "denied" };
	if (requirement === "authenticated") {
		return { status: "granted", account };
	}
	if (account.mustChangePassword) return { status: "denied" };
	if (requirement === "administrator" && account.role !== "admin") {
		return { status: "denied" };
	}
	return { status: "granted", account };
}

export function authorizeAccountFunction(
	requirement: AccountAuthorizationRequirement,
) {
	return createMiddleware({ type: "function" }).server(async ({ next }) => {
		let accountAuthorization: AccountAuthorization;
		try {
			accountAuthorization = evaluateAccountAuthorization(
				await readCurrentAccount(),
				requirement,
			);
		} catch {
			accountAuthorization = { status: "failure" };
		}
		if (accountAuthorization.status === "failure") {
			setResponseStatus(500);
			throw new Error("Account service unavailable");
		}
		if (accountAuthorization.status === "denied") {
			setResponseStatus(403);
			throw new Error("Forbidden");
		}
		return next({ context: { account: accountAuthorization.account } });
	});
}
