export type AccountErrorCode =
	| "capacity_reached"
	| "configuration_error"
	| "demo_disabled"
	| "forbidden"
	| "internal_error"
	| "invalid_credentials"
	| "invalid_input"
	| "rate_limited"
	| "registration_closed"
	| "setup_complete"
	| "setup_required"
	| "username_unavailable";

export type AccountMutationResult<T = Record<string, never>> =
	| { ok: true; value: T }
	| { ok: false; code: AccountErrorCode; retryAfterSeconds?: number };

export interface CurrentAccount {
	id: string;
	username: string;
	role: "admin" | "member";
	mustChangePassword: boolean;
}
