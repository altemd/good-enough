import { createServerFn } from "@tanstack/react-start";
import {
	requireString,
	validateEmptyInput,
	validateExactObject,
} from "../account-function-input.ts";
import {
	runDisplayOnceSecretMutation,
	runMutation,
} from "../account-function-runtime.server.ts";
import { authorizeAccountFunction } from "../sessions/account-authorization.middleware.ts";
import { issueDemoApiToken } from "./demo-api-tokens.server.ts";
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
		runDisplayOnceSecretMutation(() => createKey(context.account)),
	);

export const revokePersonalApiKey = createServerFn({ method: "POST" })
	.middleware([unrestrictedAccount])
	.validator(validateRevokeKeyInput)
	.handler(async ({ context, data }) =>
		runMutation(() => revokeKey(context.account, data.prefix)),
	);

export const createDemoApiToken = createServerFn({ method: "POST" })
	.validator(validateEmptyInput)
	.handler(async () => runDisplayOnceSecretMutation(() => issueDemoApiToken()));

function validateRevokeKeyInput(value: unknown): RevokeKeyInput {
	return validateExactObject(value, ["prefix"], (object) => ({
		prefix: requireString(object.prefix),
	}));
}
