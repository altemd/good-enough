import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";

const HOST = "127.0.0.1";
const PRIVATE_PROMPT = "private-prompt-smoke-sentinel";
const PRIVATE_COMPLETION = "private-completion-smoke-sentinel";
const PRIVATE_TOOL_ARGUMENT = "private-tool-argument-smoke-sentinel";
const PRIVATE_UPSTREAM_ERROR = "private-upstream-error-smoke-sentinel";
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
let applicationStdout = "";
let applicationStderr = "";
let shuttingDown = false;

const mockServer = createServer((request, response) => {
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
	const recordResponse = (response) => {
		const requestId = response.headers.get("x-request-id");
		assert.ok(requestId, "gateway response must include X-Request-Id");
		requestIds.push(requestId);
		return response;
	};

	const modelsResponse = recordResponse(
		await waitForServer(`${applicationOrigin}/v1/models`),
	);
	assert.equal(modelsResponse.status, 200);
	assert.deepEqual(await modelsResponse.json(), { object: "list", data: [] });

	const unknownResponse = recordResponse(
		await fetch(`${applicationOrigin}/v1/slots`),
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
		await fetch(`${applicationOrigin}/v1/messages`, { method: "PUT" }),
	);
	assert.equal(wrongMethodResponse.status, 405);
	assert.equal(wrongMethodResponse.headers.get("allow"), "POST");
	const wrongMethodRequestId = wrongMethodResponse.headers.get("x-request-id");
	assert.equal(
		wrongMethodResponse.headers.get("request-id"),
		wrongMethodRequestId,
	);
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
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(openAiResponse.status, 200);
	assert.deepEqual(mockState.generationPaths, ["/v1/chat/completions"]);

	const busyResponse = recordResponse(
		await fetch(`${applicationOrigin}/v1/messages`, {
			body: REQUEST_BODY,
			headers: {
				"anthropic-version": "2023-06-01",
				"content-type": "application/json",
			},
			method: "POST",
		}),
	);
	assert.equal(busyResponse.status, 429);
	assert.equal(busyResponse.headers.has("retry-after"), false);
	const busyRequestId = busyResponse.headers.get("x-request-id");
	assert.equal(busyResponse.headers.get("request-id"), busyRequestId);
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
				"anthropic-version": "2023-06-01",
				"content-type": "application/json",
			},
			method: "POST",
		}),
	);
	assert.equal(anthropicResponse.status, 200);
	assert.equal(
		anthropicResponse.headers.get("request-id"),
		anthropicResponse.headers.get("x-request-id"),
	);
	assert.deepEqual(mockState.generationPaths, [
		"/v1/chat/completions",
		"/v1/messages",
	]);
	await cancelAfterContent(anthropicResponse, PRIVATE_COMPLETION);
	await waitFor(() => mockState.cancelledResponses === 2);

	const completedOpenAiResponse = recordResponse(
		await fetch(`${applicationOrigin}/v1/chat/completions`, {
			body: REQUEST_BODY,
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(completedOpenAiResponse.status, 200);
	assert.match(await completedOpenAiResponse.text(), /\[DONE\]/);

	const completedAnthropicResponse = recordResponse(
		await fetch(`${applicationOrigin}/v1/messages`, {
			body: REQUEST_BODY,
			headers: {
				"anthropic-version": "2023-06-01",
				"content-type": "application/json",
			},
			method: "POST",
		}),
	);
	assert.equal(completedAnthropicResponse.status, 200);
	assert.equal(
		completedAnthropicResponse.headers.get("request-id"),
		completedAnthropicResponse.headers.get("x-request-id"),
	);
	assert.match(await completedAnthropicResponse.text(), /message_stop/);

	const upstreamErrorResponse = recordResponse(
		await fetch(`${applicationOrigin}/v1/chat/completions`, {
			body: REQUEST_BODY,
			headers: {
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

	await waitFor(() => readMetadataEvents(applicationStdout).length === 9);
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

	const allApplicationOutput = `${applicationStdout}\n${applicationStderr}`;
	for (const sentinel of [
		PRIVATE_PROMPT,
		PRIVATE_COMPLETION,
		PRIVATE_TOOL_ARGUMENT,
		PRIVATE_UPSTREAM_ERROR,
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

async function waitForServer(url) {
	let lastError;
	const deadline = Date.now() + 10_000;

	while (Date.now() < deadline) {
		if (application?.exitCode !== null) {
			throw new Error(
				`Built server exited before becoming ready with code ${application?.exitCode}.`,
			);
		}

		try {
			return await fetch(url);
		} catch (error) {
			lastError = error;
			await delay(50);
		}
	}

	throw new Error("Built server did not become ready in time.", {
		cause: lastError,
	});
}
