# inference-gateway

Repo-wide invariants, commands, and the directory map: `../../../AGENTS.md`.

The only code that talks to the inference backend. It authenticates, accepts or
queues generation requests, and streams OpenAI/Anthropic-compatible traffic to
a loopback-only llama-server. Everything here is server-only.

## Files

| File | Owns |
| --- | --- |
| `gateway.server.ts` | Server composition. Binds allowed endpoints to `handleGatewayRequest`: process env, admission controller, auth verifier, lifecycle-observer factory. Imports `@tanstack/react-start/server-only`. |
| `proxy-stream.ts` | The shared transport: auth → routing/method check → backend config → admission (queue) → header sanitization → upstream fetch → streaming pump with metadata observation and cancellation. |
| `admission.ts` | Process-local admission. Fixed one active generation globally (`GENERATION_CONCURRENCY_LIMIT = 1`, not env-configurable) plus a bounded fair queue. Config env: `INFERENCE_MAX_QUEUED_GENERATIONS` (default 64), `INFERENCE_MAX_QUEUED_GENERATIONS_PER_PRINCIPAL` (default 8, must be ≤ global), `INFERENCE_QUEUE_TIMEOUT_SECONDS` (default 600). Fairness is round-robin over principals in arrival order. |
| `auth.server.ts` | Credential extraction by protocol (Bearer for OpenAI routes, `x-api-key` for Anthropic) and database-backed verification via the accounts feature. |
| `lifecycle-events.ts` | The single privacy-safe lifecycle event contract: `inference.request_started`, `inference.queued`, `inference.admission_decided`, `inference.first_output`, `inference.terminal`. Every field is safe for delivery to the owning account. |
| `request-lifecycle.ts` | Per-request exactly-once state machine: request ID, timing, queue/admission/upstream status, exactly one terminal finalization, metadata recording. Release happens before terminal metadata recording so a throwing recorder cannot leak capacity. |
| `request-preparation.ts` | Loopback origin validation and request/response header preparation. |
| `metadata.ts` | Bounded SSE observers for OpenAI/Anthropic usage and timing extraction. |
| `protocol-errors.ts` | Shared bounded upstream-error normalization, sanitized protocol fallbacks, terminal SSE error events, request-ID header application. |
| `openai-errors.ts`, `anthropic-errors.ts` | Protocol error envelopes, stable error codes, request-ID headers/validation. |
| `api-protocol.ts` | The `openai` \| `anthropic` protocol tag. |
| `openai-model-discovery.ts` | Client-safe bounded discovery of `/v1/models` IDs (64 KiB body, ≤100 models, ≤256-char IDs). Used by the onboarding UI, not by the proxy path. |
| `gateway-*.test.ts`, `*.test.ts`, `gateway.test-support.ts` | Routing, auth, admission/queue, streaming, metadata, live-event, and protocol-error integration coverage. |

## Request flow

1. A file route in `src/routes/v1/` passes the Web API `Request` to a
   `gateway.server.ts` handler with a trusted endpoint descriptor.
2. `proxy-stream.ts` authenticates before routing rejection, backend
   configuration, body reads, or admission. Only after successful
   authentication does it attach a live-event observer routed to the key-owning
   principal via `createLifecycleObserver`.
3. Generation endpoints then acquire capacity: admit immediately, wait in the
   fair queue, or reject. Queued requests send no response headers until the
   waiter is admitted, times out, is rejected, or is cancelled.
4. `request-preparation.ts` validates the loopback origin and sanitizes
   headers; the original body is forwarded as a stream with `duplex: "half"`.
5. Upstream errors (status ≥ 400) pass through only after a bounded
   protocol-conformance check; otherwise the gateway preserves the status but
   returns a sanitized protocol fallback.
6. Success streams chunk-by-chunk while `metadata.ts` observes bounded SSE
   fragments without changing bytes. The first semantic output publishes
   `inference.first_output`; structural events do not establish TTFT.
7. Completion, upstream body failure, incoming abort, or downstream reader
   cancellation all finalize exactly one terminal event and release the lease
   idempotently.

## Admission and queueing invariants

- `GENERATION_CONCURRENCY_LIMIT` stays 1 and is never a client- or
  env-overridable option. Queue bounds are trusted operator settings.
- Authentication failures, discovery calls, and routing rejections never
  acquire capacity, never contact llama-server, and never read the request
  body.
- Queue overflow: global bound full or per-principal bound full → immediate
  protocol `429` (error type `rate_limit_error` in both protocols) with the
  stable gateway code `capacity_exceeded` in `error.code` for OpenAI
  (Anthropic carries the reason in the message only). Queue timeout →
  `429` with code `queue_timeout`.
- A waiter whose client signal aborts is removed and finalized as cancelled
  (499), never admitted late.
- A lease is held until the upstream body completes, fails, or is cancelled.
  A slow downstream reader continues to occupy capacity.
- The queue and all admission state are process-local and reset on restart.
  Multi-process deployment requires an explicit coordinated design.

## Transport and privacy invariants

