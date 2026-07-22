export const HOST = "127.0.0.1";
export const PRIVATE_PROMPT = "private-prompt-smoke-sentinel";
export const PRIVATE_COMPLETION = "private-completion-smoke-sentinel";
export const PRIVATE_TOOL_ARGUMENT = "private-tool-argument-smoke-sentinel";
export const PRIVATE_UPSTREAM_ERROR = "private-upstream-error-smoke-sentinel";
export const DATABASE_PRINCIPAL_ID = "private-database-principal-sentinel";
export const DATABASE_API_KEY = `ge_${"s".repeat(16)}_${"v".repeat(43)}`;
export const DEMO_API_KEY = `ge_demo_${"m".repeat(16)}_${"n".repeat(43)}`;
export const DEMO_PRINCIPAL_ID = `demo:${"m".repeat(16)}`;
export const EXPIRED_API_KEY = `ge_${"e".repeat(16)}_${"x".repeat(43)}`;
export const REVOKED_API_KEY = `ge_${"r".repeat(16)}_${"y".repeat(43)}`;
export const DISABLED_API_KEY = `ge_${"d".repeat(16)}_${"z".repeat(43)}`;
export const UNRELATED_NUMBER = "987654321";
export const REQUEST_BODY = JSON.stringify({
	model: "smoke-model",
	messages: [{ role: "user", content: PRIVATE_PROMPT }],
	stream: true,
});
