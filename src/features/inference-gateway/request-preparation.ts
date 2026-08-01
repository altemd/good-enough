import type { ApiProtocol } from "./api-protocol";
import { applyProtocolRequestIdHeaders } from "./protocol-errors";
import type { GatewayEndpoint } from "./proxy-stream";

export const DEFAULT_LLAMA_SERVER_URL = "http://127.0.0.1:8080";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const REQUEST_HEADERS_TO_STRIP = new Set([
	"authorization",
	"connection",
	"cookie",
	"forwarded",
	"host",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
	"via",
	"x-api-key",
	"x-forwarded-for",
	"x-forwarded-host",
	"x-forwarded-port",
	"x-forwarded-proto",
]);
const RESPONSE_HEADERS_TO_STRIP = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
]);

export function parseLoopbackOrigin(value: string): URL {
	const url = new URL(value);
	const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		!LOOPBACK_HOSTS.has(hostname) ||
		url.username.length > 0 ||
		url.password.length > 0 ||
		url.pathname !== "/" ||
		url.search.length > 0 ||
		url.hash.length > 0
	) {
		throw new Error("Invalid llama-server origin");
	}
	return url;
}

export function prepareUpstreamRequest(options: {
	request: Request;
	endpoint: GatewayEndpoint;
	llamaOrigin: URL;
	signal: AbortSignal;
	requestId: string;
}): Request {
	const upstreamUrl = new URL(options.endpoint.path, options.llamaOrigin);
	upstreamUrl.search = new URL(options.request.url).search;
	const headers = sanitizeHeaders(
		options.request.headers,
		REQUEST_HEADERS_TO_STRIP,
	);
	headers.set("x-request-id", options.requestId);

	const requestInit: RequestInit & { duplex?: "half" } = {
		method: options.request.method,
		headers,
		signal: options.signal,
	};
	if (options.request.body !== null) {
		requestInit.body = options.request.body;
		requestInit.duplex = "half";
	}

	return new Request(upstreamUrl, requestInit);
}

export function prepareDownstreamHeaders(
	upstreamHeaders: Headers,
	apiProtocol: ApiProtocol,
	requestId: string,
): Headers {
	const headers = sanitizeHeaders(upstreamHeaders, RESPONSE_HEADERS_TO_STRIP);
	applyProtocolRequestIdHeaders(headers, apiProtocol, requestId);
	return headers;
}

function sanitizeHeaders(
	source: Headers,
	blocked: ReadonlySet<string>,
): Headers {
	const headers = new Headers(source);
	const connectionTokens = headers
		.get("connection")
		?.split(",")
		.map((header) => header.trim().toLowerCase())
		.filter(Boolean);

	for (const header of blocked) {
		headers.delete(header);
	}
	for (const header of connectionTokens ?? []) {
		headers.delete(header);
	}
	return headers;
}
