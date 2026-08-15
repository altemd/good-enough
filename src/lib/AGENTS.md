# lib

Repo-wide invariants, commands, and the directory map: `../AGENTS.md`.

Minimal shared client-side helpers. Not a utility bucket.

## Files

| File | Owns |
| --- | --- |
| `utils.ts` | `cn(...)`: the Tailwind class-merging helper (`clsx` + `tailwind-merge`). The only thing the generated `ui/` primitives import via `@/lib/utils`. |
| `errors.ts` | `isAbortError(...)`: narrow check for `AbortError` `DOMException`, used to tell a user cancellation apart from a real failure. |

## Invariants

- Keep this directory tiny and client-safe. It ships to the browser.
- Do not accumulate a generic `utils` layer here. If a helper is only used by
  one feature, it belongs in that feature. If it is server-only, it belongs in
  the feature's `*.server.ts` files.
- Preserve the `@/lib/utils` path: the shadcn registry generates imports that
  expect it.
