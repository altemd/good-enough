# live-inference-console

Repo-wide invariants, commands, and the directory map: `../../../AGENTS.md`.

Ephemeral, principal-scoped delivery of the gateway's lifecycle events to the
signed-in owner's browser, plus the personal console UI. "Principal-scoped"
means the trusted account ID is used as an in-memory delivery address.

## Files

| File | Owns |
| --- | --- |
| `live-event-source.server.ts` | Process-local pub/sub: `publishToPrincipal` and `subscribe` per account. Synchronous, nonthrowing, isolated per listener. No history; listeners are the only subscribers. |
| `personal-event-stream.server.ts` | The authenticated SSE transport: browser-session authorization, SSE serialization, bounded per-connection pending queue, keep-alive comments, session revalidation, and disconnect cleanup. |
| `personal-console-events.ts` | Browser projection boundary. Accepts only `PERSONAL_CONSOLE_EVENT_NAMES` (the five gateway events plus the `console.gap` transport event), validates the fields it uses, and returns small display lines. Unknown shapes are discarded. |
| `ui/personal-live-console-page.tsx` | The console page: EventSource connection, connection state, manual reconnect, and the newest 200 lines held in React memory only. |
| `*.test.ts(x)` | Isolation, privacy, bound, revalidation, and projection coverage. |

The route binding `src/routes/api/live-console/events.ts` is a thin TanStack
file-route binding required by the router. It sits outside the authenticated
layout because navigation guards are UX; the stream handler independently
enforces the security boundary.

## Invariants

- The event contract is owned by the gateway's
  `../inference-gateway/lifecycle-events.ts`. This feature routes those events
  unchanged. Do not define a duplicate event type or adapter here, and do not
  add internal-only fields to the gateway contract "for the console".
- Events are process-local and ephemeral: no persistence, no replay, no history
  endpoint, no browser storage. Page load and refresh start empty; each tab
  keeps at most its newest 200 lines (`PERSONAL_CONSOLE_MAX_LINES`).
- The source discards events for a principal with no subscribers, so a closed
  dashboard costs nothing. Subscriber failure must not affect inference or
  another subscriber.
- The SSE route (`GET /api/live-console/events`) derives its principal only
  from the configured browser-session cookie, requires an unrestricted active
  session (403 for restricted sessions), sends `Cache-Control: no-store`, and
  never accepts a client-selected principal.
- Each SSE connection retains at most 64 pending events
  (`LIVE_CONSOLE_MAX_PENDING_EVENTS`). Overflow replaces lost events with an
  exact `console.gap` transport event carrying `droppedEvents`; it never
  replays. A keep-alive comment is sent when the queue is otherwise idle.
- Revalidate the captured session at least every 15 seconds
  (`LIVE_CONSOLE_SESSION_REVALIDATION_MS`) and at expiry. Close on revocation,
  restriction, account disablement, persistence failure, abort, or
  cancellation. Cleanup must be idempotent.
- Render typed privacy-filtered events, never raw log lines or raw SSE frames.
  Never include a principal ID, API key, username, or browser-session
  credential in an event payload or log. The owner-visible request ID is
  allowed so an owner can correlate a console line with their own HTTP
  response.
- Publish no console event for rejected or configuration-failed API-key
  authentication (no trusted owner exists).
- Label the panel as privacy-filtered and ephemeral. Do not forward raw
  llama.cpp or process stdout into the browser; the console is not a shell or
  terminal emulator.
- All-user activity and hardware telemetry belong to a separate administrator
  surface (deferred). Anonymous demo principals have no personal console.
- Multi-process deployment requires an explicit ephemeral cross-process
  transport or request/stream affinity; do not assume process-local state
  scales.
