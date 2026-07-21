import { createServerFn } from "@tanstack/react-start";

import { authorizeAccountFunction } from "./account-authorization.middleware.ts";
import {
	requireString,
	validateExactObject,
} from "./account-function-input.ts";
import { runMutation } from "./account-function-runtime.server.ts";
import {
	createPersonalApiKey as createKey,
	listPersonalApiKeys,
	revokePersonalApiKey as revokeKey,
} from "./personal-api-keys.server.ts";

const unrestrictedAccount = authorizeAccountFunction("unrestricted");

interface RevokeKeyInput {
	prefix: string;
}

export const getPersonalApiKeys = createServerFn({ method: "GET" })
	.middleware([unrestrictedAccount])
	.handler(async ({ context }) => listPersonalApiKeys(context.account));

export const createPersonalApiKey = createServerFn({ method: "POST" })
	.middleware([unrestrictedAccount])
	.validator(validateEmptyInput)
	.handler(async ({ context }) =>
		runMutation(() => createKey(context.account)),
	);

export const revokePersonalApiKey = createServerFn({ method: "POST" })
	.middleware([unrestrictedAccount])
	.validator(validateRevokeKeyInput)
	.handler(async ({ context, data }) =>
		runMutation(() => revokeKey(context.account, data.prefix)),
	);

function validateEmptyInput(value: unknown): Record<string, never> {
	return validateExactObject(value, [], () => ({}));
}

function validateRevokeKeyInput(value: unknown): RevokeKeyInput {
	return validateExactObject(value, ["prefix"], (object) => ({
		prefix: requireString(object.prefix),
	}));
}
