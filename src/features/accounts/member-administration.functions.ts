import { createServerFn } from "@tanstack/react-start";

import { authorizeAccountFunction } from "./account-authorization.middleware.ts";
import {
	requireString,
	validateExactObject,
} from "./account-function-input.ts";

const administratorAccount = authorizeAccountFunction("administrator");

interface MemberInput {
	memberId: string;
}

interface SetMemberDisabledInput extends MemberInput {
	disabled: boolean;
}

export const getMembers = createServerFn({ method: "GET" })
	.middleware([administratorAccount])
	.handler(async ({ context }) => {
		const { runAuthorizedAccountRead } = await import(
			"./account-function-runtime.server.ts"
		);
		return runAuthorizedAccountRead(
			context.accountAuthorization,
			async (account) => {
				const { listMembers } = await import(
					"./member-administration.server.ts"
				);
				return listMembers(account);
			},
		);
	});

export const setMemberDisabled = createServerFn({ method: "POST" })
	.middleware([administratorAccount])
	.validator(validateSetMemberDisabledInput)
	.handler(async ({ context, data }) => {
		const { runAuthorizedAccountMutation } = await import(
			"./account-function-runtime.server.ts"
		);
		return runAuthorizedAccountMutation(
			context.accountAuthorization,
			async (account) => {
				const administration = await import(
					"./member-administration.server.ts"
				);
				return administration.setMemberDisabled(
					account,
					data.memberId,
					data.disabled,
				);
			},
		);
	});

export const issueMemberTemporaryPassword = createServerFn({ method: "POST" })
	.middleware([administratorAccount])
	.validator(validateMemberInput)
	.handler(async ({ context, data }) => {
		const { runAuthorizedAccountMutation } = await import(
			"./account-function-runtime.server.ts"
		);
		return runAuthorizedAccountMutation(
			context.accountAuthorization,
			async (account) => {
				const { issueTemporaryPassword } = await import(
					"./member-administration.server.ts"
				);
				return issueTemporaryPassword(account, data.memberId);
			},
		);
	});

function validateMemberInput(value: unknown): MemberInput {
	return validateExactObject(value, ["memberId"], (object) => ({
		memberId: requireString(object.memberId),
	}));
}

function validateSetMemberDisabledInput(
	value: unknown,
): SetMemberDisabledInput {
	return validateExactObject(value, ["memberId", "disabled"], (object) => {
		if (typeof object.disabled !== "boolean") {
			throw new Error("Invalid input");
		}
		return {
			memberId: requireString(object.memberId),
			disabled: object.disabled,
		};
	});
}
