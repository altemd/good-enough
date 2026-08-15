# deploy

Repo-wide invariants, commands, and the directory map: `../AGENTS.md`.

Deployment units and artifacts. Currently: the AMD pilot's user-level systemd
services under `systemd/user/`.

## Files

| File | Owns |
| --- | --- |
| `systemd/user/good-enough.target` | The unit that pulls both services up together. |
| `systemd/user/good-enough-app.service` | The Good Enough application. Runs the Nitro production output on loopback 127.0.0.1:3000 with `NODE_ENV=production`, an `ExecStartPre` preflight (`../scripts/check-amd-production.sh`), and sandboxing (strict system protections, memory caps, no new privileges). |
| `systemd/user/good-enough-llama.service` | The llama-server router, launched through the configured toolbox container, bound to loopback 8080 with the operator preset. `KillMode=control-group` with a bounded stop timeout. |

## Invariants

- **Loopback only.** Both services bind 127.0.0.1. External clients reach the
  application gateway, never llama-server directly. Do not introduce a
  `0.0.0.0` binding or an open port.
- **The application is single-process.** The process-local queue and live event
  source do not coordinate across multiple application processes. Running more
  than one app instance requires an explicit coordinated design first.
- **Preflight gates the app.** `ExecStartPre` runs the production check
  (built output present, `.env` mode 600, HTTPS `APP_ORIGIN`, no bootstrap
  token). Do not weaken or bypass it.
- **Keep sandboxing and limits.** ProtectSystem/ProtectHome, UMask 0077,
  memory caps, and no-new-privileges are deliberate for a public-facing pilot.
  Change them only as an explicit, recorded decision.
- **Install, don't hand-edit on the host.** Units are installed by
  `../scripts/install-amd-production-services.sh` (see `pnpm prod:amd:install`).
  Edit the tracked units here, then re-install. The host's live `config.ini`
  preset remains operator-owned.
- The llama service's model flags (preset, `--models-max`, autoload,
  `-cram 0`, `--spec-default`, `--no-ui`) reflect the qualified pilot profile.
  Changing them changes the operating profile and must be re-validated, not
  assumed.

See `docs/operations/amd-pilot-host-setup.md` for the full setup and first
validation guide.
