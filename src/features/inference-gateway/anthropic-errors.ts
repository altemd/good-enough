type JsonObject = Record<string, unknown>;

export function applyAnthropicRequestIdHeaders(
	headers: Headers,
	requestId: string,
): void {
	headers.set("x-request-id", requestId);
	headers.set("request-id", requestId);
}

export function createAnthropicErrorBody(
	status: number,
	message: string,
	requestId: string,
	includeRequestId: boolean,
): JsonObject {
	const body: JsonObject = {
		type: "error",
		error: {
			type: anthropicErrorType(status),
			message,
		},
	};
	if (includeRequestId) {
		body.request_id = requestId;
	}
	return body;
}

export function isConformingAnthropicError(
	payload: JsonObject,
	requestId: string,
): boolean {
	if (!hasOnlyKeys(payload, ["type", "error", "request_id"])) {
		return false;
	}
	const error = asJsonObject(payload.error);
	return (
		payload.type === "error" &&
		payload.request_id === requestId &&
		error !== null &&
		hasOnlyKeys(error, ["type", "message"]) &&
		hasNonEmptyString(error.type) &&
		hasNonEmptyString(error.message)
	);
}

function anthropicErrorType(status: number): string {
	switch (status) {
		case 404:
			return "not_found_error";
		case 429:
			return "rate_limit_error";
		case 504:
			return "timeout_error";
		case 529:
			return "overloaded_error";
		default:
			return status >= 500 ? "api_error" : "invalid_request_error";
	}
}

/**
 * Makes sure that the passed keys array is exactly the properties.
 */
function hasOnlyKeys(object: JsonObject, keys: ReadonlyArray<string>): boolean {
	return (
		Object.keys(object).length === keys.length &&
		keys.every((key) => Object.hasOwn(object, key))
	);
}

function hasNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

/**
 * Checks whether an unknown runtime value is a non-array object and returns as a `JsonObject`, `null` otherwise. 
 */
function asJsonObject(value: unknown): JsonObject | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as JsonObject)
		: null;
}
