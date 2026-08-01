# AMD Pilot Host Setup And First Validation

Status: public operator guide for a single-host Good Enough pilot.

This guide prepares a single-process Good Enough application and a loopback-only
llama-server router for local validation. It does not publish the service,
download models, install a process supervisor, or describe private host access.
Keep machine-specific paths, model filenames, credentials, SSH aliases, and
container commands in private operator notes.

## Pilot Decisions

- Good Enough admits one active generation globally.
- Authenticated overflow waits in the bounded, principal-aware process-local
  gateway queue.
- llama-server owns routing and autoload for an operator-maintained preset
  catalog.
- Every valid personal or demo API key may request every model in that catalog.
- Good Enough does not expose native model control, download, health, metrics,
  slots, or web UI routes.
- The backend remains bound to loopback. External clients reach Good Enough,
  never llama-server directly.
- Model downloading, application-owned model lifecycle, user-editable sampling
  defaults, simulation, administrator hardware telemetry, and active generation
  above one are deferred.

The browser demo discovers models through public `/v1/models`, so prime at least
one approved model before testing the UI. Native backend model responses can
contain filesystem paths and child arguments; keep those responses in the local
operator terminal and never publish them through Good Enough.

## Requirements

- An AMD Ryzen AI Max+ 395 or another host qualified for the selected model
  profile.
- Node.js 24 or newer.
- pnpm compatible with the committed lockfile.
- A qualified llama-server build and operator-owned preset catalog.
- Enough memory and storage for the selected model, context, KV slots, and
  backend scratch space.

Changing the model artifact, quantization, context, placement, slot count,
auxiliary model, speculative strategy, or backend build creates a different
operating profile. Record that profile in private operator notes.

## 1. Check Out And Verify

Use an authenticated workstation or the normal repository access method. Do not
copy a dirty worktree or private environment file to a host.

```bash
git clone https://github.com/altemd/good-enough.git good-enough
cd good-enough
git switch main
git pull --ff-only
git status --short
git rev-parse HEAD
pnpm install --frozen-lockfile
```

Run the complete repository gate before contacting a real backend:

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

The runtime test uses an isolated fake backend. Passing it verifies the built
gateway path but does not qualify the installed llama.cpp or ROCm runtime.

## 2. Start The Loopback Backend

Start llama-server through the host's qualified launcher. Substitute the
operator-owned preset path privately; do not put that path or the preset output
in this repository.

```bash
BACKEND_ROOT=/path/to/operator-owned/backend
MODEL_PRESET="$BACKEND_ROOT/models/config.ini"

cd "$BACKEND_ROOT"
llama-server \
  --host 127.0.0.1 \
  --port 8080 \
  --models-preset "$MODEL_PRESET" \
  --models-max 1 \
  --models-autoload \
  --no-ui
```

Keep the listener on `127.0.0.1`. Do not use `0.0.0.0`, a LAN address, or a
Tailscale address for llama-server.

Confirm the listener and inspect only the local model inventory:

```bash
ss -ltnp | grep ':8080'
curl --fail --silent --show-error http://127.0.0.1:8080/models
```

Use the exact approved model identifier reported by the local inventory. Native
model control endpoints are host operation, not public application endpoints.
Do not expose or paste their responses into public logs, issues, or chat.

Prime one approved model before browser testing:

```bash
curl --fail --silent --show-error \
  --request POST \
  --header 'content-type: application/json' \
  --data '{"model":"APPROVED_MODEL_ID"}' \
  http://127.0.0.1:8080/models/load
```

The immediate response is only an acknowledgement. Poll the local inventory
until the model is authoritatively `loaded`; stop if it becomes `unloaded` with
a failure indication or nonzero exit status.

## 3. Configure Good Enough

Create a disposable local environment with restrictive permissions:

```bash
umask 077
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
```

Put the generated bootstrap value in `.env`. For a first local test, use:

```dotenv
LLAMA_SERVER_URL=http://127.0.0.1:8080
GOOD_ENOUGH_DATABASE_PATH=./data/good-enough.sqlite
ACCOUNT_REGISTRATION_ENABLED=false
PUBLIC_DEMO_ENABLED=false
ACCOUNT_BOOTSTRAP_TOKEN=REPLACE_WITH_GENERATED_SECRET
APP_ORIGIN=http://localhost:3000
```

Keep `.env`, generated credentials, the SQLite database, and native backend
output out of Git and captured output. Remove `ACCOUNT_BOOTSTRAP_TOKEN` after
creating the first administrator and before the next restart.

