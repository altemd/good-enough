const MAX_SSE_FRAME_LENGTH = 64 * 1024;

export type MetadataProtocol = "anthropic" | "none" | "openai";

export interface StreamMetadata {
	ttftMs: number | null;
	inputTokens: number | null;
	outputTokens: number | null;
	totalTokens: number | null;
	cachedTokens: number | null;
	promptTokensPerSecond: number | null;
	generationTokensPerSecond: number | null;
}

export interface StreamMetadataObserver {
	observe(chunk: Uint8Array, elapsedMs: number): void;
	finish(elapsedMs: number): void;
	snapshot(): StreamMetadata;
}

interface MutableStreamMetadata extends StreamMetadata {}

type JsonObject = Record<string, unknown>;

const emptyMetadata = (): MutableStreamMetadata => ({
	ttftMs: null,
	inputTokens: null,
	outputTokens: null,
	totalTokens: null,
	cachedTokens: null,
	promptTokensPerSecond: null,
	generationTokensPerSecond: null,
});

export function createStreamMetadataObserver(
	protocol: MetadataProtocol,
): StreamMetadataObserver {
	if (protocol === "none") {
		return new NoopMetadataObserver();
	}

	return new SseMetadataObserver(protocol);
}

class NoopMetadataObserver implements StreamMetadataObserver {
	readonly #metadata = emptyMetadata();

	observe(_chunk: Uint8Array, _elapsedMs: number) {}

	finish(_elapsedMs: number) {}

	snapshot(): StreamMetadata {
		return { ...this.#metadata };
	}
}

class SseMetadataObserver implements StreamMetadataObserver {
	readonly #decoder = new TextDecoder();
	readonly #metadata = emptyMetadata();
	readonly #protocol: Exclude<MetadataProtocol, "none">;
	#buffer = "";
	#droppingOversizedFrame = false;

	constructor(protocol: Exclude<MetadataProtocol, "none">) {
		this.#protocol = protocol;
	}

	observe(chunk: Uint8Array, elapsedMs: number) {
		this.#consumeText(this.#decoder.decode(chunk, { stream: true }), elapsedMs);
	}

	finish(elapsedMs: number) {
		this.#consumeText(this.#decoder.decode(), elapsedMs);

		if (!this.#droppingOversizedFrame && this.#buffer.length > 0) {
			this.#consumeEvent(this.#buffer, elapsedMs);
		}

		this.#buffer = "";
	}

	snapshot(): StreamMetadata {
		const snapshot = { ...this.#metadata };
		if (
			snapshot.totalTokens === null &&
			snapshot.inputTokens !== null &&
			snapshot.outputTokens !== null
		) {
			snapshot.totalTokens = snapshot.inputTokens + snapshot.outputTokens;
		}
		return snapshot;
	}

	#consumeText(text: string, elapsedMs: number) {
		let pending = this.#buffer + text;
		this.#buffer = "";

		while (true) {
			const boundary = /\r?\n\r?\n/.exec(pending);
			if (!boundary || boundary.index === undefined) {
				break;
			}

			const event = pending.slice(0, boundary.index);
			pending = pending.slice(boundary.index + boundary[0].length);

			if (
				!this.#droppingOversizedFrame &&
				event.length <= MAX_SSE_FRAME_LENGTH
			) {
				this.#consumeEvent(event, elapsedMs);
			}
			this.#droppingOversizedFrame = false;
		}

		if (this.#droppingOversizedFrame) {
			// Keep only enough suffix to recognize a frame boundary split across
			// chunks while discarding all oversized frame content.
			this.#buffer = pending.slice(-3);
			return;
		}

		if (pending.length > MAX_SSE_FRAME_LENGTH) {
			this.#droppingOversizedFrame = true;
			this.#buffer = pending.slice(-3);
			return;
		}

		this.#buffer = pending;
	}

	#consumeEvent(event: string, elapsedMs: number) {
		const data = event
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart())
			.join("\n");

		if (data.length === 0 || data === "[DONE]") {
			return;
		}

		let payload: unknown;
		try {
			payload = JSON.parse(data);
		} catch {
			return;
		}

		if (!isJsonObject(payload)) {
			return;
		}

