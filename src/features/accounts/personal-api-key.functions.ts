import { createServerFn } from "@tanstack/react-start";

import { authorizeAccountFunction } from "./account-authorization.middleware.ts";
import {
	requireString,
	validateExactObject,
} from "./account-function-input.ts";

const unrestrictedAccount = authorizeAccountFunction("unrestricted");

interface RevokeKeyInput {
	prefix: string;
}

export const getPersonalApiKeys = createServerFn({ method: "GET" })
	.middleware([unrestrictedAccount])
	.handler(async ({ context }) => {
		const { runAuthorizedAccountRead } = await import(
			"./account-function-runtime.server.ts"
		);
		return runAuthorizedAccountRead(
			context.accountAuthorization,
			async (account) => {
				const { listPersonalApiKeys } = await import(
					"./personal-api-keys.server.ts"
				);
				return listPersonalApiKeys(account);
			},
		);
	});

export const createPersonalApiKey = createServerFn({ method: "POST" })
	.middleware([unrestrictedAccount])
	.validator(validateEmptyInput)
	.handler(async ({ context }) => {
		const { runAuthorizedAccountMutation } = await import(
			"./account-function-runtime.server.ts"
		);
		return runAuthorizedAccountMutation(
			context.accountAuthorization,
			async (account) => {
				const personalApiKeys = await import("./personal-api-keys.server.ts");
				return personalApiKeys.createPersonalApiKey(account);
			},
		);
	});

export const revokePersonalApiKey = createServerFn({ method: "POST" })
	.middleware([unrestrictedAccount])
	.validator(validateRevokeKeyInput)
	.handler(async ({ context, data }) => {
		const { runAuthorizedAccountMutation } = await import(
			"./account-function-runtime.server.ts"
		);
		return runAuthorizedAccountMutation(
			context.accountAuthorization,
			async (account) => {
				const personalApiKeys = await import("./personal-api-keys.server.ts");
				return personalApiKeys.revokePersonalApiKey(account, data.prefix);
			},
		);
	});

function validateEmptyInput(value: unknown): Record<string, never> {
	return validateExactObject(value, [], () => ({}));
}

function validateRevokeKeyInput(value: unknown): RevokeKeyInput {
	return validateExactObject(value, ["prefix"], (object) => ({
		prefix: requireString(object.prefix),
	}));
}
