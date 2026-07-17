type JsonObject = Record<string, unknown>;

export function applyOpenAiRequestIdHeaders(
	headers: Headers,
	requestId: string,
): void {
	headers.set("x-request-id", requestId);
}

export function createOpenAiErrorBody(
	status: number,
	code: string,
	message: string,
): JsonObject {
	return {
		error: {
			message,
			type: openAiErrorType(status),
			param: null,
			code,
		},
	};
}

export function isConformingOpenAiError(payload: JsonObject): boolean {
	if (!hasOnlyKeys(payload, ["error"])) {
		return false;
	}
	const error = asJsonObject(payload.error);
	if (
		!error ||
		!hasOnlyAllowedKeys(error, ["message", "type", "param", "code"]) ||
		!hasNonEmptyString(error.message) ||
		!hasNonEmptyString(error.type)
	) {
		return false;
	}
	return (
		isOptionalNullableString(error.param) &&
		isOptionalNullableString(error.code)
	);
}

function openAiErrorType(status: number): string {
	if (status === 429) {
		return "rate_limit_error";
	}
	if (status >= 500) {
		return "server_error";
	}
	return "invalid_request_error";
}

/**
 * Makes sure that the passed keys array is exactly the properties.
 */
function hasOnlyKeys(
	object: JsonObject, 
	keys: ReadonlyArray<string>
): boolean {
	return (
		Object.keys(object).length === keys.length &&
		keys.every((key) => Object.hasOwn(object, key))
	);
}

/**
 * Makes sure nothing other than any subset of the passed keys array may appear as properties.
 */
function hasOnlyAllowedKeys(
	object: JsonObject,
	keys: ReadonlyArray<string>,
): boolean {
	return Object.keys(object).every((key) => keys.includes(key));
}

function isOptionalNullableString(value: unknown): boolean {
	return value === undefined || value === null || typeof value === "string";
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
