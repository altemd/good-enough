const DEFAULT_DEVELOPMENT_ORIGIN = "http://localhost:3000";

export function parseApplicationOrigin(
	value: string | undefined,
	nodeEnvironment: string | undefined,
): URL {
	const configured =
		value ??
		(nodeEnvironment === "production" ? null : DEFAULT_DEVELOPMENT_ORIGIN);
	if (!configured) {
		throw new Error("Missing application origin");
	}

	let url: URL;
	try {
		url = new URL(configured);
	} catch {
		throw new Error("Invalid application origin");
	}
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username.length > 0 ||
		url.password.length > 0 ||
		url.pathname !== "/" ||
		url.search.length > 0 ||
		url.hash.length > 0 ||
		(nodeEnvironment === "production" && url.protocol !== "https:")
	) {
		throw new Error("Invalid application origin");
	}
	return url;
}
