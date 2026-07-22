import { createServerFn } from "@tanstack/react-start";
import {
	requireString,
	validateExactObject,
} from "../account-function-input.ts";
import {
	runAccountRead,
	runMutation,
} from "../account-function-runtime.server.ts";
import {
	readAppOrigin,
	readBootstrapToken,
	readRegistrationEnabled,
} from "../config.server.ts";
import { authorizeAccountFunction } from "../sessions/account-authorization.middleware.ts";
import {
	logoutCurrentSession,
	readCurrentAccount,
	runBrowserSessionMutation,
} from "../sessions/session-function-runtime.server.ts";
import { changePassword, login } from "./authentication.server.ts";
import { registerMember } from "./registration.server.ts";
import { bootstrapAdministrator, getSetupState } from "./setup.server.ts";

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
	async () => runAccountRead(readCurrentAccount),
);

export const bootstrapAccount = createServerFn({ method: "POST" })
	.validator(validateBootstrapInput)
	.handler(async ({ data }) => runMutation(() => bootstrapAdministrator(data)));

export const registerAccount = createServerFn({ method: "POST" })
	.validator(validateCredentialsInput)
	.handler(async ({ data }) => {
		return runBrowserSessionMutation(
			() => {
				readAppOrigin();
				return registerMember(data);
			},
			() => ({}),
		);
	});

export const loginAccount = createServerFn({ method: "POST" })
	.validator(validateCredentialsInput)
	.handler(async ({ data }) => {
		return runBrowserSessionMutation(
			() => {
				readAppOrigin();
				return login(data);
			},
			(session) => ({ restricted: session.restricted }),
		);
	});

export const logoutAccount = createServerFn({ method: "POST" }).handler(
	async () => logoutCurrentSession(),
);

export const changeAccountPassword = createServerFn({ method: "POST" })
	.middleware([authenticatedAccount])
	.validator(validateChangePasswordInput)
	.handler(async ({ context, data }) => {
		return runBrowserSessionMutation(
			() => {
				readAppOrigin();
				return changePassword(context.account, data);
			},
			() => ({}),
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
