import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const HOST = "127.0.0.1";
const PRIVATE_PROMPT = "private-prompt-smoke-sentinel";
const PRIVATE_COMPLETION = "private-completion-smoke-sentinel";
const PRIVATE_TOOL_ARGUMENT = "private-tool-argument-smoke-sentinel";
const PRIVATE_UPSTREAM_ERROR = "private-upstream-error-smoke-sentinel";
const DATABASE_PRINCIPAL_ID = "private-database-principal-sentinel";
const DATABASE_API_KEY = `ge_${"s".repeat(16)}_${"v".repeat(43)}`;
const DEMO_API_KEY = `ge_demo_${"m".repeat(16)}_${"n".repeat(43)}`;
const DEMO_PRINCIPAL_ID = `demo:${"m".repeat(16)}`;
const EXPIRED_API_KEY = `ge_${"e".repeat(16)}_${"x".repeat(43)}`;
const REVOKED_API_KEY = `ge_${"r".repeat(16)}_${"y".repeat(43)}`;
const DISABLED_API_KEY = `ge_${"d".repeat(16)}_${"z".repeat(43)}`;
const UNRELATED_NUMBER = "987654321";
const REQUEST_BODY = JSON.stringify({
	model: "smoke-model",
	messages: [{ role: "user", content: PRIVATE_PROMPT }],
	stream: true,
});

const mockState = {
	generationPaths: [],
	cancelledResponses: 0,
};

let application;
const runtimeDirectory = mkdtempSync(join(tmpdir(), "good-enough-runtime-"));
const databasePath = join(runtimeDirectory, "accounts.sqlite");
let applicationStdout = "";
let applicationStderr = "";
let shuttingDown = false;

const mockServer = createServer((request, response) => {
	assert.equal(request.headers.authorization, undefined);
	assert.equal(request.headers["x-api-key"], undefined);
	request.resume();

	if (request.method === "GET" && request.url === "/v1/models") {
		response.writeHead(200, { "content-type": "application/json" });
		response.end('{"object":"list","data":[]}');
		return;
	}

	if (
		request.method !== "POST" ||
		(request.url !== "/v1/chat/completions" && request.url !== "/v1/messages")
	) {
		response.writeHead(404, { "content-type": "application/json" });
		response.end('{"error":"mock route not found"}');
		return;
	}

	mockState.generationPaths.push(request.url);
	const generationNumber = mockState.generationPaths.length;
	const isOpenAi = request.url === "/v1/chat/completions";
	if (request.headers["x-smoke-upstream-error"] === "1") {
		response.writeHead(503, {
			"content-type": "application/json",
			"retry-after": "4",
		});
		response.end(JSON.stringify({ private_detail: PRIVATE_UPSTREAM_ERROR }));
		return;
	}
	const shouldRemainOpen = generationNumber <= 2;
	let contentTimer;

	response.writeHead(200, {
		"cache-control": "no-cache",
		"content-type": "text/event-stream",
	});
	response.flushHeaders();
	response.write(
		isOpenAi
			? 'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n'
			: 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":3,"cache_read_input_tokens":1}}}\n\n',
	);

	contentTimer = setTimeout(() => {
		if (response.destroyed) {
			return;
		}

		response.write(
			isOpenAi
				? `data: {"choices":[{"delta":{"content":"${PRIVATE_COMPLETION}","tool_calls":[{"function":{"arguments":"${PRIVATE_TOOL_ARGUMENT}"}}]}}],"unrelated":${UNRELATED_NUMBER}}\n\n`
				: `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"${PRIVATE_COMPLETION}"},"unrelated":${UNRELATED_NUMBER}}\n\n`,
		);

		if (!shouldRemainOpen) {
			response.end(
				isOpenAi
					? 'data: {"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\ndata: [DONE]\n\n'
					: 'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":2}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
			);
		}
	}, 30);

	response.on("close", () => {
		clearTimeout(contentTimer);
		if (!response.writableEnded) {
			mockState.cancelledResponses += 1;
		}
	});
});

const shutdown = async () => {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;

	if (application && application.exitCode === null) {
		application.kill("SIGTERM");
		await Promise.race([once(application, "exit"), delay(2_000)]);
		if (application.exitCode === null) {
			application.kill("SIGKILL");
			await once(application, "exit");
		}
	}
	rmSync(runtimeDirectory, { recursive: true, force: true });

	if (mockServer.listening) {
		await new Promise((resolve, reject) => {
			mockServer.close((error) => (error ? reject(error) : resolve()));
		});
	}
};

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.once(signal, () => {
		void shutdown().finally(() => {
			process.exit(signal === "SIGINT" ? 130 : 143);
		});
	});
}

