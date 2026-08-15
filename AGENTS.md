# Good Enough — repository guidance

Good Enough is a self-hosted, single-host local AI inference service. It puts
authenticated OpenAI- and Anthropic-compatible HTTP APIs, browser accounts, a
public streaming demo, and a privacy-filtered live request console in front of
llama.cpp's `llama-server`. Development targets an AMD Ryzen AI Max+ 395 with
128 GB unified memory, but the gateway is not tied to that hardware. `README.md`
is the public source of truth for the product.

## How to read this repository

This file is the root orientation. Each directory owns a nested `AGENTS.md`
with its files and invariants. **Read the nested file before editing
anything in that directory** — do not discover those rules by grepping the
code. The map says what scans are unnecessary; trust it.

| Path | What it is | Load when touching |
| --- | --- | --- |
| `src/features/inference-gateway/` | Auth, admission/queue, proxying, metadata, protocol errors | its AGENTS.md (the core of the system) |
| `src/features/accounts/` | Accounts, sessions, personal + demo keys, admin flows | its AGENTS.md |
| `src/features/live-inference-console/` | Ephemeral principal-scoped event stream + console UI | its AGENTS.md |
| `src/features/operations-analytics/` | Anonymous hourly aggregate counts | its AGENTS.md |
| `src/features/client-onboarding/` | Display-once key panel + OpenCode config | its AGENTS.md |
| `src/features/public-demo/` | Landing-page streaming demo chat | its AGENTS.md |
| `src/` | TanStack Start app boundary, server-only rule, aliases | its AGENTS.md |
| `src/routes/` | File routes; the public API allowlist lives here | its AGENTS.md |
| `src/components/`, `src/lib/` | shadcn primitives, shared client helpers | their AGENTS.md |
| `scripts/` | Smoke harness, admin reset, AMD dev/production scripts | its AGENTS.md |
| `deploy/` | systemd user units for the AMD pilot | its AGENTS.md |
| `config/` | Placeholder for a review copy of the host llama-server preset | its AGENTS.md |
| `docs/` | Design contracts, operations guide, research, diagnosis | its AGENTS.md |

Repo-root files that matter: `README.md` (product), `.env.example`
(configuration document — keep in sync with code), `drizzle/` (committed
SQLite migrations), `pnpm-workspace.yaml` (dependency build allowlist),
`biome.json` (pinned to the installed Biome schema), `vite.config.ts`
(TanStack Start + Nitro + Tailwind + devtools plugin composition),
`opencode.json` (**gitignored; contains a live API key — never commit it**).

## Global invariants (non-negotiable)

- **Zero inference-content retention.** No prompts, responses, reasoning, tool
  arguments, request bodies, or raw SSE frames are persisted, logged, or
  written to production stdout. The only persisted activity data is anonymous
  hourly aggregate counts (see operations-analytics).
- **Public API allowlist.** Exactly `GET /v1/models`,
  `POST /v1/chat/completions`, `POST /v1/messages`. The `v1` catch-all is
  rejection-only. Never make any route a transparent llama-server proxy.
- **Loopback backend.** llama-server stays bound to 127.0.0.1 (or `::1` /
  `localhost`). External clients reach this gateway, never the backend.
- **One active generation globally.** Overflow waits in a bounded, fair,
  process-local queue (defaults: 64 total, 8 per principal, 600 s timeout).
  All queue and event state is process-local and resets on restart.
- **Server-only boundary.** Secrets, database, process env, and backend code
  live in `*.server.ts` modules that import
  `@tanstack/react-start/server-only`. Client code ships to browsers.
- **Vertical feature ownership.** No generic global controllers/services/
  repositories/utils layers. A feature keeps its server, functions, UI, schema,
  and tests together.
- **Generated files.** `src/routeTree.gen.ts` is generated — run
  `pnpm generate-routes` after route changes and inspect the diff; never
  hand-edit. Drizzle migrations in `drizzle/` come from `pnpm db:generate`;
  inspect every migration before committing it.
- **No secrets in the repo.** `.env`, `data/`, and `opencode.json` are
  gitignored. Never commit credentials, model files, or machine-specific
  secrets. Machine details stay in private operator notes.
- **No new dependency** without a demonstrated current need. No scaffold
  add-ons. Core packages include deliberate prerelease/nightly pins; test
  upgrades.

## Commands

Use pnpm; never introduce npm or yarn lockfiles.

```bash
pnpm install --frozen-lockfile   # pinned dependencies
pnpm dev                         # dev server on port 3000
pnpm dev:amd                     # AMD pilot: tmux llama-server + app
pnpm db:generate                 # generate Drizzle migrations (inspect diff)
pnpm db:check                    # validate committed migration history
pnpm generate-routes             # regenerate routeTree.gen.ts (inspect diff)
pnpm test                        # Vitest unit/feature tests
pnpm check                       # Biome format + lint
pnpm typecheck                   # strict tsc, no emit
pnpm build                       # production TanStack Start/Nitro build
pnpm test:runtime                # build + real server vs fake backend smoke
pnpm account:reset-admin -- <username>   # host recovery command
pnpm prod:amd:check|install|start|status|stop   # AMD production services
```

