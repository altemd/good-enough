import { isAbortError } from "#/lib/errors";

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_MODEL_ID_LENGTH = 256;
const MAX_MODELS = 100;

export type OpenAiModelDiscoveryFailureKind =
	| "authentication"
	| "configuration"
	| "connection"
	| "protocol";

export class OpenAiModelDiscoveryError extends Error {
	readonly kind: OpenAiModelDiscoveryFailureKind;

	constructor(kind: OpenAiModelDiscoveryFailureKind) {
		super("Model discovery failed.");
		this.name = "OpenAiModelDiscoveryError";
		this.kind = kind;
	}
}

interface OpenAiModelDiscoveryOptions {
	signal?: AbortSignal;
	fetcher?: typeof fetch;
}

export async function discoverOpenAiModelIds(
	apiKey: string,
	options: OpenAiModelDiscoveryOptions = {},
) {
	let response: Response;
	try {
		response = await (options.fetcher ?? fetch)("/v1/models", {
			cache: "no-store",
			credentials: "omit",
			headers: {
				accept: "application/json",
				authorization: `Bearer ${apiKey}`,
			},
			signal: options.signal,
		});
	} catch (error) {
		if (isAbortError(error)) throw error;
		throw new OpenAiModelDiscoveryError("connection");
	}

	if (!response.ok) {
		if (response.status === 401) {
			throw new OpenAiModelDiscoveryError("authentication");
		}
		if (response.status >= 500) {
			throw new OpenAiModelDiscoveryError("connection");
		}
		throw new OpenAiModelDiscoveryError("protocol");
	}

	const body = await readBoundedText(response);
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		throw new OpenAiModelDiscoveryError("protocol");
	}
	if (!isRecord(parsed) || !Array.isArray(parsed.data)) {
		throw new OpenAiModelDiscoveryError("protocol");
	}

	const modelIds: string[] = [];
	const seen = new Set<string>();
	for (const value of parsed.data) {
		if (
			!isRecord(value) ||
			typeof value.id !== "string" ||
			value.id.length === 0 ||
			value.id.length > MAX_MODEL_ID_LENGTH ||
			seen.has(value.id)
		) {
			continue;
		}
		seen.add(value.id);
		modelIds.push(value.id);
		if (modelIds.length === MAX_MODELS) break;
	}
	if (modelIds.length === 0) {
		throw new OpenAiModelDiscoveryError("configuration");
	}
	return modelIds;
}

async function readBoundedText(response: Response) {
	if (!response.body) return "";
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > MAX_RESPONSE_BYTES) {
				throw new OpenAiModelDiscoveryError("protocol");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const body = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
