import { createMiddleware } from "@tanstack/react-start";

import type { CurrentAccount } from "./account-contract.ts";

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
			const { readCurrentAccount } = await import(
				"./account-function-runtime.server.ts"
			);
			accountAuthorization = evaluateAccountAuthorization(
				await readCurrentAccount(),
				requirement,
			);
		} catch {
			accountAuthorization = { status: "failure" };
		}
		return next({ context: { accountAuthorization } });
	});
}
