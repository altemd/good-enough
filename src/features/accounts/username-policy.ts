const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/u;

export function normalizeUsername(value: string) {
	const username = value.trim();
	if (!USERNAME_PATTERN.test(username)) {
		return null;
	}
	return { username, normalizedUsername: username.toLowerCase() };
}
