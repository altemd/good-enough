# accounts

Repo-wide invariants, commands, and the directory map: `../../../AGENTS.md`.

Account lifecycle, browser sessions, personal and demo API keys, and
administrator flows. Persistence is SQLite through Node's built-in
`node:sqlite` and Drizzle ORM. Every server-side file here is server-only.

## Subdirectory ownership

| Path | Owns |
| --- | --- |
| `access/` | Public entry: setup (first admin with bootstrap token), registration, login/logout, password change, username policy. `ui/` holds the public auth pages and forms. |
| `api-keys/` | Personal seven-day keys and anonymous one-hour demo keys, plus `inference-api-key-authentication.server.ts` which the gateway calls to verify presented keys. `ui/api-keys-page.tsx` is the sign-in key dashboard. |
| `administration/` | Member administration (state, admin-issued temporary passwords), host-authorized sole-administrator recovery. `ui/member-administration-page.tsx` is admin-only. |
| `sessions/` | Browser-session persistence, cookie policy, the account-authorization middleware used by every protected server function, the session function runtime, and `ui/authenticated-layout.tsx`. |
| `testing/` | `account-test-context.ts`, the shared integration-test harness. Test-only; do not import from runtime code. |
| `ui/` | Shared account UI: `display-once-secret.tsx` (the display-once credential panel shared by personal and demo flows). Page shells come from `#/components/ui/page-layout`. |
| root files | Shared contracts and infrastructure, below. |

## Root shared files

- `schema.ts` — Drizzle schema for `users`, `sessions`, `api_keys`. Ownership
  rules are enforced by SQL CHECK constraints (e.g. personal keys require an
  owner; demo keys cannot be owned or revoked).
- `db.server.ts` — Database creation: `node:sqlite` `DatabaseSync` with WAL,
  `busy_timeout 5000`, `synchronous NORMAL`, foreign keys on; parent dir mode
  0700, file mode 0600; `migrate()` from `drizzle/` on startup; process-local
  singleton `getAccountDatabase()`.
- `config.server.ts` — Trusted env reads: `GOOD_ENOUGH_DATABASE_PATH`
  (default `./data/good-enough.sqlite`), `ACCOUNT_REGISTRATION_ENABLED` and
  `PUBLIC_DEMO_ENABLED` (default open, `true`/`false` only),
  `ACCOUNT_BOOTSTRAP_TOKEN` (32–256 bytes, no whitespace, ignored permanently
  once any account exists), `APP_ORIGIN`.
- `app-origin.ts` — Origin parsing. `APP_ORIGIN` defaults to
  `http://localhost:3000` in development; production requires HTTPS. Used by the
  CSRF middleware in `src/start.ts`.
- `credential-secrets.server.ts` — Credential generation and verification.
  Personal keys match `ge_<16>_<43>`, demo tokens `ge_demo_<16>_<43>`; 12-byte
  selector, 32-byte secret; SHA-256 fixed-size digests; `timingSafeEqual`
  comparison. Never store or log raw secrets.
- `rate-limit.server.ts` — Deliberately small process-local fixed-window rate
  limiter (bounded entry map, per-key windows). It is not a substitute for an
  ingress rate limit and resets on restart.
- `account-contract.ts` — `AccountMutationResult<T>` union and `CurrentAccount`
  shape every function and page consumes.
- `account-function-input.ts` — Strict `createServerFn` input validators.
- `account-function-runtime.server.ts` — Shared result/status/cookie-rotation
  helpers for account server functions.
- `account-lifecycle.integration.test.ts`, `account-persistence.test.ts` —
  Cross-flow integration and persistence coverage built on `testing/`.

## Invariants

- **Display-once secrets.** Personal keys and demo tokens are shown exactly
  once, immediately after creation. They exist in the browser only as React
  state; dismissal or unmount removes them. Never persist them in storage,
  cookies, URLs, logs, or account state.
- **Keys.** Personal keys live seven days and belong to one account; their
  principal is the user ID. Demo tokens live one hour, are anonymous (principal
  `demo:<selector>`), are capped at 25 unexpired globally, issuance is rate
  limited to 10 per 10 minutes, and issuance fails with `setup_required` until
  at least one account exists. Expired demo tokens are reaped opportunistically
  at issuance.
- **Sessions.** Browser sessions store token digests, never raw tokens; cookies
  follow `sessions/sessions.server.ts` policy. A session is *restricted* when
  `session.restricted` or `user.mustChangePassword`; restricted sessions cannot
  open the live console or admin surfaces.
- **Authorization.** Route `beforeLoad` checks provide navigation UX only. Each
  protected server function declares its requirement through the
  account-authorization middleware in `sessions/account-authorization.middleware.ts`,
  and each domain file keeps operation-specific role, ownership, restricted-
  session, and transaction invariants. Bootstrap completion is application
  state checked inside the registration/setup transaction, not an authorization
  policy.
- **Bootstrap.** The bootstrap token creates the first and only administrator;
  public registration always creates members. After the first account exists
  the token is permanently ignored, and operators must remove it from `.env`.
- **Transactions.** Account mutations run in immediate SQLite transactions
  (`behavior: "immediate"`). Database initialization mechanics belong to
  `db.server.ts`; each domain owns its mutation policy.
- **Recovery.** Administrator-issued temporary passwords and host-authorized
  sole-administrator recovery (`scripts/reset-admin-password.mjs` over
  `administration/administrator-recovery.server.ts`) are the only credential
  recovery paths. There is no email, OAuth, MFA, or public password recovery.
- **Privacy.** Persist only operational state (accounts, salted password
  hashes, sessions, roles, key selectors/digests/prefixes, expiry, revocation).
  Never persist per-user inference counts, tokens, TTFT, last-use timestamps,
  quotas, or history dashboards.

## Testing expectations

Use the `testing/account-test-context.ts` harness with in-memory or temporary
databases. Cover valid/missing/expired/revoked credentials, registration open
and closed states, bootstrap one-shot behavior, session restriction and
rotation, role and ownership boundaries, temporary-password lifetime, and
recovery invariants. Keep test-only cleanup in `testing/` and out of runtime
files.

## Deferred

Per-credential model policy, key quota/billing, email/OAuth/MFA, and public
password recovery are not implemented. Do not describe them as current
behavior.
