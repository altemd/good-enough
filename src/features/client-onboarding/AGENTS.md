# client-onboarding

Repo-wide invariants, commands, and the directory map: `../../../AGENTS.md`.

The browser panel shown after a personal or demo key is created. It owns the
display-once credential, generates an OpenCode provider configuration, and
helps the user wire up the first client.

## Files

| File | Owns |
| --- | --- |
| `api-credential-onboarding.tsx` | The panel: shows the key once, triggers model discovery, renders the generated JSON with copy affordances, and aborts discovery on retry/dismiss/unmount. |
| `opencode-config.ts` | Pure `buildOpenCodeConfigJson`: given a key, the application origin, and discovered model IDs, emits a complete `provider.good-enough` OpenCode configuration with the key inline. |
| `*.test.ts(x)` | Discovery failure/abort behavior and config-shape coverage. |

## Invariants

- The API key is displayed once and cannot be recovered. The panel must keep it
  visible until dismissal and must not hide or "secure" it away.
- Discovery uses the same-origin `GET /v1/models` with the in-memory key
  (`../inference-gateway/openai-model-discovery.ts`). Discovery
  failure must preserve the visible key and offer a retry. Dismissal, unmount,
  or an aborted request must remove both the key and the generated JSON from
  state.
- Never persist the key or the generated JSON in browser storage, cookies,
  URLs, logs, or account state. The generated JSON contains the plaintext key;
  the UI must warn against committing, sharing, or publishing it, and instruct
  merging the `provider.good-enough` entry into an existing OpenCode config
  rather than replacing unrelated providers.
- Model IDs come only from the discovered projection. Do not hardcode or
  guess model IDs.
- No environment-variable flow is offered. The OpenCode config with the key
  inline is the only path.
