import { createServerFn } from "@tanstack/react-start";

import { authorizeAccountFunction } from "./account-authorization.middleware.ts";
import {
	requireString,
	validateExactObject,
} from "./account-function-input.ts";

const authenticatedAccount = authorizeAccountFunction("authenticated");

interface CredentialsInput {
	username: string;
	password: string;
}

interface BootstrapInput extends CredentialsInput {
	bootstrapToken: string;
}

interface ChangePasswordInput {
	currentPassword: string;
	newPassword: string;
}

export const getAccountEntryState = createServerFn({ method: "GET" }).handler(
	async () => {
		try {
			const [
				{ getSetupState },
				{ readAppOrigin, readBootstrapToken, readRegistrationEnabled },
			] = await Promise.all([
				import("./account-access.server.ts"),
				import("./config.server.ts"),
			]);
			readAppOrigin();
			const setup = getSetupState();
			if (setup.setupRequired && readBootstrapToken() === null) {
				throw new Error("Missing bootstrap configuration");
			}
			return {
				...setup,
				registrationEnabled: readRegistrationEnabled(),
				configurationValid: true,
			};
		} catch {
			return {
				setupRequired: false,
				registrationEnabled: false,
				configurationValid: false,
			};
		}
	},
);

export const getCurrentAccount = createServerFn({ method: "GET" }).handler(
	async () => {
		const { readCurrentAccount, runAccountRead } = await import(
			"./account-function-runtime.server.ts"
		);
		return runAccountRead(readCurrentAccount);
	},
);

export const bootstrapAccount = createServerFn({ method: "POST" })
	.validator(validateBootstrapInput)
	.handler(async ({ data }) => {
		const { runMutation } = await import(
			"./account-function-runtime.server.ts"
		);
		return runMutation(async () => {
			const { bootstrapAdministrator } = await import(
				"./account-access.server.ts"
			);
			return bootstrapAdministrator(data);
		});
	});

export const registerAccount = createServerFn({ method: "POST" })
	.validator(validateCredentialsInput)
	.handler(async ({ data }) => {
		const { runMutation } = await import(
			"./account-function-runtime.server.ts"
		);
		return runMutation(async () => {
			const { registerMember } = await import("./account-access.server.ts");
			return registerMember(data);
		});
	});

export const loginAccount = createServerFn({ method: "POST" })
	.validator(validateCredentialsInput)
	.handler(async ({ data }) => {
		const { runMutation, setBrowserSessionCookie } = await import(
			"./account-function-runtime.server.ts"
		);
		return runMutation(async () => {
			const [{ login }, { readAppOrigin }] = await Promise.all([
				import("./account-access.server.ts"),
				import("./config.server.ts"),
			]);
			readAppOrigin();
			return login(data);
		}, setBrowserSessionCookie);
	});

export const logoutAccount = createServerFn({ method: "POST" }).handler(
	async () => {
		const { logoutCurrentSession } = await import(
			"./account-function-runtime.server.ts"
		);
		return logoutCurrentSession();
	},
);

export const changeAccountPassword = createServerFn({ method: "POST" })
	.middleware([authenticatedAccount])
	.validator(validateChangePasswordInput)
	.handler(async ({ context, data }) => {
		const { runAuthorizedAccountMutation, setBrowserSessionCookie } =
			await import("./account-function-runtime.server.ts");
		return runAuthorizedAccountMutation(
			context.accountAuthorization,
			async (account) => {
				const [{ changePassword }, { readAppOrigin }] = await Promise.all([
					import("./account-access.server.ts"),
					import("./config.server.ts"),
				]);
				readAppOrigin();
				return changePassword(account, data);
			},
			setBrowserSessionCookie,
		);
	});

function validateCredentialsInput(value: unknown): CredentialsInput {
	return validateExactObject(value, ["username", "password"], (object) => ({
		username: requireString(object.username),
		password: requireString(object.password),
	}));
}

function validateBootstrapInput(value: unknown): BootstrapInput {
	return validateExactObject(
		value,
		["username", "password", "bootstrapToken"],
		(object) => ({
			username: requireString(object.username),
			password: requireString(object.password),
			bootstrapToken: requireString(object.bootstrapToken),
		}),
	);
}

function validateChangePasswordInput(value: unknown): ChangePasswordInput {
	return validateExactObject(
		value,
		["currentPassword", "newPassword"],
		(object) => ({
			currentPassword: requireString(object.currentPassword),
			newPassword: requireString(object.newPassword),
		}),
	);
}
