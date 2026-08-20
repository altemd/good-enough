# components

Repo-wide invariants, commands, and the directory map: `../AGENTS.md`.

Shared presentational primitives and small cross-cutting hooks. No domain logic
and no server code here.

## Files

| Path | Owns |
| --- | --- |
| `ui/` | Presentational primitives. `button`, `textarea`, `collapsible`, `marker`, `message`, `native-select`, `bubble` are shadcn-CLI output (base-rhea registry on `@base-ui/react`); they keep the registry's `@/lib/utils` import so future `shadcn add` runs produce clean diffs. `input`, `page-layout`, `table`, `badge`, `copy-button`, `console-frame` are hand-written shared components following the same conventions; they are not registry output, so `shadcn add` will not overwrite them. |
| `common/use-submission.ts` | Shared submission-state hook: `isSubmitting`, `error`, `setError`, `run`. Wraps a server-function call, surfaces rejections as a readable `error`, and resets state on the next run. |
| `common/use-submission.test.tsx` | Hook coverage. |

## Invariants

- **`ui/` is generated — with hand-written additions.** Preserve the generated
  files' structure and imports (`@/lib/utils`, `@base-ui/react`,
  `class-variance-authority`). Customize at the call site with `className`
  overrides — that is the sanctioned mechanism.
  Trim unused primitive sub-exports rather than keeping the full generated
  surface. Do not add app logic, state machines, or feature coupling to a
  primitive. Hand-written additions (`input`, `page-layout`, `table`, `badge`,
  `copy-button`, `console-frame`) follow the same conventions but are not
  registry output, so `shadcn add` will not overwrite them.
- **Import path.** App code imports primitives through
  `#/components/ui/...` (the `#/*` alias). The `@/*` alias exists only for the
  generated files' internal `@/lib/utils` reference.
- **`useSubmission` (from `common/use-submission.ts`) is the shared submission
  contract.** Forms and pages that
  call a server function and show an error use this hook so error display and
  submit-state behavior stay consistent. Keep its public shape
  (`{ isSubmitting, error, setError, run }`) stable; features build on it.
- **Client-safe.** Everything in this directory ships to the browser. Do not
  import `*.server.ts` modules or Node APIs here.