These are correctness and security requirements, not optional refinements.

- Accept only active, unexpired database-backed personal keys and one-hour
  demo keys (see the accounts feature). Database or migration failure returns a
  sanitized protocol-specific `500 configuration_error`.
- Missing, malformed, and unknown credentials receive the same generic
  protocol-specific `401` (OpenAI code `invalid_api_key`, Anthropic type
  `authentication_error`).
- `LLAMA_SERVER_URL` is read at the request boundary, defaults to
  `http://127.0.0.1:8080`, and must be an HTTP(S) origin with no credentials,
  path, query, or fragment on `127.0.0.1`, `::1`, or `localhost`. Invalid
  configuration returns a sanitized `500`.
- Forward request bodies byte-for-byte as streams. Do not buffer, log, parse,
  or retain them. The gateway does not rewrite request JSON or model choice.
- Strip request headers listed in `request-preparation.ts` (credentials,
  host/forwarding, hop-by-hop, and `Connection`-token-listed headers).
  `Content-Length` is intentionally preserved for backend compatibility.
- Preserve end-to-end content negotiation and protocol headers (`Content-Type`,
  `Accept`, `anthropic-version`, `anthropic-beta`). Strip response hop-by-hop
  headers.
- Send the gateway-owned request ID upstream as `X-Request-Id`. Expose it as
  `X-Request-Id` in OpenAI responses and `request-id` in Anthropic responses
  and error bodies. Add `Cache-Control: no-cache` and `X-Accel-Buffering: no`
  to SSE responses only when upstream omitted them.
- Preserve an upstream error body only when it is protocol-conforming JSON
  within the strict 64 KiB parse limit; otherwise return the sanitized
  fallback and drop stale representation headers. Connection failures become a
  sanitized `502 gateway_connection_error`. Never log an upstream error body.
- Do not buffer generated responses. The first downstream chunk must remain
  observable before upstream completion. On mid-stream upstream failure after
  bytes were forwarded, preserve forwarded bytes, append one sanitized
  protocol `error` SSE event, and close. Never append an error event after
  client cancellation.
- Link incoming cancellation upstream: client abort cancels the fetch and the
  upstream reader, and downstream reader cancellation does the same.
  Finalization and lease release are idempotent.

## Status and metadata semantics

- `responseStatus` is the gateway's status; `upstreamStatus` is
  llama-server's status or `null` when no upstream response existed
  (gateway-originated routing, capacity, configuration, cancellation-before-
  headers, and connection errors).
- `admissionStatus` is `admitted`, `rejected`, or `not_applicable`.
  `authenticationStatus` is `authenticated`, `rejected`, or
  `configuration_error` and never contains a principal ID or key.
- The admission snapshot records limit, active, queued, and per-principal
  counts at each admission step.
- Metadata observers retain at most one incomplete SSE frame, bounded to 64
  KiB. Extract numeric values only from explicit OpenAI/Anthropic usage and
  llama timing fields. Never estimate tokens from bytes, characters, or event
  counts; unavailable values remain `null`. TTFT is set only by the first
  non-empty content, reasoning, text, or tool-call delta.
- `GET /v1/models` records timing/status only and is OpenAI-spec only (Anthropic
  discovery is an open TODO in `gateway.server.ts`).

## Lifecycle event invariants

- Publish typed, content-free events only after successful authentication.
  Rejected or configuration-failed authentication publishes no personal-console
  event because there is no trusted owner.
- `principalId` is used only in memory to select subscribers for that same
  account. Never include it in an event payload, response, persistence record,
  or log.
- `lifecycle-events.ts` is the single event contract. Do not add internal-only
  fields to it or spread request/metadata objects into it. The live console
  routes these events unchanged and owns no duplicate event type.
- Events include the gateway request ID so an owner can match a console line to
  their own HTTP response. Never include prompts, completions, reasoning, tool
  arguments, raw SSE frames, credentials, cookies, paths, or request bodies.
- Do not write per-request inference metadata to production stdout.

## Testing expectations

Preserve or add tests, using deterministic synthetic private sentinels (never
real user prompts) for: credential shapes and wrong-protocol credentials; auth
before routing, configuration, body reads, and admission; allowlisted methods
and paths with query preservation; unknown-path and wrong-method rejection
without upstream contact; byte-identical bodies and first-chunk streaming;
header allow/deny behavior; upstream status/error pass-through and sanitized
connection/configuration errors; queue fair ordering, per-principal and global
bounds, timeout, waiter cancellation, and 429 contracts; incoming abort and
downstream cancellation; release on every terminal path; TTFT/usage parsing
across arbitrary chunk boundaries; exactly one terminal live event;
principal-to-principal event isolation; and sentinel absence from live events
and stdout.

## Reconsidering queueing or concurrency

The queue design and the client-retry rationale live in
`docs/research/opencode-subagents-and-gateway-queueing.md`. Active concurrency
above one remains deferred and requires per-user fairness plus hardware
qualification before implementation. Revalidate client header-timeout
assumptions whenever the pinned OpenCode or AI SDK version changes.
