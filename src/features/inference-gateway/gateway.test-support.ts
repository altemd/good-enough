import { createHash } from "node:crypto";
import { afterEach, beforeEach, vi } from "vitest";

import { getAccountDatabase } from "#/features/accounts/db.server";

import { createGenerationAdmissionController } from "./admission";
import type {
	GatewayDependencies,
	GatewayEndpoint,
	InferenceRequestMetadata,
} from "./proxy-stream";
import { handleGatewayRequest as handleGatewayRequestWithAuthentication } from "./proxy-stream";

export const encoder = new TextEncoder();
export const decoder = new TextDecoder();
const TEST_PRINCIPAL_ID = "test-account";
const TEST_SELECTOR = "s".repeat(16);
const TEST_SECRET = "v".repeat(43);
export const TEST_API_KEY = `ge_${TEST_SELECTOR}_${TEST_SECRET}`;
export const ENDPOINTS = {
	"chat/completions": {
		kind: "generation",
		method: "POST",
		path: "/v1/chat/completions",
		apiProtocol: "openai",
	},
	messages: {
		kind: "generation",
		method: "POST",
		path: "/v1/messages",
		apiProtocol: "anthropic",
	},
	models: {
		kind: "discovery",
		method: "GET",
		path: "/v1/models",
		apiProtocol: "openai",
	},
} as const satisfies Record<string, GatewayEndpoint>;

const authenticateTestRequest: GatewayDependencies["authenticate"] = () => ({
	status: "authenticated",
	principalId: TEST_PRINCIPAL_ID,
});

export function handleGatewayRequest(
	request: Request,
	endpoint: GatewayEndpoint | null,
	dependencies: Omit<GatewayDependencies, "admission" | "authenticate"> &
		Partial<Pick<GatewayDependencies, "admission" | "authenticate">> = {},
): Promise<Response> {
	return handleGatewayRequestWithAuthentication(request, endpoint, {
		admission: createGenerationAdmissionController(),
		authenticate: authenticateTestRequest,
		...dependencies,
	});
}

export function installGatewayTestHooks() {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	beforeEach(() => {
		vi.stubEnv("GOOD_ENOUGH_DATABASE_PATH", ":memory:");
		seedTestPersonalApiKey();
	});
}

export function createFetchMock(
	handler: (request: Request) => Promise<Response>,
) {
	const mock = vi.fn(handler);
	const fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		const request =
			input instanceof Request && init === undefined
				? input
				: new Request(input, init);
		return mock(request);
	}) as typeof globalThis.fetch;

	return { fetch, mock };
}

export function createRecorder() {
	const events: Array<InferenceRequestMetadata> = [];
	return {
		events,
		record: (metadata: InferenceRequestMetadata) => events.push(metadata),
	};
}

function seedTestPersonalApiKey() {
	const database = getAccountDatabase().sqlite;
	const now = Date.now();
	database
		.prepare(
			"insert or ignore into users (id, username, normalized_username, password_hash, role, status, must_change_password, created_at, updated_at, password_changed_at) values (?, ?, ?, ?, 'member', 'active', 0, ?, ?, ?)",
		)
		.run(
			TEST_PRINCIPAL_ID,
			"TestAccount",
			"testaccount",
			"unused-test-password-hash",
			now,
			now,
			now,
		);
	database
		.prepare(
			"insert or ignore into api_keys (selector, kind, user_id, prefix, secret_digest, created_at, expires_at, revoked_at) values (?, 'personal', ?, ?, ?, ?, ?, null)",
		)
		.run(
			TEST_SELECTOR,
			TEST_PRINCIPAL_ID,
			`ge_${TEST_SELECTOR}`,
			createHash("sha256").update(TEST_SECRET).digest(),
			now,
			now + 24 * 60 * 60 * 1000,
		);
}

export function postRequest(path: string, body: string): Request {
	return new Request(`https://gateway.example/v1/${path}`, {
		method: "POST",
		body,
		headers: {
			authorization: `Bearer ${TEST_API_KEY}`,
			"content-type": "application/json",
		},
	});
}

export function eventStream(chunks: ReadonlyArray<string>): Response {
	let index = 0;
	return new Response(
		new ReadableStream<Uint8Array>({
			pull(controller) {
				const chunk = chunks[index];
				index += 1;
				if (chunk === undefined) {
					controller.close();
					return;
				}
				controller.enqueue(encoder.encode(chunk));
			},
		}),
		{ headers: { "content-type": "text/event-stream; charset=utf-8" } },
	);
}

export function sse(payload: unknown, event?: string): string {
	return `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(payload)}\n\n`;
}

export function steppingClock() {
	let now = 0;
	return () => {
		now += 10;
		return now;
	};
}
