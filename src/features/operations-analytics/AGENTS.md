# operations-analytics

Repo-wide invariants, commands, and the directory map: `../../../AGENTS.md`.

Anonymous, hourly aggregate counts for public-activity visibility: landing-page
views, demo-key issuance, and demo inference outcomes. This is the only
feature that persists anything about inference activity, and it persists counts
only — never identities, content, or per-user data.

## Files

| File | Owns |
| --- | --- |
| `schema.ts` | `anonymous_hourly_analytics` Drizzle table: hour bucket + metric + count, with CHECK constraints on the metric enum and non-negative counts. |
| `anonymous-analytics.server.ts` | Read path and batch persistence: `analyticsHour`, `persistAnonymousAnalyticsBatch`, `readAnonymousAnalyticsSummary`. |
| `anonymous-analytics-recorder.server.ts` | In-memory batched recorder. Merges increments per hour/metric, flushes on a 5-second timer (unref'd) or on demand, requeues the batch if persistence throws, and drops new entries past a 512-pending cap rather than growing unbounded. |
| `anonymous-analytics.functions.ts` | `recordLandingPageView` (public, empty input, global rate limit 120/min) and `getAnonymousAnalyticsSummary` (administrator-only, flushes then reads). |
| `demo-inference-analytics.server.ts` | Gateway lifecycle observer that maps demo-principal generation events to metrics. Attached in `../inference-gateway/gateway.server.ts` next to the event source. |
| `ui/anonymous-analytics-page.tsx` | Administrator analytics dashboard page. |
| `*.test.ts` | Recorder batching, metric mapping, and read-path coverage. |

This schema is registered in the root `drizzle.config.ts` alongside the accounts
schema, so `pnpm db:generate` covers both.

## Invariants

- Metrics are the closed enum in `schema.ts`
  (`landing_page_loaded`, `demo_credential_issued`,
  `demo_inference_started/completed/rejected/failed/cancelled`). Adding a
  metric requires a schema change, a new migration, and a CHECK-constraint
  update.
- Observing the gateway is content-free: `demo-inference-analytics.server.ts`
  only accepts `demo:<selector>` principals and `generation` requests, and maps
  event outcome/status to a count. It never sees or retains prompt or response
  content.
- Recording must never affect inference. The recorder is in-memory, failure of
  a flush requeues quietly, and the pending cap bounds memory. A dropped
  increment is an accepted loss, not an error path.
- `recordLandingPageView` is public and rate limited globally
  (120 views/minute). `getAnonymousAnalyticsSummary` requires the administrator
  role through the account-authorization middleware.
- Retention: there is currently no automatic retention deadline on aggregate
  rows. If one is added, it is a product decision, not an implementation
  detail.
