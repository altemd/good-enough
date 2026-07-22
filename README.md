Welcome to your new TanStack Start app! 

# Getting Started

To run this application:

```bash
pnpm install
pnpm dev
```

## Local inference gateway

The application exposes a deliberately small compatibility surface through one
gateway slice:

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/messages`

Requests are forwarded to `LLAMA_SERVER_URL`, which defaults to
`http://127.0.0.1:8080`. Only loopback llama-server URLs are accepted. Start
llama-server with one generation slot and keep it off the external network:

```bash
llama-server \
  --model /path/to/model.gguf \
  --host 127.0.0.1 \
  --port 8080 \
  --parallel 1
```

Good Enough requires Node 24 or newer. Copy `.env.example` to `.env` and replace
the synthetic bootstrap token. Do not commit the resulting `.env` file or real
credentials.
The gateway writes one structured metadata event per request to stdout. It does
not log prompt, completion, tool-argument, credential, principal, or raw
streaming data. Numeric metadata is extracted only from explicitly allowlisted
protocol fields. If external infrastructure captures stdout, those events are
retained operational telemetry and may be correlated with separate ingress
logs; this application does not currently impose a log-retention period.

### Accounts and personal API keys

The first administrator is created at `/setup` with the trusted
`ACCOUNT_BOOTSTRAP_TOKEN`. Public registration cannot race ahead of setup. Once
the administrator exists, registration is open by default and always creates a
`member`. Set `ACCOUNT_REGISTRATION_ENABLED=false` and restart to close new
registrations without affecting existing accounts.

Browser authentication uses usernames, passwords, and revocable database-backed
sessions. Session tokens are returned only through HttpOnly cookies, not
JavaScript-visible server-function results. Passwords use salted, versioned
scrypt hashes. There is no email, OAuth, MFA, or public password recovery. The
administrator may issue a display-once temporary member password; recovery of
the sole administrator requires host access through
`pnpm account:reset-admin -- <username>`. That host command deliberately prints
the temporary password once, so terminal scrollback and captured command output
must be treated as credential-bearing operator data.

Users create unnamed personal API keys in the dashboard. Each key is displayed
once, stored only as a digest plus non-secret prefix, and expires exactly seven
days after creation. Expiry does not slide with use. Lost, expired, or revoked
keys cannot be recovered or renewed. The dashboard shows only prefix, creation
date, expiry date, and active/expired/revoked state.

Drizzle ORM owns the SQLite schema and committed migrations through Node's
built-in `node:sqlite` driver. The database defaults to
`./data/good-enough.sqlite` and stores account, session, and key lifecycle state
only.

### Inference authentication

Every public `/v1/*` request requires an active, unexpired database-backed
personal API key or anonymous demo token.

OpenAI-compatible routes use Bearer authentication:

```bash
curl http://127.0.0.1:3000/v1/models \
  -H "Authorization: Bearer $GOOD_ENOUGH_API_KEY"
```

The Anthropic-compatible Messages route uses `x-api-key`:

```bash
curl http://127.0.0.1:3000/v1/messages \
  -H "x-api-key: $GOOD_ENOUGH_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  --data '{"model":"local-model","max_tokens":16,"messages":[]}'
```

Authentication runs before route rejection, backend configuration, request-body
streaming, and generation admission. Missing, malformed, and unknown
credentials receive the same generic `401`. OpenAI errors use
`invalid_request_error` with code `invalid_api_key`; Anthropic errors use
`authentication_error` with `request_id` and a `request-id` header. Credentials
are stripped before llama-server, and neither credentials nor principal IDs are
written to metadata.

A database or migration failure returns a sanitized `500`.

### Privacy boundary

Good Enough uses **zero inference-content retention**: it does not persist
prompts, responses, reasoning, tool arguments, request bodies, or per-user
inference activity. It does persist account records, password hashes, browser
sessions, API-key digests, prefixes, lifecycle dates, and revocation state. It
does not persist per-user request counts, token totals, model activity, TTFT,
throughput, usage dates, or key last-use timestamps. Clients may consume usage
returned in their own protocol responses without the service saving it to
their account. This is intentionally more precise than an ambiguous
absolute-ZDR claim.

### Instant one-hour anonymous API demo

The account feature exposes demo-key creation as a TanStack server function for
the same application UI, matching personal-key creation. It accepts only an
empty input object, uses the application's `APP_ORIGIN` CSRF policy, and returns
the display-once `apiKey`, `createdAt`, and `expiresAt` values with
`Cache-Control: no-store`. Its generated RPC transport is internal application
plumbing, not a supported public `/api/*` contract.

