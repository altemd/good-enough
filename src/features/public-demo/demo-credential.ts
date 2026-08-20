import type { AccountMutationResult } from "#/features/accounts/account-contract";

export interface DemoCredential {
	apiKey: string;
	createdAt: number;
	expiresAt: number;
}

export function messageForDemoFailure(
	result: Extract<AccountMutationResult<DemoCredential>, { ok: false }>,
) {
	const retry = result.retryAfterSeconds
		? ` Try again in about ${formatRetry(result.retryAfterSeconds)}.`
		: "";
	if (result.code === "rate_limited") {
		return `Too many demo starts were requested.${retry}`;
	}
	if (result.code === "capacity_reached") {
		return `All temporary demo credentials are currently allocated.${retry}`;
	}
	if (result.code === "setup_required") {
		return "The demo is not ready until the operator completes setup.";
	}
	if (result.code === "demo_disabled") {
		return "New public demos are temporarily disabled.";
	}
	return "The demo could not be started. Try again later.";
}

function formatRetry(seconds: number) {
	if (seconds < 60) return `${seconds} seconds`;
	const minutes = Math.ceil(seconds / 60);
	return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}
