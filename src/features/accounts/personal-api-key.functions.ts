import { createServerFn } from "@tanstack/react-start";

import {
	requireString,
	validateExactObject,
} from "./account-function-input.ts";

interface RevokeKeyInput {
	prefix: string;
}

export const getPersonalApiKeys = createServerFn({ method: "GET" }).handler(
	async () => {
		const { readCurrentAccount, runAccountRead } = await import(
			"./account-function-runtime.server.ts"
		);
		return runAccountRead(async () => {
			const { listPersonalApiKeys } = await import(
				"./personal-api-keys.server.ts"
			);
			const account = await readCurrentAccount();
			return account ? listPersonalApiKeys(account) : null;
		});
	},
);

export const createPersonalApiKey = createServerFn({ method: "POST" })
	.validator(validateEmptyInput)
	.handler(async () => {
		const { readCurrentAccount, runMutation } = await import(
			"./account-function-runtime.server.ts"
		);
		return runMutation(async () => {
			const personalApiKeys = await import("./personal-api-keys.server.ts");
			const account = await readCurrentAccount();
			if (!account) {
				return { ok: false as const, code: "forbidden" as const };
			}
			return personalApiKeys.createPersonalApiKey(account);
		});
	});

export const revokePersonalApiKey = createServerFn({ method: "POST" })
	.validator(validateRevokeKeyInput)
	.handler(async ({ data }) => {
		const { readCurrentAccount, runMutation } = await import(
			"./account-function-runtime.server.ts"
		);
		return runMutation(async () => {
			const personalApiKeys = await import("./personal-api-keys.server.ts");
			const account = await readCurrentAccount();
			if (!account) {
				return { ok: false as const, code: "forbidden" as const };
			}
			return personalApiKeys.revokePersonalApiKey(account, data.prefix);
		});
	});

function validateEmptyInput(value: unknown): Record<string, never> {
	return validateExactObject(value, [], () => ({}));
}

function validateRevokeKeyInput(value: unknown): RevokeKeyInput {
	return validateExactObject(value, ["prefix"], (object) => ({
		prefix: requireString(object.prefix),
	}));
}