Creation is available only after an administrator has completed setup. Set
`PUBLIC_DEMO_ENABLED=false` and restart to stop new issuance without
invalidating tokens that have already been issued.

The service stores only a selector, digest, prefix, creation time, and expiry.
Tokens expire exactly one hour after the trusted server creation time and
cannot be renewed, recovered, extended, revoked, or converted into personal
keys. At most 25 unexpired demo tokens may exist. Separately, each Node process
accepts at most ten issuance attempts per ten minutes. Both overload cases
produce `429` server-function responses with a calculated `Retry-After`; the
process-local attempt limit resets on restart.

Demo tokens use the same OpenAI Bearer and Anthropic `x-api-key` contracts as
personal keys. They receive no reserved inference capacity, queue, priority, or
bypass, and authentication never records use or extends expiry. A copied token
works until its absolute expiry, so the browser must treat the one-time response
as a secret.

The public landing page exposes a prominent `Start one-hour demo` action. It
issues a credential only after an explicit user click, so crawlers, link
previews, and speculative browser loads do not consume demo credentials. The
complete value appears only in the creation result with copy and dismiss
actions. It remains in React page memory rather than a URL, cookie, local
storage, or session storage; refresh, navigation, or dismissal forgets it.

After issuance, the page uses the in-memory token to discover available models
and exposes a focused OpenAI-compatible streaming chat. The browser sends the
token only in the same-origin `Authorization` header. It incrementally renders
text and optional reasoning, supports cancellation, and maps authentication,
capacity, connection, and protocol failures to fixed messages without showing
upstream error bodies. Tool-call arguments are not rendered by this focused
chat.

The chat retains the complete page-lifetime conversation in React memory,
including assistant reasoning needed by compatible model templates. Each
assistant turn sends its `reasoning_content` back with later requests so the
conversation remains append-only and eligible for prefix-cache reuse. New user
prompts are limited to 4,000 characters, but the browser does not impose its own
message-count or conversation-size limit; llama-server remains authoritative
for the model context window. A visible new-conversation action, refresh,
navigation, or dismissing the token clears the chat. It does not use cookies,
URLs, local storage, session storage, or an application persistence endpoint
for the token or conversation. The service's normal content-free operational
metadata still applies; prompts and responses remain absent from application
stdout.

Without email, CAPTCHA, a durable device identity, or retained IP addresses,
the service cannot honestly enforce “one demo per person”; another explicit
request can obtain another token while capacity and the process-local issuance
limit permit it. Same-origin validation prevents browser-based cross-site
issuance but is not an identity or scripted-abuse boundary.

### Capacity behavior

OpenAI chat completions and Anthropic messages share one process-local
generation slot. While that slot is active, another generation request is
rejected immediately with a protocol-compatible `429` capacity error. The
OpenAI envelope uses the stable code `capacity_exceeded`; the Anthropic
envelope uses `rate_limit_error`. There is no waiting queue or `Retry-After`
header because the remaining generation time is unknown. `GET /v1/models`
remains available while a generation is active.

The slot is held until the proxied response body completes, fails, or is
cancelled. This includes time spent waiting for a slow client to read the
stream. Enforcement resets if the Node process restarts and does not coordinate
between multiple application processes. Those constraints match the initial
single-process deployment and `llama-server --parallel 1`.

Generation queueing is deliberately deferred. The initial OpenCode integration
relies on its retry of retryable `429` responses: its pinned AI SDK continues
consuming the parent provider stream while foreground tools run, so the parent
normally drains and releases the gateway lease while a foreground subagent
retries. Background or parallel subagents are unsupported while the gateway
permits only one active generation. Claude Code's closed-source HTTP and retry
behavior is not enough evidence to add a server queue.

Reconsider a bounded queue only if pilot evidence shows client retries are
inadequate or unfair, or when an authenticated capacity/queue UI is planned.
Until then there is no queue-size setting, queue timeout, queue metadata, or
promise that multiple pieces of work from one user can wait in parallel.
Revalidate the retry and stream-consumption assumptions whenever the pinned
OpenCode or AI SDK version changes.

Structured metadata distinguishes the status returned by the gateway from a
status received from llama-server:

- `responseStatus` is the HTTP status produced by the gateway.
- `upstreamStatus` is the llama-server status, or `null` if no upstream
  response existed.
