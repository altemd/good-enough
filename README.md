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

Copy `.env.example` to `.env` and replace its synthetic API key before starting
the gateway. Do not commit the resulting `.env` file or a real credential.
The gateway writes one structured metadata event per request to stdout. It does
not log prompt, completion, tool-argument, credential, or raw streaming data.
Numeric metadata is extracted only from explicitly allowlisted protocol fields;
other numbers in an API response are ignored.

### Pilot authentication

Every public `/v1/*` request requires a statically configured pilot API key.
`INFERENCE_API_KEYS` is a JSON array mapping stable, non-secret principal IDs to
keys:

```dotenv
INFERENCE_API_KEYS=[{"id":"pilot-user","key":"replace-with-a-random-32-byte-secret"}]
```

Keys must be unique, contain no whitespace, and be between 32 and 256 UTF-8
bytes. Principal IDs must be unique, start with a letter or number, and contain
only letters, numbers, underscores, or hyphens. Missing or invalid
configuration fails closed with a sanitized `500`.

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

This is deliberately limited pilot configuration: keys remain in the process
environment, and rotation or revocation requires changing the environment and
restarting the application. Sign-in, persistent hashed keys, display-once key
creation, and self-service revocation remain deferred.

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
- Expose active, queued, and configured slot counts through a private dashboard
  status source.
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
- Do not retain user-entered demo prompts. Keep simulated usage separate from
  real usage counters and regression-test that it cannot fall through to
  llama-server, contact an external API, or be mistaken for real inference.

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
an isolated loopback fake llama-server, and checks authentication, routing,
shared capacity, stream cancellation, release paths, request IDs, metadata
cardinality, and log privacy:

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
