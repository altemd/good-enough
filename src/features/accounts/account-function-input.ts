export function validateExactObject<T>(
	value: unknown,
	expectedKeys: ReadonlyArray<string>,
	map: (object: Record<string, unknown>) => T,
): T {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Invalid input");
	}
	const object = value as Record<string, unknown>;
	const keys = Object.keys(object).sort();
	const sortedExpectedKeys = [...expectedKeys].sort();
	if (
		keys.length !== sortedExpectedKeys.length ||
		keys.some((key, index) => key !== sortedExpectedKeys[index])
	) {
		throw new Error("Invalid input");
	}
	return map(object);
}

export function validateEmptyInput(value: unknown): Record<string, never> {
	return validateExactObject(value, [], () => ({}));
}

export function requireString(value: unknown): string {
	if (typeof value !== "string") {
		throw new Error("Invalid input");
	}
	return value;
}
