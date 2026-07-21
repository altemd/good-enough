import "@tanstack/react-start/server-only";

import type { ApiProtocol } from "./api-protocol";

export type AuthenticationDecision =
	| { readonly status: "authenticated"; readonly principalId: string }
	| { readonly status: "configuration_error" }
	| { readonly status: "rejected" };

type PersonalApiKeyVerifier = (
	presentedKey: string,
) => AuthenticationDecision | Promise<AuthenticationDecision>;

export async function authenticateGatewayApiKey(
	request: Request,
	apiProtocol: ApiProtocol,
	verifyPersonalApiKey: PersonalApiKeyVerifier = verifyPersistedPersonalApiKey,
): Promise<AuthenticationDecision> {
	const presentedKey = extractApiKey(request.headers, apiProtocol);
	if (!presentedKey) {
		return { status: "rejected" };
	}

	try {
		return await verifyPersonalApiKey(presentedKey);
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

async function verifyPersistedPersonalApiKey(
	presentedKey: string,
): Promise<AuthenticationDecision> {
	const [{ authenticatePersonalApiKey }, { getAccountDatabase }] =
		await Promise.all([
			import("#/features/accounts/personal-api-keys.server.ts"),
			import("#/features/accounts/db.server.ts"),
		]);
	return authenticatePersonalApiKey(presentedKey, getAccountDatabase());
}
