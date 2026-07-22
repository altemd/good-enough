import assert from "node:assert/strict";

import {
	BROWSER_SESSION_TOKEN,
	DATABASE_API_KEY,
	DATABASE_PRINCIPAL_ID,
	DEMO_API_KEY,
	DEMO_PRINCIPAL_ID,
	DISABLED_API_KEY,
	EXPIRED_API_KEY,
	PRIVATE_COMPLETION,
	PRIVATE_PROMPT,
	PRIVATE_TOOL_ARGUMENT,
	PRIVATE_UPSTREAM_ERROR,
	REQUEST_BODY,
	REVOKED_API_KEY,
	UNRELATED_NUMBER,
} from "./constants.mjs";
import { seedDatabaseKeys } from "./database-fixture.mjs";

export async function runGatewayScenarios(context) {
	const { application, applicationOrigin, databasePath, mockState } = context;
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
		await waitForServer(application, `${applicationOrigin}/v1/models`, {
			headers: openAiHeaders,
		}),
	);
	assert.equal(readinessResponse.status, 401);
	const unauthenticatedConsoleResponse = await fetch(
		`${applicationOrigin}/api/live-console/events`,
	);
	assert.equal(unauthenticatedConsoleResponse.status, 401);
	assert.equal(
		unauthenticatedConsoleResponse.headers.get("cache-control"),
		"no-store",
	);
	seedDatabaseKeys(databasePath);
	const consoleResponse = await fetch(
		`${applicationOrigin}/api/live-console/events?principalId=ignored`,
		{
			headers: { cookie: `__Host-ge_session=${BROWSER_SESSION_TOKEN}` },
		},
	);
	assert.equal(consoleResponse.status, 200);
	assert.equal(
		consoleResponse.headers.get("content-type"),
		"text/event-stream; charset=utf-8",
	);
	assert.equal(consoleResponse.headers.get("cache-control"), "no-store");
	assert.ok(consoleResponse.body);
	const consoleReader = consoleResponse.body.getReader();

	const databaseModelsResponse = recordResponse(
		await fetch(`${applicationOrigin}/v1/models`, {
			headers: { authorization: `Bearer ${DATABASE_API_KEY}` },
		}),
	);
	assert.equal(databaseModelsResponse.status, 200);
	assert.deepEqual(await databaseModelsResponse.json(), {
		object: "list",
		data: [{ id: "smoke-model", object: "model" }],
	});
	const demoModelsResponse = recordResponse(
		await fetch(`${applicationOrigin}/v1/models`, {
			headers: { authorization: `Bearer ${DEMO_API_KEY}` },
		}),
	);
	assert.equal(demoModelsResponse.status, 200);
	assert.deepEqual(await demoModelsResponse.json(), {
		object: "list",
		data: [{ id: "smoke-model", object: "model" }],
	});
	const personalConsoleEvents = await readSseJsonEvents(consoleReader, 2);
	assert.deepEqual(
		personalConsoleEvents.map((event) => event.type),
		["inference.request_started", "inference.terminal"],
	);
	for (const event of personalConsoleEvents) {
		assert.equal(
			event.requestId,
			databaseModelsResponse.headers.get("x-request-id"),
		);
		assert.equal("principalId" in event, false);
	}
	await consoleReader.cancel("runtime personal console verified");
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

	let queuedResponseSettled = false;
	const queuedResponsePromise = fetch(`${applicationOrigin}/v1/messages`, {
		body: REQUEST_BODY,
		headers: {
			...anthropicHeaders,
			"anthropic-version": "2023-06-01",
			"content-type": "application/json",
		},
		method: "POST",
	}).then((response) => {
		queuedResponseSettled = true;
		return response;
	});
	await delay(100);
	assert.equal(queuedResponseSettled, false);
	assert.deepEqual(mockState.generationPaths, ["/v1/chat/completions"]);

	await cancelAfterContent(openAiResponse, PRIVATE_COMPLETION);
	await waitFor(() => mockState.cancelledResponses === 1);

	const anthropicResponse = recordResponse(
		await queuedResponsePromise,
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

	const completedDemoChatResponse = recordResponse(
		await fetch(`${applicationOrigin}/v1/chat/completions`, {
			body: REQUEST_BODY,
			headers: {
				authorization: `Bearer ${DEMO_API_KEY}`,
				"content-type": "application/json",
			},
			method: "POST",
		}),
	);
	assert.equal(completedDemoChatResponse.status, 200);
	assert.match(await completedDemoChatResponse.text(), /\[DONE\]/);

	assert.deepEqual(mockState.generationPaths, [
		"/v1/chat/completions",
		"/v1/messages",
		"/v1/chat/completions",
		"/v1/messages",
		"/v1/chat/completions",
		"/v1/chat/completions",
	]);

	assert.equal(new Set(requestIds).size, requestIds.length);
	assert.equal(
		readMetadataEvents(context.readApplicationStdout()).length,
		0,
		"built server must not write per-request metadata to stdout",
	);

	const allApplicationOutput = `${context.readApplicationStdout()}\n${context.readApplicationStderr()}`;
	for (const sentinel of [
		PRIVATE_PROMPT,
		PRIVATE_COMPLETION,
		PRIVATE_TOOL_ARGUMENT,
		PRIVATE_UPSTREAM_ERROR,
		DATABASE_PRINCIPAL_ID,
		DATABASE_API_KEY,
		BROWSER_SESSION_TOKEN,
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
}

async function readSseJsonEvents(reader, expectedCount) {
	const events = [];
	const decoder = new TextDecoder();
	let pending = "";
	const deadline = Date.now() + 5_000;

	while (events.length < expectedCount) {
		if (Date.now() >= deadline) {
			throw new Error("Timed out waiting for personal console events.");
		}
		const result = await readStreamWithTimeout(reader, 5_000);
		assert.equal(result.done, false, "personal console stream closed early");
		pending += decoder.decode(result.value, { stream: true });

		while (true) {
			const boundary = pending.indexOf("\n\n");
			if (boundary < 0) {
				break;
			}
			const frame = pending.slice(0, boundary);
			pending = pending.slice(boundary + 2);
			const data = frame
				.split("\n")
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trimStart())
				.join("\n");
			if (data.length > 0) {
				events.push(JSON.parse(data));
			}
		}
	}

	return events;
}

async function readStreamWithTimeout(reader, timeoutMilliseconds) {
	let timeout;
	try {
		return await Promise.race([
			reader.read(),
			new Promise((_, reject) => {
				timeout = setTimeout(
					() =>
						reject(new Error("Timed out reading the personal console stream.")),
					timeoutMilliseconds,
				);
			}),
		]);
	} finally {
		clearTimeout(timeout);
	}
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
async function waitFor(predicate, timeoutMilliseconds = 5_000) {
	const deadline = Date.now() + timeoutMilliseconds;
	while (!predicate()) {
		if (Date.now() >= deadline) {
			throw new Error("Timed out waiting for runtime smoke-test condition.");
		}
		await delay(20);
	}
}

async function waitForServer(application, url, init) {
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
