# Personal live inference console

## Current checkpoint

The inference gateway now sends typed, privacy-filtered lifecycle events only
to listeners for the account that owns the accepted personal API key. This is
**principal-scoped routing**: `principalId` is the internal account label used
to choose the recipient. It stays in process memory and is never copied into an
event, response, or log.

The private `GET /api/live-console/events` TanStack Start route exposes the
source as server-sent events (SSE) to unrestricted signed-in browser sessions.
When an account has no subscriber, the source immediately discards the event.
It does not persist, replay, or log events. Production stdout also receives no
per-request inference metadata, so an ephemeral UI feed does not accidentally
become retained history through a log collector.

The authenticated `/account/live-console` page consumes that stream and shows
the newest 200 projected lifecycle lines in React memory. It starts empty,
labels the source as live and not simulated, and displays an explicit warning
when the server reports an event gap. Refreshing or leaving the page destroys
the visible history.

## Runtime ownership

`lifecycle-events.ts` owns one complete, privacy-safe event contract: request
identity, request kind, event time, admission result, first output, and terminal
result. A **contract** is the agreed shape and meaning of a message. This one is
both the gateway's lifecycle vocabulary and the exact event shape that may
later be sent to the owning account's browser.

`request-lifecycle.ts` creates the complete event and owns event order and
exactly-once completion. It starts measuring time when the request arrives, but
it does not attach a personal observer until authentication succeeds. Events
reuse the gateway's public `requestId`, which lets a user match a console line
to their own HTTP response. They do not expose the principal, username, key,
raw route, model, or request body.

`live-event-source.server.ts` owns a process-local set of subscribers for each
principal. Publication is synchronous and nonthrowing. A failing browser tab is
isolated from inference and from the same account's other tabs, and unsubscribe
is idempotent.

`personal-event-stream.server.ts` owns browser-session authorization, SSE
serialization, the bounded per-connection queue, session revalidation, and
disconnect cleanup. `src/routes/api/live-console/events.ts` is the thin
TanStack file-route binding required by the router. The route sits outside the
authenticated layout because navigation guards provide user experience, while
the stream handler independently enforces the security boundary.

`personal-console-events.ts` is the browser projection boundary. It accepts
only the five named lifecycle/transport events, validates the fields it uses,
and returns a small display model rather than retaining raw JSON. Unexpected
fields are discarded. `ui/personal-live-console-page.tsx` owns the EventSource
connection, connection state, 200-line React-memory bound, and presentation.

## Request flow

1. The gateway receives a request and creates its public `requestId`.
2. API-key authentication returns a trusted `principalId` when successful.
3. Only then does the gateway attach a lifecycle observer for that principal.
4. The request lifecycle creates complete privacy-filtered gateway events.
5. The event source forwards them unchanged only to subscribers for that same
   principal.
6. `principalId` remains the private delivery address; `requestId` appears in
   the event so the owner can recognize the request.

Missing, malformed, unknown, expired, or configuration-failed authentication
does not have a trusted owner, so it produces no personal-console event.

For a browser subscriber:

1. The route reads the configured HttpOnly session cookie from the request.
2. The account session store establishes an unrestricted active session.
3. The handler derives `principalId` from that trusted session and subscribes
   only to its event source; query strings and headers cannot select ownership.
4. The handler sends future events as SSE with `Cache-Control: no-store` and no
   replay identifier.
5. At most 64 pending lifecycle events are retained for that connection. A
   `console.gap` transport event reports exact loss if a slow reader overflows
   the bound.
6. The session is revalidated at least every 15 seconds and at its expiry
   boundary. Revocation, restriction, account disablement, expiry, persistence
   failure, request abort, or reader cancellation closes and unsubscribes it.

## Lifecycle order

A generation that produces semantic output follows:

1. `inference.request_started`
2. `inference.admission_decided`
3. `inference.first_output`
4. exactly one `inference.terminal` event

Structural SSE frames such as an assistant role do not establish first output.
Its `result.outcome` is `completed`, `cancelled`, `rejected`,
`configuration_error`, or `upstream_error`. A conforming upstream non-2xx
response is `completed` because the gateway successfully transported and
normalized the upstream response; connection, error-body, and stream-body
failures are `upstream_error`.

Discovery and authenticated routing rejections do not publish an admission
decision. Capacity rejection publishes the rejected admission decision before
its terminal rejection.

## Allowed data

Events may contain the owner's request ID, lifecycle state, gateway/upstream
status, duration, TTFT, authoritative token counts and throughput, cache reuse,
and a capacity snapshot. Numeric values come only from existing allowlisted
OpenAI, Anthropic, and llama timing fields.

Events must never contain prompts, completions, reasoning, tool arguments, raw
SSE frames, request bodies, credentials, cookies, principal IDs, usernames, raw
paths, filesystem paths, shell output, llama.cpp logs, or arbitrary upstream
error bodies.

This creates a temporary in-memory relationship between an authenticated
request and its owner, but not retained per-user activity. No request record,
usage row, API-key last-use value, or browser history is stored.

There is deliberately no second console event type and no event adapter. The
gateway contract must therefore remain safe for browser delivery. New fields
require the same privacy review as a public response field, and tests must keep
prohibited data out of the complete event.

## Current UI boundary

The UI consumes the existing SSE route, renders typed lifecycle events as a
privacy-filtered terminal-inspired panel, shows a clear empty state on initial
load, and retains at most the latest 200 rendered lines in React memory. It does
not use local storage, session storage, a history endpoint, or stdout-based
transport. `console.gap` becomes an explicit lost-live-events line instead of
allowing the visible sequence to look complete.

Anonymous demo tokens currently authenticate as a separate synthetic
principal, not as a signed-in account. They therefore have no personal browser
console subscriber. A demo-specific view requires a separate product and
security decision; do not route demo activity into a signed-in account by
guessing ownership.

Because the source is process-local, the SSE route and inference request must
reach the same Node process. Multi-process deployment requires an explicit
ephemeral cross-process transport before this behavior can be claimed there.
Global hardware telemetry and all-user operational activity are a separate
administrator concern, not part of the personal request console. Extending the
page with those concerns requires a separate product and security checkpoint.