try {
	await listen(mockServer);
	const mockPort = getServerPort(mockServer);
	const applicationPort = await reservePort();
	const applicationOrigin = `http://${HOST}:${applicationPort}`;

	application = spawn(process.execPath, [".output/server/index.mjs"], {
		cwd: process.cwd(),
		env: {
			...process.env,
			HOST,
			ACCOUNT_BOOTSTRAP_TOKEN:
				"runtime-bootstrap-token-that-is-at-least-32-bytes",
			APP_ORIGIN: applicationOrigin,
			GOOD_ENOUGH_DATABASE_PATH: databasePath,
			LLAMA_SERVER_URL: `http://${HOST}:${mockPort}`,
			PORT: String(applicationPort),
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	application.stdout.setEncoding("utf8");
	application.stderr.setEncoding("utf8");
	application.stdout.on("data", (chunk) => {
		applicationStdout += chunk;
	});
	application.stderr.on("data", (chunk) => {
		applicationStderr += chunk;
	});

	const requestIds = [];
	const openAiHeaders = { authorization: `Bearer ${DATABASE_API_KEY}` };
	const anthropicHeaders = { "x-api-key": DATABASE_API_KEY };
	const recordResponse = (response, protocol = "openai") => {
		const requestIdHeader =
			protocol === "anthropic" ? "request-id" : "x-request-id";
		const requestId = response.headers.get(requestIdHeader);
		assert.ok(
			requestId,
			`gateway ${protocol} response must include ${requestIdHeader}`,
		);
		if (protocol === "anthropic") {
			assert.equal(response.headers.get("x-request-id"), null);
		}
		requestIds.push(requestId);
		return response;
	};

	const readinessResponse = recordResponse(
		await waitForServer(`${applicationOrigin}/v1/models`, {
			headers: openAiHeaders,
		}),
	);
	assert.equal(readinessResponse.status, 401);
	seedDatabaseKeys(databasePath);

	const databaseModelsResponse = recordResponse(
		await fetch(`${applicationOrigin}/v1/models`, {
			headers: { authorization: `Bearer ${DATABASE_API_KEY}` },
		}),
	);
	assert.equal(databaseModelsResponse.status, 200);
	assert.deepEqual(await databaseModelsResponse.json(), {
		object: "list",
		data: [],
	});
	const demoModelsResponse = recordResponse(
		await fetch(`${applicationOrigin}/v1/models`, {
			headers: { authorization: `Bearer ${DEMO_API_KEY}` },
		}),
	);
	assert.equal(demoModelsResponse.status, 200);
	assert.deepEqual(await demoModelsResponse.json(), {
		object: "list",
		data: [],
	});
	const databaseAnthropicResponse = recordResponse(
		await fetch(`${applicationOrigin}/v1/messages`, {
			headers: { "x-api-key": DATABASE_API_KEY },
			method: "PUT",
		}),
		"anthropic",
	);
	assert.equal(databaseAnthropicResponse.status, 405);
	const demoAnthropicResponse = recordResponse(
		await fetch(`${applicationOrigin}/v1/messages`, {
			headers: { "x-api-key": DEMO_API_KEY },
			method: "PUT",
		}),
		"anthropic",
	);
	assert.equal(demoAnthropicResponse.status, 405);

	for (const rejectedKey of [
		EXPIRED_API_KEY,
		REVOKED_API_KEY,
		DISABLED_API_KEY,
	]) {
		const rejectedResponse = recordResponse(
			await fetch(`${applicationOrigin}/v1/models`, {
				headers: { authorization: `Bearer ${rejectedKey}` },
			}),
		);
		assert.equal(rejectedResponse.status, 401);
		assert.equal(mockState.generationPaths.length, 0);
	}
	const expiredAnthropicResponse = recordResponse(
		await fetch(`${applicationOrigin}/v1/messages`, {
			headers: { "x-api-key": EXPIRED_API_KEY },
			method: "PUT",
		}),
		"anthropic",
	);
	assert.equal(expiredAnthropicResponse.status, 401);
	assert.equal(mockState.generationPaths.length, 0);

	const unauthenticatedOpenAiResponse = recordResponse(
		await fetch(`${applicationOrigin}/v1/chat/completions`, {
			body: REQUEST_BODY,
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(unauthenticatedOpenAiResponse.status, 401);
	assert.deepEqual(await unauthenticatedOpenAiResponse.json(), {
		error: {
			message: "Authentication failed.",
			type: "invalid_request_error",
			param: null,
			code: "invalid_api_key",
		},
	});

	const unauthenticatedAnthropicResponse = recordResponse(
		await fetch(`${applicationOrigin}/v1/messages`, { method: "PUT" }),
		"anthropic",
	);
	assert.equal(unauthenticatedAnthropicResponse.status, 401);
	assert.equal(unauthenticatedAnthropicResponse.headers.get("allow"), null);
	const unauthenticatedAnthropicRequestId =
		unauthenticatedAnthropicResponse.headers.get("request-id");
	assert.deepEqual(await unauthenticatedAnthropicResponse.json(), {
		type: "error",
		error: {
			type: "authentication_error",
			message: "Authentication failed.",
		},
		request_id: unauthenticatedAnthropicRequestId,
	});
	assert.equal(mockState.generationPaths.length, 0);

	const unknownResponse = recordResponse(
		await fetch(`${applicationOrigin}/v1/slots`, { headers: openAiHeaders }),
	);
	assert.equal(unknownResponse.status, 404);
	assert.deepEqual(await unknownResponse.json(), {
		error: {
			message: "Endpoint not found.",
			type: "invalid_request_error",
			param: null,
			code: "not_found",
		},
	});
	assert.equal(mockState.generationPaths.length, 0);

	const wrongMethodResponse = recordResponse(
		await fetch(`${applicationOrigin}/v1/messages`, {
			headers: anthropicHeaders,
			method: "PUT",
		}),
		"anthropic",
	);
	assert.equal(wrongMethodResponse.status, 405);
	assert.equal(wrongMethodResponse.headers.get("allow"), "POST");
	const wrongMethodRequestId = wrongMethodResponse.headers.get("request-id");
	assert.deepEqual(await wrongMethodResponse.json(), {
		type: "error",
		error: {
			type: "invalid_request_error",
			message: "Method not allowed for this endpoint.",
		},
		request_id: wrongMethodRequestId,
	});
	assert.equal(mockState.generationPaths.length, 0);

	const openAiResponse = recordResponse(
		await fetch(`${applicationOrigin}/v1/chat/completions`, {
			body: REQUEST_BODY,
			headers: {
				...openAiHeaders,
				"content-type": "application/json",
			},
			method: "POST",
		}),
	);
	assert.equal(openAiResponse.status, 200);
	assert.deepEqual(mockState.generationPaths, ["/v1/chat/completions"]);

	const busyResponse = recordResponse(
		await fetch(`${applicationOrigin}/v1/messages`, {
			body: REQUEST_BODY,
			headers: {
				...anthropicHeaders,
				"anthropic-version": "2023-06-01",
				"content-type": "application/json",
			},
			method: "POST",
		}),
		"anthropic",
	);
	assert.equal(busyResponse.status, 429);
	assert.equal(busyResponse.headers.has("retry-after"), false);
	const busyRequestId = busyResponse.headers.get("request-id");
	assert.deepEqual(await busyResponse.json(), {
		type: "error",
		error: {
			type: "rate_limit_error",
			message:
				"Inference capacity is currently in use. Retry the request later.",
		},
		request_id: busyRequestId,
	});
	assert.deepEqual(mockState.generationPaths, ["/v1/chat/completions"]);

	await cancelAfterContent(openAiResponse, PRIVATE_COMPLETION);
	await waitFor(() => mockState.cancelledResponses === 1);

	const anthropicResponse = recordResponse(
		await fetch(`${applicationOrigin}/v1/messages`, {
			body: REQUEST_BODY,
			headers: {
				...anthropicHeaders,
				"anthropic-version": "2023-06-01",
				"content-type": "application/json",
			},
			method: "POST",
		}),
		"anthropic",
	);
	assert.equal(anthropicResponse.status, 200);
	assert.deepEqual(mockState.generationPaths, [
		"/v1/chat/completions",
		"/v1/messages",
	]);
	await cancelAfterContent(anthropicResponse, PRIVATE_COMPLETION);
	await waitFor(() => mockState.cancelledResponses === 2);

	const completedOpenAiResponse = recordResponse(
		await fetch(`${applicationOrigin}/v1/chat/completions`, {
			body: REQUEST_BODY,
			headers: {
				...openAiHeaders,
				"content-type": "application/json",
			},
			method: "POST",
		}),
	);
	assert.equal(completedOpenAiResponse.status, 200);
	assert.match(await completedOpenAiResponse.text(), /\[DONE\]/);

	const completedAnthropicResponse = recordResponse(
		await fetch(`${applicationOrigin}/v1/messages`, {
			body: REQUEST_BODY,
			headers: {
				...anthropicHeaders,
				"anthropic-version": "2023-06-01",
				"content-type": "application/json",
			},
			method: "POST",
		}),
		"anthropic",
	);
	assert.equal(completedAnthropicResponse.status, 200);
	assert.match(await completedAnthropicResponse.text(), /message_stop/);

	const upstreamErrorResponse = recordResponse(
		await fetch(`${applicationOrigin}/v1/chat/completions`, {
			body: REQUEST_BODY,
			headers: {
				...openAiHeaders,
				"content-type": "application/json",
				"x-smoke-upstream-error": "1",
			},
			method: "POST",
		}),
	);
	assert.equal(upstreamErrorResponse.status, 503);
	assert.equal(upstreamErrorResponse.headers.get("retry-after"), "4");
	const upstreamErrorBody = await upstreamErrorResponse.text();
	assert.match(upstreamErrorBody, /Inference backend returned an error/);
	assert.equal(upstreamErrorBody.includes(PRIVATE_UPSTREAM_ERROR), false);

	assert.deepEqual(mockState.generationPaths, [
		"/v1/chat/completions",
		"/v1/messages",
		"/v1/chat/completions",
		"/v1/messages",
		"/v1/chat/completions",
	]);

	await waitFor(
		() => readMetadataEvents(applicationStdout).length === requestIds.length,
	);
	const metadataEvents = readMetadataEvents(applicationStdout);
	assert.equal(metadataEvents.length, requestIds.length);
	assert.equal(new Set(requestIds).size, requestIds.length);
	for (const requestId of requestIds) {
		assert.equal(
			metadataEvents.filter((event) => event.requestId === requestId).length,
			1,
			`request ${requestId} must emit exactly one metadata event`,
		);
	}

	const busyMetadata = metadataEvents.find(
		(event) => event.rejectionReason === "capacity_exceeded",
	);
	assert.equal(busyMetadata?.responseStatus, 429);
	assert.equal(busyMetadata?.upstreamStatus, null);
	assert.equal(busyMetadata?.admissionStatus, "rejected");
	assert.equal(busyMetadata?.concurrencyLimit, 1);
	assert.equal(busyMetadata?.activeGenerationsAtAdmission, 1);
	assert.equal(busyMetadata?.queuedGenerationsAtAdmission, 0);

	const authenticationRejections = metadataEvents.filter(
		(event) => event.rejectionReason === "authentication_failed",
	);
	assert.equal(authenticationRejections.length, 7);
	for (const event of authenticationRejections) {
		assert.equal(event.responseStatus, 401);
		assert.equal(event.upstreamStatus, null);
		assert.equal(event.authenticationStatus, "rejected");
		assert.equal(event.admissionStatus, "not_applicable");
	}

	const allApplicationOutput = `${applicationStdout}\n${applicationStderr}`;
	for (const sentinel of [
		PRIVATE_PROMPT,
		PRIVATE_COMPLETION,
		PRIVATE_TOOL_ARGUMENT,
		PRIVATE_UPSTREAM_ERROR,
		DATABASE_PRINCIPAL_ID,
		DATABASE_API_KEY,
		DEMO_PRINCIPAL_ID,
		DEMO_API_KEY,
		EXPIRED_API_KEY,
		REVOKED_API_KEY,
		DISABLED_API_KEY,
		UNRELATED_NUMBER,
	]) {
		assert.equal(
			allApplicationOutput.includes(sentinel),
			false,
			`private sentinel leaked to application output: ${sentinel}`,
		);
	}

	console.info("Inference gateway runtime smoke test passed.");
} catch (error) {
	if (applicationStdout) {
		console.error("Built server stdout:\n", applicationStdout);
	}
	if (applicationStderr) {
		console.error("Built server stderr:\n", applicationStderr);
	}
	throw error;
} finally {
	await shutdown();
}

async function cancelAfterContent(response, expectedContent) {
	assert.ok(response.body, "streaming response must have a body");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let received = "";

	while (!received.includes(expectedContent)) {
		const result = await reader.read();
		assert.equal(result.done, false, "stream ended before its content event");
		received += decoder.decode(result.value, { stream: true });
	}

	await reader.cancel("runtime smoke cancellation");
}

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getServerPort(server) {
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	return address.port;
}

function seedDatabaseKeys(path) {
	const database = new DatabaseSync(path);
	const now = Date.now();
	const insertUser = database.prepare(
		"insert into users (id, username, normalized_username, password_hash, role, status, must_change_password, created_at, updated_at, password_changed_at) values (?, ?, ?, ?, 'member', ?, 0, ?, ?, ?)",
	);
	insertUser.run(
		DATABASE_PRINCIPAL_ID,
		"DatabaseUser",
		"databaseuser",
		"unused-runtime-password-hash",
		"active",
		now,
		now,
		now,
	);
	insertUser.run(
		"disabled-database-user",
		"DisabledUser",
		"disableduser",
		"unused-runtime-password-hash",
		"disabled",
		now,
		now,
		now,
	);
	const insertKey = database.prepare(
		"insert into api_keys (selector, kind, user_id, prefix, secret_digest, created_at, expires_at, revoked_at) values (?, 'personal', ?, ?, ?, ?, ?, ?)",
	);
	insertRuntimeKey(
		insertKey,
		DATABASE_API_KEY,
		DATABASE_PRINCIPAL_ID,
		now,
		now + 60_000,
		null,
	);
	insertRuntimeKey(
		insertKey,
		EXPIRED_API_KEY,
		DATABASE_PRINCIPAL_ID,
		now - 60_000,
		now,
		null,
	);
	insertRuntimeKey(
		insertKey,
		REVOKED_API_KEY,
		DATABASE_PRINCIPAL_ID,
		now,
		now + 60_000,
		now,
	);
	insertRuntimeKey(
		insertKey,
		DISABLED_API_KEY,
		"disabled-database-user",
		now,
		now + 60_000,
		null,
	);
	insertRuntimeDemoToken(database, DEMO_API_KEY, now, now + 60_000);
	database.close();
}

function insertRuntimeDemoToken(database, apiKey, createdAt, expiresAt) {
	const match = /^ge_demo_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{43})$/.exec(
		apiKey,
	);
	assert.ok(match);
	const [, selector, secret] = match;
	database
		.prepare(
			"insert into api_keys (selector, kind, user_id, prefix, secret_digest, created_at, expires_at, revoked_at) values (?, 'demo', null, ?, ?, ?, ?, null)",
		)
		.run(
			selector,
			`ge_demo_${selector}`,
			createHash("sha256").update(secret).digest(),
			createdAt,
			expiresAt,
		);
}

function insertRuntimeKey(
	statement,
	apiKey,
	userId,
	createdAt,
	expiresAt,
	revokedAt,
) {
	const match = /^ge_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{43})$/.exec(apiKey);
	assert.ok(match);
	const [, selector, secret] = match;
	statement.run(
		selector,
		userId,
		`ge_${selector}`,
		createHash("sha256").update(secret).digest(),
		createdAt,
		expiresAt,
		revokedAt,
	);
}

function listen(server, port = 0) {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, HOST, () => {
			server.off("error", reject);
			resolve();
		});
	});
}

function readMetadataEvents(output) {
	return output.split("\n").flatMap((line) => {
		try {
			const value = JSON.parse(line);
			return value.event === "inference_request" ? [value] : [];
		} catch {
			return [];
		}
	});
}

async function reservePort() {
	const server = createServer();
	await listen(server);
	const port = getServerPort(server);
	await new Promise((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
	return port;
}

async function waitFor(predicate, timeoutMilliseconds = 5_000) {
	const deadline = Date.now() + timeoutMilliseconds;
	while (!predicate()) {
		if (Date.now() >= deadline) {
			throw new Error("Timed out waiting for runtime smoke-test condition.");
		}
		await delay(20);
	}
}

async function waitForServer(url, init) {
	let lastError;
	const deadline = Date.now() + 10_000;

	while (Date.now() < deadline) {
		if (application?.exitCode !== null) {
			throw new Error(
				`Built server exited before becoming ready with code ${application?.exitCode}.`,
			);
		}

		try {
			return await fetch(url, init);
		} catch (error) {
			lastError = error;
			await delay(50);
		}
	}

	throw new Error("Built server did not become ready in time.", {
		cause: lastError,
	});
}
