import assert from "node:assert/strict";
import { createServer } from "node:http";

import {
	PRIVATE_COMPLETION,
	PRIVATE_TOOL_ARGUMENT,
	PRIVATE_UPSTREAM_ERROR,
	UNRELATED_NUMBER,
} from "./constants.mjs";

export function createFakeInferenceBackend() {
	const state = {
		generationPaths: [],
		cancelledResponses: 0,
	};

	const server = createServer((request, response) => {
		assert.equal(request.headers.authorization, undefined);
		assert.equal(request.headers["x-api-key"], undefined);
		request.resume();

		if (request.method === "GET" && request.url === "/v1/models") {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(
				'{"object":"list","data":[{"id":"smoke-model","object":"model"}]}',
			);
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

		state.generationPaths.push(request.url);
		const generationNumber = state.generationPaths.length;
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
				state.cancelledResponses += 1;
			}
		});
	});

	return { server, state };
}
