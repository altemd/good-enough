import { isAbortError } from "#/lib/errors";

const MAX_SSE_EVENT_BYTES = 64 * 1024;

export interface DemoChatRequestMessage {
	role: "user" | "assistant";
	content: string;
	reasoning_content?: string;
}

export interface DemoChatDelta {
	content?: string;
	reasoning?: string;
}

export class DemoChatError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DemoChatError";
	}
}

interface StreamDemoChatOptions {
	apiKey: string;
	model: string;
	messages: DemoChatRequestMessage[];
	signal: AbortSignal;
	onDelta: (delta: DemoChatDelta) => void;
	fetcher?: typeof fetch;
}

export async function streamDemoChat({
	apiKey,
	model,
	messages,
	signal,
	onDelta,
	fetcher = fetch,
}: StreamDemoChatOptions) {
	validateRequest(model, messages);
	const body = JSON.stringify({ model, messages, stream: true });
	const response = await performFetch(fetcher, "/v1/chat/completions", {
		body,
		cache: "no-store",
		credentials: "omit",
		headers: {
			accept: "text/event-stream",
			authorization: `Bearer ${apiKey}`,
			"content-type": "application/json",
		},
		method: "POST",
		signal,
	});
	ensureSuccessfulResponse(response);
	if (!response.headers.get("content-type")?.includes("text/event-stream")) {
		throw protocolError();
	}
	if (!response.body) throw protocolError();

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let completed = false;
	try {
		while (true) {
			const result = await reader.read();
			if (!completed) {
				buffer += decoder.decode(result.value, { stream: !result.done });
				const processed = processCompleteEvents(buffer, onDelta);
				buffer = processed.remainder;
				completed = processed.completed;
				if (encodedLength(buffer) > MAX_SSE_EVENT_BYTES) throw protocolError();
			}
			if (result.done) break;
		}
		if (!completed && buffer.trim().length > 0) {
			processEvent(buffer, onDelta);
		}
	} finally {
		reader.releaseLock();
	}
}

function processCompleteEvents(
	value: string,
	onDelta: (delta: DemoChatDelta) => void,
) {
	let remainder = value;
	while (true) {
		const separator = /\r?\n\r?\n/.exec(remainder);
		if (!separator || separator.index === undefined) {
			return { remainder, completed: false };
		}
		const event = remainder.slice(0, separator.index);
		remainder = remainder.slice(separator.index + separator[0].length);
		if (encodedLength(event) > MAX_SSE_EVENT_BYTES) throw protocolError();
		if (processEvent(event, onDelta)) {
			return { remainder: "", completed: true };
		}
	}
}

function processEvent(event: string, onDelta: (delta: DemoChatDelta) => void) {
	const lines = event.split(/\r?\n/);
	if (lines.some((line) => line.trim() === "event: error")) {
		throw new DemoChatError("The model stream ended unexpectedly. Try again.");
	}
	const data = lines
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).trimStart())
		.join("\n");
	if (data.length === 0) return false;
	if (data === "[DONE]") return true;

	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch {
		throw protocolError();
	}
	const delta = readOpenAiDelta(parsed);
	if (delta.content || delta.reasoning) onDelta(delta);
	return false;
}

function readOpenAiDelta(value: unknown): DemoChatDelta {
	if (!isRecord(value) || !Array.isArray(value.choices)) return {};
	const choice = value.choices[0];
	if (!isRecord(choice) || !isRecord(choice.delta)) return {};
	const content =
		typeof choice.delta.content === "string" ? choice.delta.content : undefined;
	const reasoningValue =
		choice.delta.reasoning_content ?? choice.delta.reasoning;
	const reasoning =
		typeof reasoningValue === "string" ? reasoningValue : undefined;
	return { content, reasoning };
}

async function performFetch(
	fetcher: typeof fetch,
	input: string,
	init: RequestInit,
) {
	try {
		return await fetcher(input, init);
	} catch (error) {
		if (isAbortError(error)) throw error;
		throw new DemoChatError(
			"The demo service could not be reached. Try again.",
		);
	}
}

function ensureSuccessfulResponse(response: Response) {
	if (response.ok) return;
	if (response.status === 401) {
		throw new DemoChatError("The demo credential is invalid or has expired.");
	}
	if (response.status === 429) {
		throw new DemoChatError("The model is currently busy. Try again shortly.");
	}
	if (response.status >= 500) {
		throw new DemoChatError(
			"The local model is temporarily unavailable. Try again.",
		);
	}
	throw protocolError();
}

function validateRequest(model: string, messages: DemoChatRequestMessage[]) {
	if (
		model.length === 0 ||
		model.length > 256 ||
		messages.length === 0 ||
		messages.some(
			(message) =>
				(message.role !== "user" && message.role !== "assistant") ||
				typeof message.content !== "string" ||
				(message.reasoning_content !== undefined &&
					typeof message.reasoning_content !== "string") ||
				(message.role === "user" && message.content.length === 0) ||
				(message.role === "assistant" &&
					message.content.length === 0 &&
					!message.reasoning_content),
		)
	) {
		throw protocolError();
	}
}

function encodedLength(value: string) {
	return new TextEncoder().encode(value).byteLength;
}

function protocolError() {
	return new DemoChatError(
		"The model returned an unsupported response. Try again.",
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