The full checkpoint gate:

```bash
pnpm db:generate && pnpm db:check && pnpm generate-routes
pnpm test
pnpm check
pnpm typecheck
pnpm build
pnpm test:runtime
```

`test:runtime` builds again; that double build is intentional when reporting
each acceptance criterion independently. While iterating, run the narrowest
relevant test first. Production runs `pnpm build && node
.output/server/index.mjs` (or the systemd units on the AMD host). Avoid commands
that leave orphaned dev servers.

## Session start

1. `git status --short` before editing; the worktree may hold intentional user
   changes — never discard or overwrite them.
2. Inspect the relevant files and tests (`rg`, `rg --files`).
3. Read the nested AGENTS.md for the directory you are touching, plus the
   `docs/design/` contract it links to, before changing a recorded decision.
4. Check `package.json` for current scripts.
5. State the smallest proposed checkpoint and its acceptance criteria before
   implementing.
6. Run checks proportional to the change; report failures accurately.

If this file or a nested file conflicts with current code, say so explicitly
instead of silently choosing one.

## Collaboration and teaching standard

- Explain changes by tracing the runtime flow first (the request or data
  lifecycle), define terms when introduced, and show which file owns what and
  why. Distinguish runtime behavior from TypeScript-only checks and generated
  files.
- Default to teaching, reviewing, and hinting. **Do not edit files, install
  packages, or commit unless the user explicitly requests it.** Read-only
  inspection and terminating verification commands are fine.
- Work in small vertical checkpoints when implementing. Label actual defects,
  compatibility gaps, requirements, reasonable alternatives, and preferences as
  distinct things.
- Use deterministic synthetic sentinels in tests; never real user prompts.
- A green build or test run is verification evidence, not proof of
  understanding. End each checkpoint with a concrete way to verify the result
  and one short question about the underlying mental model.

## Backend, model ownership, and deferred work

llama-server's router owns curated model routing and autoload over the host
operator's trusted preset (live file on the AMD host; review copy planned under
`config/llama-server/`). The pilot runs a single resident model child
(`--models-max 1`). Every valid personal or demo key may request every model in
that catalog — there is no per-credential model policy. Good Enough exposes no
model management, load, download, health, metrics, slot, or UI routes. The
operator may use private loopback model endpoints to prime models; that is host
operation, not an application control plane. Prime at least one model before
testing the browser demo.

Full contract and deferrals: `docs/design/inference-scheduling-and-model-
lifecycle.md` (admission/queue, residency, deferred model management) and
`docs/design/live-inference-console.md` (console). Deferred product slices
requiring an explicit decision before implementation:

- application-owned model management and GGUF downloads (security + lifecycle
  design),
- simulation mode (benchmark-driven canned backend, clearly labeled),
- administrator hardware telemetry surface,
- active concurrency above one (requires per-user fairness + hardware
  qualification),
- multi-process queue/event coordination.

Revalidate OpenCode/AI SDK client-retry assumptions when those pinned versions
change.

## Remote AMD host boundaries

The pilot runs on a host that is only reachable over a private network. Keep
the private details (SSH alias, tunnel commands, host-specific paths, and
automation key setup) in private operator notes, not in this public
repository — the public operations guide enforces the same rule.

- Do not connect, copy files, start/stop processes, run benchmarks, or change
  remote configuration without explicit authorization for the current task.
- On every connection, show the user every remote command run in the next
  progress message so it can be independently checked.
- Keep anything served on loopback with isolated ports. Identify and stop only
  processes the current task started. `toolbox run` termination may leave the
  inner `llama-server` alive: capture the inner PID, confirm the served model
  via `/v1/models`, and clean it up explicitly.
- No destructive commands, wildcard cleanup, unrelated service changes, or
  model deletion. Never expose secrets or private SSH material in output.

## Change discipline

- Preserve working generated code and unrelated dirty-worktree changes.
- Never use destructive Git commands unless explicitly requested and the
  consequence is understood. Commit style is conventional
  (`fix(scope):`, `feat(ops):`, …); one logical change per commit.
- Server logic stays on standard `Request`/`Response`/`Headers`/
  `ReadableStream`/`AbortController` APIs where they already solve the
  problem.
- Never weaken privacy, loopback validation, header filtering, cancellation,
  or exactly-once metadata behavior to simplify a feature.
- Update `README.md` when public behavior, configuration, or commands change,
  and update the `docs/design/` contract when a recorded decision changes.
  Keep `.env.example` in sync with the code.
- A checkpoint is complete only when implementation, focused tests,
  documentation, generated output, and proportional verification agree.