		if (this.#protocol === "openai") {
			observeOpenAiPayload(payload, elapsedMs, this.#metadata);
			return;
		}

		observeAnthropicPayload(payload, elapsedMs, this.#metadata);
	}
}

function observeOpenAiPayload(
	payload: JsonObject,
	elapsedMs: number,
	metadata: MutableStreamMetadata,
) {
	if (metadata.ttftMs === null && hasOpenAiGeneratedDelta(payload)) {
		metadata.ttftMs = elapsedMs;
	}

	const usage = asJsonObject(payload.usage);
	if (usage) {
		metadata.inputTokens = numberOrCurrent(
			usage.prompt_tokens,
			metadata.inputTokens,
		);
		metadata.outputTokens = numberOrCurrent(
			usage.completion_tokens,
			metadata.outputTokens,
		);
		metadata.totalTokens = numberOrCurrent(
			usage.total_tokens,
			metadata.totalTokens,
		);

		const promptDetails = asJsonObject(usage.prompt_tokens_details);
		if (promptDetails) {
			metadata.cachedTokens = numberOrCurrent(
				promptDetails.cached_tokens,
				metadata.cachedTokens,
			);
		}
	}

	const timings = asJsonObject(payload.timings);
	if (!timings) {
		return;
	}

	const cachedTokens = asNumber(timings.cache_n);
	const evaluatedTokens = asNumber(timings.prompt_n);
	const predictedTokens = asNumber(timings.predicted_n);

	if (cachedTokens !== null) {
		metadata.cachedTokens = cachedTokens;
	}
	if (metadata.inputTokens === null && evaluatedTokens !== null) {
		metadata.inputTokens = evaluatedTokens + (cachedTokens ?? 0);
	}
	if (metadata.outputTokens === null && predictedTokens !== null) {
		metadata.outputTokens = predictedTokens;
	}

	metadata.promptTokensPerSecond = numberOrCurrent(
		timings.prompt_per_second,
		metadata.promptTokensPerSecond,
	);
	metadata.generationTokensPerSecond = numberOrCurrent(
		timings.predicted_per_second,
		metadata.generationTokensPerSecond,
	);
}

function observeAnthropicPayload(
	payload: JsonObject,
	elapsedMs: number,
	metadata: MutableStreamMetadata,
) {
	if (payload.type === "message_start") {
		const message = asJsonObject(payload.message);
		applyAnthropicUsage(asJsonObject(message?.usage), metadata);
	}

	if (payload.type === "message_delta") {
		applyAnthropicUsage(asJsonObject(payload.usage), metadata);
	}

	if (
		metadata.ttftMs === null &&
		payload.type === "content_block_delta" &&
		hasAnthropicGeneratedDelta(asJsonObject(payload.delta))
	) {
		metadata.ttftMs = elapsedMs;
	}
}

function applyAnthropicUsage(
	usage: JsonObject | null,
	metadata: MutableStreamMetadata,
) {
	if (!usage) {
		return;
	}

	const uncachedInput = asNumber(usage.input_tokens);
	const cacheCreation = asNumber(usage.cache_creation_input_tokens);
	const cacheRead = asNumber(usage.cache_read_input_tokens);

	if (uncachedInput !== null || cacheCreation !== null || cacheRead !== null) {
		metadata.inputTokens =
			(uncachedInput ?? 0) + (cacheCreation ?? 0) + (cacheRead ?? 0);
	}
	if (cacheRead !== null) {
		metadata.cachedTokens = cacheRead;
	}

	metadata.outputTokens = numberOrCurrent(
		usage.output_tokens,
		metadata.outputTokens,
	);
}

function hasOpenAiGeneratedDelta(payload: JsonObject): boolean {
	if (!Array.isArray(payload.choices)) {
		return false;
	}

	return payload.choices.some((choice) => {
		const choiceObject = asJsonObject(choice);
		if (!choiceObject) {
			return false;
		}

		if (hasNonEmptyString(choiceObject.text)) {
			return true;
		}

		const delta = asJsonObject(choiceObject.delta);
		return (
			delta !== null &&
			(hasNonEmptyString(delta.content) ||
				hasNonEmptyString(delta.reasoning) ||
				hasNonEmptyString(delta.reasoning_content) ||
				hasNestedNonEmptyString(delta.tool_calls))
		);
	});
}

function hasAnthropicGeneratedDelta(delta: JsonObject | null): boolean {
	if (!delta) {
		return false;
	}

	return (
		hasNonEmptyString(delta.text) ||
		hasNonEmptyString(delta.thinking) ||
		hasNonEmptyString(delta.partial_json)
	);
}

function hasNestedNonEmptyString(value: unknown): boolean {
	if (hasNonEmptyString(value)) {
		return true;
	}
	if (Array.isArray(value)) {
		return value.some(hasNestedNonEmptyString);
	}
	if (isJsonObject(value)) {
		return Object.values(value).some(hasNestedNonEmptyString);
	}
	return false;
}

function hasNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function numberOrCurrent(
	value: unknown,
	current: number | null,
): number | null {
	return asNumber(value) ?? current;
}

// A numeric type alone does not make a value safe metadata. Callers must pass
// only values reached through explicit, protocol-specific metadata paths.
function asNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asJsonObject(value: unknown): JsonObject | null {
	return isJsonObject(value) ? value : null;
}

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