- `authenticationStatus` records whether authentication succeeded, was
  rejected, or failed because trusted server configuration was invalid.
- `admissionStatus` records whether generation capacity was admitted, rejected,
  or not applicable.
- `activeGenerationsAtAdmission`, `queuedGenerationsAtAdmission`, and
  `concurrencyLimit` describe the admission snapshot. The queue count is always
  zero in this phase.

Therefore a local capacity rejection has `responseStatus: 429` and
`upstreamStatus: null`, while a `429` returned by llama-server populates both
status fields and is not labeled as an admission rejection.

### Protocol-compatible errors

Gateway-originated errors use the protocol bound to the public endpoint:

- `/v1/models`, `/v1/chat/completions`, and the unknown `/v1/*` catch-all use
  the OpenAI error envelope.
- `/v1/messages` uses Anthropic's top-level `type: "error"` envelope, nested
  error object, `request_id`, and `request-id` response header.
- The gateway-owned ID is consistent across each protocol's response header,
  Anthropic error bodies, upstream forwarding, and metadata. OpenAI responses
  use `x-request-id`; Anthropic responses use `request-id`.

Upstream error statuses, status text, and meaningful end-to-end headers remain
intact. Before gateway headers are sent, an upstream error body passes through
only when it is valid JSON and strictly conforms to the endpoint protocol. The
gateway reads at most 64 KiB for that check; malformed, oversized, bodyless, or
nonconforming errors receive a sanitized protocol fallback without exposing
unrecognized upstream fields.

If an upstream generation SSE body fails after streaming begins, the gateway
keeps already forwarded chunks unchanged, appends one protocol-specific
`event: error`, and closes the stream. Client cancellation does not append an
event because the downstream reader is already gone. Error translation never
adds prompts, completions, tool arguments, credentials, configuration details,
or upstream response bodies to metadata or stdout.

### TODO: configurable gateway active limit

Replace the fixed generation limit with trusted server configuration before
allowing concurrent inference:

- Add a positive-integer `INFERENCE_MAX_ACTIVE_GENERATIONS` setting with a
  default of `1`; clients must never be able to override it per request.
- Keep the limit global across OpenAI and Anthropic endpoints and across every
  model routed through the configured llama-server. A value of `1` therefore
  permits only one generation to use backend compute at a time even when
  several models or KV slots remain resident.
- Allow the gateway limit to be deliberately lower than llama-server's
  available parallel capacity. This supports multiple cached KV histories while
  serializing active work for exclusive per-request performance.
- Reject invalid configuration with a sanitized server error and never allow
  the configured limit to exceed verified aggregate backend capacity.
- Continue exposing the effective limit in admission metadata and the private
  status source. Test the default, invalid values, exact-boundary admission,
  cancellation, and lease release at limits greater than one.

### TODO: measured multi-slot slowdown reporting

Before increasing concurrency above one:

- Record the gateway active limit separately from each loaded model's
  llama-server parallel-slot capacity; they model different constraints and do
  not need to be equal.
- Use authenticated identity to add per-user fairness before describing load as
  “other users.” Until then, report “active generations.”
- Expose active and configured slot counts through a private dashboard status
  source. Add queued state only if the deferred queue is separately approved.
- Benchmark prompt processing and token generation separately at concurrency
  levels 1, 2, 3, and higher.
- Store measured ranges by hardware, model, quantization, context use, cache
  state, and concurrency.
- Report measured wording such as “Two other generations are active; local
  benchmarks estimate 30–40% of exclusive generation speed.” Never promise
  exact `1 / activeSlots` scaling because memory bandwidth, cache reuse, prompt
  processing, and sampling make it nonlinear.
- Distinguish total server throughput from each request's token rate. Treat
  subagents as concurrent requests, not automatically as different users or
  slots.

### TODO: ephemeral live inference console

Add a terminal-inspired, read-only activity panel that shows anonymous live
system state and ephemeral process-level aggregates without exposing a shell,
raw llama.cpp logs, process stdout, or user-linked inference activity:

- Deliver typed, privacy-filtered process aggregates through a private
  authenticated live source, likely SSE, with `Cache-Control: no-store`. Never
  route inference events by principal, include account/key identifiers, or
  reconstruct user histories.
- Do not persist, replay, expose a history endpoint, or use browser local
  storage. A page load or process restart begins without history.
