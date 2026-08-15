# routes

Repo-wide invariants, commands, and the directory map: `../AGENTS.md`.

TanStack's file router requires route files to live here, so the route
directory is the only feature-boundary exception in the repo. Route files are
thin: they bind a URL to a loader, component, or server handler. Domain logic
belongs in `src/features/*`.

## Structure

| Path | Binds |
| --- | --- |
| `__root.tsx` | Root document: head, stylesheet, scripts, and the dev-only TanStack Devtools (gated on `import.meta.env.DEV`). |
| `index.tsx` | Landing page. Loads account + entry state and renders the public-demo feature. |
| `login.tsx`, `register.tsx`, `setup.tsx` | Public authentication pages from the accounts feature. |
| `_authenticated.tsx` | Authenticated layout guard (navigation UX only). |
| `_authenticated/account.*` | Signed-in dashboards: index/live-console/api-keys/security. |
| `_authenticated/admin.*` | Administrator surfaces: user management and analytics. |
| `api/live-console/events.ts` | The private browser-session SSE route. Thin binding to the live-inference-console feature. |
| `v1/models.ts`, `v1/chat/completions.ts`, `v1/messages.ts` | The three public inference endpoints, each bound to the inference-gateway feature. |
| `v1/$.ts` | Rejection-only catch-all for unknown `/v1/*` paths. |

## Invariants

- **Allowlist only.** The public API surface is exactly the three explicit
  `v1` routes. `v1/$.ts` rejects everything else with a sanitized protocol
  `404`. Do not make the catch-all (or any route) a transparent proxy to
  llama-server. A future endpoint means a new explicit route file plus endpoint
  policy in the gateway feature.
- **Wrong method = `405` with `Allow`.** Known paths with the wrong method
  return 405; unknown paths return 404. Both are produced by the gateway, not
  by ad-hoc route code.
- **Generated tree.** `src/routeTree.gen.ts` is generated. After adding or
  renaming a route, run `pnpm generate-routes` and inspect the diff. Never
  hand-edit it.
- **Security does not live here.** Route `beforeLoad` guards and the
  `_authenticated` layout provide navigation UX only. Every protected server
  function enforces its own authorization through the accounts feature's
  middleware, and the SSE stream handler enforces session authorization
  independently.
- **No secrets or process logic in route files.** Keep them importable by the
  client bundle. Server-only work happens in the features they call.