Start the application on IPv4 loopback:

```bash
pnpm dev -- --host 127.0.0.1
```

Confirm it reports `http://localhost:3000` and does not take over a port owned
by an unrelated process.

For a remote host, use an authenticated private SSH tunnel appropriate to that
deployment. Do not add the host alias or private SSH command to this public
guide. Then open `http://localhost:3000/setup` in the workstation browser.

## 4. Verify Both Protocols

Create a display-once key from the signed-in account. Keep it in a task-specific
environment variable without writing it into shell history:

```bash
read -r -s -p 'Good Enough API key: ' GOOD_ENOUGH_API_KEY
export GOOD_ENOUGH_API_KEY
```

Discovery should list the approved model ID without native paths or child
arguments:

```bash
curl --fail --silent --show-error \
  --header "Authorization: Bearer $GOOD_ENOUGH_API_KEY" \
  http://127.0.0.1:3000/v1/models
```

Inspect this response before continuing. If it contains a filesystem path,
child-process argument, native control URL, or another operator-only field,
stop and record a sanitized discovery-response checkpoint. Do not work around
the problem by exposing another backend endpoint.

Send a short synthetic OpenAI request:

```bash
curl --fail --silent --show-error \
  --header "Authorization: Bearer $GOOD_ENOUGH_API_KEY" \
  --header 'content-type: application/json' \
  --data '{"model":"APPROVED_MODEL_ID","max_tokens":16,"messages":[{"role":"user","content":"Reply with the word ready."}]}' \
  http://127.0.0.1:3000/v1/chat/completions
```

Send the equivalent Anthropic request:

```bash
curl --fail --silent --show-error \
  --header "x-api-key: $GOOD_ENOUGH_API_KEY" \
  --header 'anthropic-version: 2023-06-01' \
  --header 'content-type: application/json' \
  --data '{"model":"APPROVED_MODEL_ID","max_tokens":16,"messages":[{"role":"user","content":"Reply with the word ready."}]}' \
  http://127.0.0.1:3000/v1/messages
```

Remove the key from the shell when finished:

```bash
unset GOOD_ENOUGH_API_KEY
```

Use only synthetic prompts during qualification. The application must not log
prompts, responses, reasoning, tool arguments, keys, cookies, or principal IDs.
Backend operator logs have a separate retention boundary and must not be
forwarded to users.

## 5. Verify The Personal Console

Open `/account/live-console` while signed in and repeat one personal-key
request. Verify:

- request start, admission, first output when available, and terminal lines;
- the visible request ID matches the response header;
- status, timing, token, throughput, and cache fields only appear when
  authoritative;
- no prompt or response content appears; and
- refreshing the page starts with an empty console.

## 6. Optional Demo Validation

Only after personal-key validation succeeds, enable the public demo for the
specific test, restart the application, and use the browser UI. Keep public
registration disabled unless registration is part of that test.

The demo uses the same curated model catalog and does not receive reserved
capacity or priority.

## 7. Stop And Inspect

Stop only processes started for this test. Then verify that project listeners
are gone and memory has recovered:

```bash
ss -ltnp | grep -E ':3000|:8080'
free -h
swapon --show
git status --short
```

The ignored `.env`, database, and build output may remain for the next local
test. Do not leave orphaned backend or application processes running.

## Production Transition

Production deployment is a separate checkpoint. Before installing a process
supervisor:

1. confirm the administrator exists and remove `ACCOUNT_BOOTSTRAP_TOKEN`;
2. keep `.env` at mode `600` with the exact public HTTPS `APP_ORIGIN`;
3. back up the SQLite database;
4. run the complete repository gate; and
5. build the committed checkout with `pnpm build`.

The repository includes project-owned checks and installers:

```bash
pnpm prod:amd:check
pnpm prod:amd:install
pnpm prod:amd:start
pnpm prod:amd:status
pnpm prod:amd:stop
```

Keep application and inference listeners on loopback throughout the transition.
Do not enable public backend control routes. Inspect durable operator logs only
through the host's private logging mechanism, and verify that they contain no
request content or credentials.

## Public Documentation Boundary

This public guide intentionally omits:

- private SSH aliases and tunnel commands;
- remote home, model, and project filesystem paths;
- machine-specific model filenames and qualification hashes;
- toolbox, container, and process-manager identities; and
- raw backend inventory, command output, prompts, and generated content.

Keep those details in private operator notes. If a command produces native
paths, child arguments, credentials, prompt content, or generated output, treat
the command output as private even when the command itself is safe to document.
