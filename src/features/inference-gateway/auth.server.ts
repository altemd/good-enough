import "@tanstack/react-start/server-only";

import type { ApiProtocol } from "./api-protocol";

export type AuthenticationDecision =
	| { readonly status: "authenticated"; readonly principalId: string }
	| { readonly status: "configuration_error" }
	| { readonly status: "rejected" };

type PersistedApiKeyVerifier = (
	presentedKey: string,
) => AuthenticationDecision | Promise<AuthenticationDecision>;

export async function authenticateGatewayApiKey(
	request: Request,
	apiProtocol: ApiProtocol,
	verifyApiKey: PersistedApiKeyVerifier = verifyPersistedApiKey,
): Promise<AuthenticationDecision> {
	const presentedKey = extractApiKey(request.headers, apiProtocol);
	if (!presentedKey) {
		return { status: "rejected" };
	}

	try {
		return await verifyApiKey(presentedKey);
	} catch {
		return { status: "configuration_error" };
	}
}

function extractApiKey(
	headers: Headers,
	apiProtocol: ApiProtocol,
): string | null {
	if (apiProtocol === "anthropic") {
		const apiKey = headers.get("x-api-key");
		return apiKey && !/\s/u.test(apiKey) ? apiKey : null;
	}

	const authorization = headers.get("authorization");
	const match = authorization?.match(/^Bearer ([^\s]+)$/i);
	return match?.[1] ?? null;
}

async function verifyPersistedApiKey(
	presentedKey: string,
): Promise<AuthenticationDecision> {
	const [{ authenticateInferenceApiKey }, { getAccountDatabase }] =
		await Promise.all([
			import("#/features/accounts/inference-api-key-authentication.server.ts"),
			import("#/features/accounts/db.server.ts"),
		]);
	return authenticateInferenceApiKey(presentedKey, getAccountDatabase());
}
