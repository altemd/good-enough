# Good Enough

Good Enough is a self-hosted local AI inference service for a single machine.
It puts authenticated OpenAI- and Anthropic-compatible HTTP APIs, a browser
demo, account management, and privacy-filtered live request telemetry in front
of [llama.cpp](https://github.com/ggml-org/llama.cpp)'s `llama-server`.

The project is being developed for an AMD Ryzen AI Max+ 395 with 128 GB of
unified memory, but the application gateway is not tied to that hardware. The
current pilot favors one request's performance over aggregate throughput: one
generation runs at a time while authenticated overflow waits in a bounded,
fair, process-local queue.

> [!WARNING]
> This is an experimental single-host pilot, not a hardened multi-tenant
> inference platform. Read [Current limitations](#current-limitations) and the
> [operations guide](docs/operations/amd-pilot-host-setup.md) before exposing it
> to the internet.

## What it includes

- A deliberately small public API surface:
  - `GET /v1/models`
  - `POST /v1/chat/completions`
  - `POST /v1/messages`
- Seven-day personal API keys and one-hour anonymous demo keys.
- Username/password accounts, revocable browser sessions, administrator setup,
  member administration, and host-assisted administrator recovery.
- A streaming browser demo with model discovery and OpenCode configuration.
- A private live console for content-free request lifecycle, queue, latency,
  token, throughput, and cache metrics.
- SQLite persistence through Drizzle ORM and Node's built-in `node:sqlite`.
- A streaming gateway that keeps personal credentials away from llama-server
  and never exposes llama-server's control, metrics, slot, or web UI routes.

## Project stack

| Area | Technology |
| --- | --- |
| Application | TypeScript, React 19, TanStack Start, and TanStack Router |
| Server runtime | Node.js 24+, Nitro's Node adapter, and Web API request/response streams |
| Styling and UI | Tailwind CSS 4, Base UI, Lucide, and React Markdown |
| Persistence | SQLite through Node's built-in `node:sqlite` driver and Drizzle ORM |
| Inference | llama.cpp's `llama-server` behind OpenAI- and Anthropic-compatible gateway routes |
| Testing and quality | Vitest, Testing Library, TypeScript strict checking, and Biome |
| Operations | pnpm, Nitro production output, and user-level systemd services for the AMD pilot |

## Runtime model

```text
API client or browser
        |
        v
Good Enough (accounts, authentication, admission, privacy boundary)
        |
        | loopback HTTP only
        v
llama-server (model routing and inference)
```

Good Enough authenticates a request before routing or reading its body. Allowed
requests are streamed to a loopback-only llama-server; request credentials,
cookies, forwarding headers, and hop-by-hop headers are removed first. Unknown
`/v1/*` paths never become a transparent llama-server proxy.

The gateway forwards request bodies unchanged. The host operator therefore
owns the trusted llama-server model catalog and sampling defaults. Every valid
personal or demo key can request every model in that catalog.

## Privacy boundary

Good Enough is designed for **zero inference-content retention**. It does not
persist prompts, responses, reasoning, tool arguments, request bodies, raw SSE
frames, or per-user inference history. It also avoids writing that content or
per-request inference metadata to application stdout.

It does persist the state needed to operate the service:

- accounts, salted password hashes, browser sessions, roles, and account state;
- API-key selectors, digests, non-secret prefixes, expiry, and revocation;
- anonymous hourly aggregate counts for landing-page views, demo-key issuance,
  and demo request outcomes.

The personal live console is ephemeral. Events are routed in memory only to the
account that owns the authenticated key, retain no history, and disappear on
refresh or process restart. Anonymous aggregate analytics currently have no
automatic retention deadline.

## Requirements

- Node.js 24 or newer
- pnpm and the committed `pnpm-lock.yaml`
- A compatible `llama-server` bound to loopback
- A GGUF model or a trusted llama-server router preset catalog

## Local development

1. Install the exact locked dependencies:

   ```bash
   pnpm install --frozen-lockfile
   ```

2. Create local configuration:

   ```bash
   cp .env.example .env
   openssl rand -hex 32
   ```

   Put the generated value in `ACCOUNT_BOOTSTRAP_TOKEN`. Keep `.env` and all
   generated credentials out of version control. Review
   `ACCOUNT_REGISTRATION_ENABLED` and `PUBLIC_DEMO_ENABLED`; both default to
   `true` in the example configuration.

3. Start llama-server on loopback. A minimal single-model development command
   is:

   ```bash
   llama-server \
     --model /path/to/model.gguf \
     --host 127.0.0.1 \
     --port 8080 \
     --parallel 1
   ```

4. Start the application:

   ```bash
   pnpm dev
   ```

5. Open [http://localhost:3000/setup](http://localhost:3000/setup), create the
   first administrator with the bootstrap token, then remove
   `ACCOUNT_BOOTSTRAP_TOKEN` from `.env` and restart the application.

The application defaults to `http://localhost:3000`, llama-server defaults to
`http://127.0.0.1:8080`, and SQLite defaults to
`./data/good-enough.sqlite`.

## Calling the API

Create a personal key from the signed-in account dashboard, or create a demo
key from the public landing page. A key is displayed once and cannot be
recovered.

Set it in your shell for the examples below:

```bash
export GOOD_ENOUGH_API_KEY="replace-with-your-display-once-key"
```

List available models:

```bash
curl --fail-with-body http://127.0.0.1:3000/v1/models \
  -H "Authorization: Bearer $GOOD_ENOUGH_API_KEY"
```

Stream an OpenAI-compatible chat completion:

```bash
curl --no-buffer --fail-with-body \
  http://127.0.0.1:3000/v1/chat/completions \
  -H "Authorization: Bearer $GOOD_ENOUGH_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{
    "model": "replace-with-a-model-id",
    "messages": [{"role": "user", "content": "Say hello in one sentence."}],
    "stream": true
  }'
```

Call the Anthropic-compatible Messages API:

```bash
curl --no-buffer --fail-with-body http://127.0.0.1:3000/v1/messages \
  -H "x-api-key: $GOOD_ENOUGH_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  --data '{
    "model": "replace-with-a-model-id",
    "max_tokens": 64,
    "messages": [{"role": "user", "content": "Say hello in one sentence."}],
    "stream": true
  }'
```

The browser onboarding panel can generate an OpenCode provider configuration
for the discovered model IDs. That JSON contains the plaintext API key; do not
commit it. Merge its `provider.good-enough` entry into an existing OpenCode
configuration rather than replacing unrelated providers.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `LLAMA_SERVER_URL` | `http://127.0.0.1:8080` | Loopback-only llama-server origin |
| `GOOD_ENOUGH_DATABASE_PATH` | `./data/good-enough.sqlite` | Account, key, session, and analytics database |
| `APP_ORIGIN` | `http://localhost:3000` outside production | Exact browser origin used for cookies and CSRF checks; production requires HTTPS |
| `ACCOUNT_BOOTSTRAP_TOKEN` | none | 32-256 byte, whitespace-free token for first-admin setup |
| `ACCOUNT_REGISTRATION_ENABLED` | `true` | Allow new public member registrations |
| `PUBLIC_DEMO_ENABLED` | `true` | Allow new one-hour demo keys |
| `INFERENCE_MAX_QUEUED_GENERATIONS` | `64` | Maximum process-local queued generations |
| `INFERENCE_MAX_QUEUED_GENERATIONS_PER_PRINCIPAL` | `8` | Per-account or per-demo-key queue bound |
| `INFERENCE_QUEUE_TIMEOUT_SECONDS` | `600` | Maximum wait before a protocol-compatible `429` |

`LLAMA_SERVER_URL` accepts only an HTTP(S) origin on `127.0.0.1`, `::1`, or
`localhost`, with no credentials, path, query, or fragment. Keep llama-server
off the external network even when Good Enough is public.

## Verification

Use the narrowest relevant test while iterating. The complete repository gate
is:

```bash
pnpm db:generate
pnpm db:check
pnpm generate-routes
pnpm test
pnpm check
pnpm typecheck
pnpm build
pnpm test:runtime
```

`pnpm test:runtime` builds the real Nitro server and tests it against an
isolated fake llama-server and temporary SQLite database. It covers
authentication, routing, queueing, streaming, cancellation, request IDs,
personal event isolation, and log privacy.

`src/routeTree.gen.ts` is generated. After adding or renaming a route, run
`pnpm generate-routes` and review the generated diff; do not edit it by hand.

## Production and AMD pilot

A generic production build runs as a Node server:

```bash
pnpm build
node .output/server/index.mjs
```

That command is not a complete public deployment. Terminate public HTTPS at a
trusted ingress, bind Good Enough and llama-server to loopback, protect the
SQLite database and `.env`, remove the bootstrap token after setup, and run a
single application process unless the process-local queue and live event source
are replaced with coordinated infrastructure.

For the target AMD host, use the tracked systemd services and the step-by-step
[AMD pilot host setup guide](docs/operations/amd-pilot-host-setup.md). It covers
the qualified llama.cpp container, router presets, model priming, production
environment checks, service installation, and end-to-end smoke tests.

## Project structure

```text
src/features/accounts/                 accounts, sessions, keys, and admin flows
src/features/inference-gateway/        auth, admission, proxying, and metadata
src/features/live-inference-console/   private ephemeral lifecycle stream
src/features/operations-analytics/     anonymous hourly aggregate counts
src/features/public-demo/              landing-page streaming chat
src/routes/                             TanStack file routes
drizzle/                                committed SQLite migrations
deploy/systemd/user/                    AMD pilot user services
scripts/                                smoke tests and host operations
```

More detailed decisions live in:

- [Inference scheduling and model lifecycle](docs/design/inference-scheduling-and-model-lifecycle.md)
- [Personal live inference console](docs/design/live-inference-console.md)
- [OpenCode subagents and gateway queueing research](docs/research/opencode-subagents-and-gateway-queueing.md)
- [AMD pilot host setup](docs/operations/amd-pilot-host-setup.md)

## Current limitations

- One generation is active globally; the queue is in memory and resets on
  restart.
- Queueing and live-console delivery do not coordinate across application
  processes.
- Public demo and account abuse controls are deliberately small, process-local,
  and not a substitute for an ingress rate limit or durable identity.
- Request JSON and model choice are not rewritten or policy-filtered by the
  gateway. Backend limits and the trusted llama-server catalog remain
  authoritative.
- There is no email, OAuth, MFA, or public password recovery.
- Application-owned model loading, downloads, saved sampling settings,
  simulation, and administrator hardware telemetry are not implemented.
- Parts of the framework stack are prerelease or nightly dependencies. Pin and
  test upgrades deliberately.

## License

Good Enough is licensed under the [Apache License 2.0](LICENSE). Model weights,
llama.cpp, and third-party dependencies retain their own licenses.
