import "@tanstack/react-start/server-only";

import {
	setResponseHeader,
	setResponseStatus,
} from "@tanstack/react-start/server";

import type { AccountMutationResult } from "./account-contract.ts";

export async function runMutation<T>(
	operation: () => AccountMutationResult<T> | Promise<AccountMutationResult<T>>,
	onSuccess?: (value: T) => void | Promise<void>,
): Promise<AccountMutationResult<T>> {
	let result: AccountMutationResult<T>;
	try {
		result = await operation();
		if (result.ok) await onSuccess?.(result.value);
	} catch {
		result = { ok: false, code: "internal_error" };
	}
	await applyResultStatus(result);
	return result;
}

export async function runDisplayOnceSecretMutation<T>(
	operation: () => AccountMutationResult<T> | Promise<AccountMutationResult<T>>,
): Promise<AccountMutationResult<T>> {
	setResponseHeader("Cache-Control", "no-store");
	return runMutation(operation);
}

export async function runAccountRead<T>(
	operation: () => T | Promise<T>,
): Promise<T> {
	try {
		return await operation();
	} catch {
		setResponseStatus(500);
		throw new Error("Account service unavailable");
	}
}

async function applyResultStatus(result: AccountMutationResult<unknown>) {
	if (!result.ok) {
		if (result.retryAfterSeconds !== undefined) {
			setResponseHeader("Retry-After", String(result.retryAfterSeconds));
		}
		setResponseStatus(
			result.code === "capacity_reached" || result.code === "rate_limited"
				? 429
				: result.code === "configuration_error" ||
						result.code === "internal_error"
					? 500
					: result.code === "demo_disabled" ||
							result.code === "forbidden" ||
							result.code === "registration_closed"
						? 403
						: 400,
		);
	}
}