- Show request lifecycle, status, duration, TTFT, prompt and generation
  throughput, input/output token counts, and cache reuse. Show context
  utilization only when both used tokens and effective capacity come from
  authoritative sources; never estimate it from text, bytes, or event counts.
- Show a compact anonymous hardware snapshot when supported: unified-memory
  use, GPU activity, temperature, and power. Render
  unavailable sensors as unavailable rather than zero. Reserve process memory,
  swap/zram, page pressure, device faults, clocks, and throttling details for
  administrators.
- Describe the panel as a privacy-filtered, ephemeral live inference console,
  not raw terminal output. Clearly and persistently distinguish real
  measurements from any future benchmark-driven simulation.
- Keep prompts, completions, reasoning, tool arguments, credentials, request
  bodies, raw SSE frames, filesystem paths, and raw llama.cpp, shell, and
  process output out of the event contract.
- Revisit the current production stdout recorder as part of this UI phase. The
  browser transport must not depend on stdout, and per-request stdout must be
  removed or governed by a separate explicit retention policy.
- Test absence of user linkage, empty state after refresh/restart, unsupported
  sensors, content exclusion, and unambiguous real-versus-simulated labeling.

### TODO: SSD-protected model loading

Before exposing model selection, loading, eviction, download, or cache
materialization:

- Accept only administrator-approved model IDs, never client-provided paths or
  URLs, and keep llama-server control endpoints private.
- Prevent generation requests from starting unrestricted downloads or model
  management operations.
- Serialize model transitions, deduplicate concurrent requests for the same
  unloaded model, and apply a global cooldown plus rolling load limit.
- Pin the active model long enough to prevent alternating-request load/evict
  thrashing. Reject excessive transitions with a sanitized `429`.
- Record transition attempts, duration, outcome, active model, and bytes read or
  written when available, without recording request content.
- Require an explicit administrative override for forced reloads.
- Regression-test alternating model requests so they cannot cause unbounded SSD
  reads, downloads, cache writes, or model churn.

The expected scheduling, model lifecycle, downloaded-model disclaimer, and
bounded saved-sampling-parameter surface are recorded in
[`docs/design/inference-scheduling-and-model-lifecycle.md`](docs/design/inference-scheduling-and-model-lifecycle.md).

### TODO: benchmark-driven simulation mode

Add a trusted server-enabled simulation backend and interactive demo for
development, product demonstrations, dashboard testing, and capacity planning:

- Let users explicitly opt into a clearly labeled demo experience with
  clickable synthetic prompts for chat, reasoning, tool use, and streaming.
  Enabling the feature remains trusted server configuration; an untrusted API
  request field must not switch real versus simulated inference.
- When real inference is busy, the UI may offer the simulation demo instead of
  only showing an overload error. Never silently convert a real request into a
  simulated response. Define the load signal before implementation rather than
  assuming that “more than five users” means signed-in users, active sessions,
  concurrent requests, or queued requests.
- Simulation must never contact llama-server or any external inference API.
- Preserve the allowed routes and streaming formats, but return deterministic
  canned content rather than pretending to perform meaningful inference.
- Use versioned benchmark profiles keyed by hardware, model, quantization,
  context size, cache state, and active concurrency.
- Schedule prompt processing, TTFT, generation chunks, cache reuse, and
  nonlinear multi-slot slowdown separately. Allow configured synthetic token
  counts when accurate tokenization is unavailable.
- Mark every response and metadata event unambiguously with a response header
  and `simulated: true`. Show persistent simulation disclaimers before, during,
  and after the demo response, including that no model or inference API was
  contacted and that displayed speed is simulated from benchmark data.
- Support deterministic seeded completion, cancellation, overload, slow
  generation, and backend-failure scenarios.
- Do not retain user-entered demo prompts. Keep simulated values separate from
  ephemeral real process aggregates and regression-test that it cannot fall
  through to llama-server, contact an external API, or be mistaken for real
  inference.

# Building For Production

To build this application for production:

```bash
pnpm build
```

## Testing

