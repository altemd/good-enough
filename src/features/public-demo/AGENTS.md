# public-demo

Repo-wide invariants, commands, and the directory map: `../../../AGENTS.md`.

The public landing page (`/`): a streaming chat demo that works without an
account, plus the sign-in/registration entry controls. This feature is the
only place demo credentials are minted into a browser session.

## Files

| File | Owns |
| --- | --- |
| `public-demo-route.tsx` | Route entry. Records one landing-page view per load (guarded by a ref) and wires the demo-token server function into the page. |
| `public-demo-page.tsx` | Page state: authenticated account vs. anonymous demo, credential handling, model selection, and the chat composition. |
| `public-auth-controls.tsx` | Sign-in / register / new-account controls shown to non-owners. |
| `demo-chat.tsx` | Chat surface. Owns the `AbortController` and aborts the active stream on unmount. |
| `demo-chat-transport.ts` | The fetch/SSE client for the demo: streams a generation, surfaces status, and respects the abort signal. |
| `demo-chat-delta-buffer.ts` | Batches streamed deltas before render to avoid re-render churn. Bounded and flushed on completion/cancel. |
| `demo-chat-message.tsx`, `demo-chat-transcript.tsx` | Message and transcript rendering, including markdown for model output. |
| `demo-chat-composer.tsx` | Input and stop control. |
| `model-markdown.tsx` | Markdown rendering (react-markdown + remark-gfm) for model text. |
| `*.test.ts(x)` | Transport streaming/abort, delta buffering, transcript, and auth-control coverage. |

## Invariants

- The demo credential (a one-hour demo token from the accounts feature) lives
  only in React state. It is never persisted in browser storage, cookies, URLs,
  or logs. Issuance is anonymous and globally rate limited in the accounts
  feature, not here.
- The chat stream must abort on unmount (`demo-chat.tsx` cleanup) and expose a
  stop control. In-flight responses must not outlive the component.
- Model discovery reuses the shared bounded discovery helper; the demo does not
  issue a second discovery request after onboarding has already projected model
  IDs.
- Landing-page view recording happens once per page load, is fire-and-forget,
  and its failure is swallowed (analytics must never break the page).
- Rendered model output is untrusted content. Keep markdown rendering sanitized
  and do not execute anything from model output.
- The demo keys and chat never retain inference content server-side; the only
  persisted trace is an anonymous aggregate count (see the
  operations-analytics feature).
