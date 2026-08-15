# scripts

Repo-wide invariants, commands, and the directory map: `../AGENTS.md`.

Host and operational entry points. These run on the operator's machine (or the
AMD pilot host), not inside the application bundle. Biome checks `.mjs`/`.ts`
here.

## Files

| File | Owns |
| --- | --- |
| `smoke-inference-gateway.mjs` | `pnpm test:runtime` entry. Builds the real Nitro server, starts it on an isolated loopback port, starts a delayed fake llama-server, migrates temporary SQLite state, and runs the scenario suite. Reports captured application stdout/stderr on failure. |
| `inference-gateway-smoke/*.mjs` | The smoke harness: `orchestration` (lifecycle/port management), `fake-backend` (a scripted loopback llama-server), `scenarios` (auth, routing, queue, streaming, cancellation, request IDs, event isolation, log privacy), `constants`, `database-fixture`. |
| `reset-admin-password.mjs` | `pnpm account:reset-admin -- <username>`. Thin host command over the accounts feature's administrator-recovery policy. Prints a display-once temporary password. |
| `start-amd-dev.sh` | `pnpm dev:amd`. Starts the AMD pilot development pair in tmux: llama-server (via the configured toolbox container) on loopback 8080 and the app in dev on 127.0.0.1:3000. Reads `GOOD_ENOUGH_MODEL_ROOT` (default `/mnt/bridge`) and `GOOD_ENOUGH_LLAMA_TOOLBOX` (default `llama-rocm-7.2.4`). Requires `.env` and a readable preset. |
| `check-amd-production.sh` | Production preflight (also an `ExecStartPre` of the app service): built output exists, `.env` is mode 600, `APP_ORIGIN` is HTTPS, and no `ACCOUNT_BOOTSTRAP_TOKEN` remains. |
| `install-amd-production-services.sh` | `pnpm prod:amd:install`. Verifies, then installs the `deploy/systemd/user` units into the user systemd config and enables the target (not started). |

## Invariants

- **Loopback only.** Every server these scripts start binds 127.0.0.1. Do not
  introduce a `0.0.0.0` binding.
- **Stop only what you started.** The smoke harness and the dev script track
  the processes/sessions they start and clean up only those.
- **Smoke tests are deterministic.** They use an isolated port, a temporary
  database, and synthetic data. They must assert the privacy contract (no
  prompt/response content in application stdout), not just happy-path status
  codes.
- **Host scripts are bash + `set -Eeuo pipefail`** (or the equivalent), fail
  fast on missing prerequisites, and print actionable errors. Keep them
  idempotent: re-running a start or install that is already satisfied must not
  corrupt state.
- **Reset-admin is display-once.** It prints the temporary password exactly
  once and never logs or otherwise persists it.