This project uses [Vitest](https://vitest.dev/) for testing. You can run the tests with:

```bash
pnpm test
```

The built-server regression harness compiles the production application, starts
an isolated loopback fake llama-server, migrates a temporary SQLite database,
and checks personal-key authentication, key/account rejection, routing, shared
capacity, stream cancellation, release paths, request IDs, metadata cardinality,
and log privacy:

```bash
pnpm test:runtime
```

Keep this separate from `pnpm test`: it intentionally pays the cost of a full
Nitro build and child-process lifecycle.

## Styling

This project uses [Tailwind CSS](https://tailwindcss.com/) for styling.

### Removing Tailwind CSS

If you prefer not to use Tailwind CSS:

1. Remove the demo pages in `src/routes/demo/`
2. Replace the Tailwind import in `src/styles.css` with your own styles
3. Remove `tailwindcss()` from the plugins array in `vite.config.ts`
4. Uninstall the packages: `pnpm add @tailwindcss/vite tailwindcss --dev`

## Linting & Formatting

This project uses [Biome](https://biomejs.dev/) for linting and formatting. The following scripts are available:


```bash
pnpm lint
pnpm format
pnpm check
pnpm typecheck
```


## Deploy with Nitro

This project uses Nitro as a generic server adapter, so it can run on any Node-compatible host.

```bash
pnpm build
node .output/server/index.mjs
```

The build output is a self-contained Node server. To deploy, copy the `.output/` directory to your host and run the server command above.

For host-specific presets (Vercel, Netlify, Cloudflare, AWS Lambda, etc.) and tuning, see https://v3.nitro.build/deploy.



## Routing

This project uses [TanStack Router](https://tanstack.com/router) with file-based routing. Routes are managed as files in `src/routes`.

### Adding A Route

To add a new route to your application just add a new file in the `./src/routes` directory.

TanStack will automatically generate the content of the route file for you.

Now that you have two routes you can use a `Link` component to navigate between them.

### Adding Links

To use SPA (Single Page Application) navigation you will need to import the `Link` component from `@tanstack/react-router`.

```tsx
import { Link } from "@tanstack/react-router";
```

Then anywhere in your JSX you can use it like so:

```tsx
<Link to="/about">About</Link>
```

This will create a link that will navigate to the `/about` route.

More information on the `Link` component can be found in the [Link documentation](https://tanstack.com/router/v1/docs/framework/react/api/router/linkComponent).

### Using A Layout

In the File Based Routing setup the layout is located in `src/routes/__root.tsx`. Anything you add to the root route will appear in all the routes. The route content will appear in the JSX where you render `{children}` in the `shellComponent`.

Here is an example layout that includes a header:

```tsx
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'My App' },
    ],
  }),
  shellComponent: ({ children }) => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <header>
          <nav>
            <Link to="/">Home</Link>
            <Link to="/about">About</Link>
          </nav>
        </header>
        {children}
        <Scripts />
      </body>
    </html>
  ),
})
```

More information on layouts can be found in the [Layouts documentation](https://tanstack.com/router/latest/docs/framework/react/guide/routing-concepts#layouts).

## Server Functions

TanStack Start provides server functions that allow you to write server-side code that seamlessly integrates with your client components.

```tsx
import { createServerFn } from '@tanstack/react-start'

const getServerTime = createServerFn({
  method: 'GET',
}).handler(async () => {
  return new Date().toISOString()
})

// Use in a component
function MyComponent() {
  const [time, setTime] = useState('')
  
  useEffect(() => {
    getServerTime().then(setTime)
  }, [])
  
  return <div>Server time: {time}</div>
}
```

## API Routes

You can create API routes by using the `server` property in your route definitions:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const Route = createFileRoute('/api/hello')({
  server: {
    handlers: {
      GET: () => json({ message: 'Hello, World!' }),
    },
  },
})
```

## Data Fetching

There are multiple ways to fetch data in your application. You can use TanStack Query to fetch data from a server. But you can also use the `loader` functionality built into TanStack Router to load the data for a route before it's rendered.

For example:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/people')({
  loader: async () => {
    const response = await fetch('https://swapi.dev/api/people')
    return response.json()
  },
  component: PeopleComponent,
})

function PeopleComponent() {
  const data = Route.useLoaderData()
  return (
    <ul>
      {data.results.map((person) => (
        <li key={person.name}>{person.name}</li>
      ))}
    </ul>
  )
}
```

Loaders simplify your data fetching logic dramatically. Check out more information in the [Loader documentation](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#loader-parameters).

# Demo files

Files prefixed with `demo` can be safely deleted. They are there to provide a starting point for you to play around with the features you've installed.

# Learn More

You can learn more about all of the offerings from TanStack in the [TanStack documentation](https://tanstack.com).

For TanStack Start specific documentation, visit [TanStack Start](https://tanstack.com/start).
