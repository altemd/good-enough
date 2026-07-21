import { createServerFn } from "@tanstack/react-start";

import {
	requireString,
	validateExactObject,
} from "./account-function-input.ts";

interface MemberInput {
	memberId: string;
}

interface SetMemberDisabledInput extends MemberInput {
	disabled: boolean;
}

export const getMembers = createServerFn({ method: "GET" }).handler(
	async () => {
		const { readCurrentAccount, runAccountRead } = await import(
			"./account-function-runtime.server.ts"
		);
		return runAccountRead(async () => {
			const { listMembers } = await import("./member-administration.server.ts");
			const account = await readCurrentAccount();
			return account ? listMembers(account) : null;
		});
	},
);

export const setMemberDisabled = createServerFn({ method: "POST" })
	.validator(validateSetMemberDisabledInput)
	.handler(async ({ data }) => {
		const { readCurrentAccount, runMutation } = await import(
			"./account-function-runtime.server.ts"
		);
		return runMutation(async () => {
			const administration = await import("./member-administration.server.ts");
			const account = await readCurrentAccount();
			if (!account) {
				return { ok: false as const, code: "forbidden" as const };
			}
			return administration.setMemberDisabled(
				account,
				data.memberId,
				data.disabled,
			);
		});
	});

export const issueMemberTemporaryPassword = createServerFn({ method: "POST" })
	.validator(validateMemberInput)
	.handler(async ({ data }) => {
		const { readCurrentAccount, runMutation } = await import(
			"./account-function-runtime.server.ts"
		);
		return runMutation(async () => {
			const { issueTemporaryPassword } = await import(
				"./member-administration.server.ts"
			);
			const account = await readCurrentAccount();
			if (!account) {
				return { ok: false as const, code: "forbidden" as const };
			}
			return issueTemporaryPassword(account, data.memberId);
		});
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
