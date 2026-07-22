# Inference scheduling and model lifecycle

Status: implemented product contract; existing benchmark evidence informs
operations but does not gate unrelated application phases

This document records the expected behavior of the inference service. It is a
product and architecture decision record, not benchmark evidence. Measured
results live under `benchmarks/results`, while unfinished experiments live in
`docs/research/hardware-benchmark-plan.md`.

## Product principle

The service is an optimized, opinionated demonstration of local inference. Its
default policy maximizes performance for the request currently using the
hardware rather than maximizing aggregate throughput or exposing every
llama.cpp option.

The initial invariant is therefore:

- one generation uses backend compute at a time across all users and models;
- a loaded model may retain several non-unified KV slots for conversation
  reuse;
- idle slots do not reserve a fixed share of compute;
- authenticated overflow waits in the bounded, principal-aware gateway queue;
  and
- concurrent generation is a trusted operator opt-in, not a client option.

## MVP router ownership and deferrals

The AMD pilot delegates curated model routing and autoload to llama-server. The
host operator owns the live preset catalog at `/mnt/bridge/models/config.ini`.
The router starts with `--models-max 2` and autoload enabled. The limit controls
resident children, not the number of curated model choices. Good Enough
forwards the authenticated request body unchanged, so every valid personal or
demo API key may request every model in that trusted catalog. There is no
per-credential model allowlist.

Good Enough does not expose llama-server's native `/models`, `/models/load`,
`/models/unload`, download, deletion, health, metric, slot, or web UI endpoints.
An operator may use the model endpoints locally to prime approved presets and
inspect authoritative load state. This is host operation rather than an
application-owned model lifecycle.

The browser demo discovers models through public `/v1/models`, so at least one
curated model must already be loaded before the demo can select it. The pilot
startup procedure primes both qualified Qwen presets. Autoload remains enabled
for later requests, reloads, and any approved model that is not resident.

The following phases are deferred until a separate product decision or pilot
evidence reopens them:

- application-owned loading, unloading, eviction, and transition state;
- model downloads, deletion, expiry, quotas, and SSD lifecycle;
- user-editable saved sampling defaults and gateway request rewriting;
- simulation mode and administrator hardware telemetry;
- configurable or parallel active generation above the fixed global limit of
  one.

Curated process and sampling defaults remain trusted llama-server preset-file
configuration. Good Enough does not read or rewrite that file. Generic
speculative decoding may remain a trusted router flag, but MTP is
model-specific preset configuration; a global `--spec-type draft-mtp` must not
be treated as an automatic capability probe for a mixed catalog.

The clone, router startup, local model priming, and first end-to-end validation
procedure is recorded in
[`docs/operations/amd-pilot-host-setup.md`](../operations/amd-pilot-host-setup.md).

One future server setting may describe active capacity:

```text
INFERENCE_MAX_ACTIVE_GENERATIONS=1
```

Increasing the active limit above `1` permits parallel generation only after
the selected model has at least that many slots and the configuration has been
qualified on the hardware. Clients cannot override it.

## Slot behavior and bounded queueing

`llama-server --parallel N` is model-process capacity. The gateway active limit
is product scheduling policy. They deliberately do not have to be equal.

For an approved single resident model, the leading configuration is three
non-unified KV slots with one global active generation. This allows three
conversation histories to remain reusable while the active request receives
exclusive compute. Each model architecture still requires its own cache,
memory, and stability qualification.

Changing `--parallel` requires restarting or reloading the model child. That
destroys the process's retained KV histories. The application must not
automatically change a live model from two to three slots merely because a new
user arrives. It should instead select the intended slot profile when loading
the model. A later reconfiguration may run only when the model is idle and the
cache loss is explicit.

Good Enough owns scheduling before forwarding a request body. One generation
remains active globally. Each authenticated principal has a FIFO waiting queue,
and released capacity rotates between principals. The default limits are 8
waiting requests per principal, 64 globally, and a 600-second wait deadline.
Trusted environment settings may change those positive-integer values.

Queue-bound and deadline failures use protocol-compatible `429` responses.
Cancellation removes a waiter without forwarding or reading its body. The
queue is process-local and disappears on restart. A queued request has no HTTP
response headers yet, so client response-header timeouts must exceed the queue
deadline when the full wait is desired. The private live console reports
content-free queue counts and wait timing, but not an unstable queue position.

## Expected user and model scenarios

### Current router-autoload scenarios

#### One loaded model

1. Two users select the same loaded model. One request runs and the other waits
   for the next gateway lease. Both histories may remain in separate KV slots.
2. Three users select a model loaded with three slots. One runs and the other
   requests wait; the service does not claim that the active request runs at
   one-third speed.
3. A third history arrives at a process with only two slots. llama.cpp may
   replace an idle slot. The application does not reload the process to add a
   slot while histories are live. When the model is the only resident model,
   prefer loading its already-qualified three-slot profile from the start.
4. An operator raises the active-generation limit. Requests may run in
   parallel up to both the gateway limit and the model's slot capacity. The UI
   reports measured per-request slowdown ranges rather than reciprocal-speed
   promises.

#### Several loaded models

5. Two users select two already-loaded models. The same global active limit
   applies across both child processes, so the second generation receives
   `429` even though its model has an idle slot. Idle-model residency must be
   qualified before it is described as performance-free on unified memory.
### Deferred application-owned lifecycle scenarios

The remaining scenarios describe a possible future application control plane,
not current pilot behavior:

6. A user selects an unloaded model while another model is generating. The
   model transition waits for generation idleness. The existing generation is
   neither preempted nor forced to compete with loading work.
7. Several users select the same unloaded model. The application starts one
   load operation and all requesters observe the same state. It must subscribe
   to llama.cpp `/models/sse` and reconcile with `GET /models`, including after
   an application restart. A local promise alone is not authoritative.
8. Loading a model would exceed the configured resident-model count. Never
   evict an active model. After compute becomes idle, evict an eligible idle
   model using LRU plus pinning and fairness rules.
9. Native loading fails. Optimized presets do not silently shrink context or
   change placement. The application may unload one known-idle model and retry
   once when policy permits; otherwise it returns a sanitized `503` with
   `model_load_failed`. Raw paths, child logs, and allocation details remain
   private.

#### Deferred user-downloaded models

10. Downloading a GGUF does not test or load it. A load begins only because the
    user selects **Use model** or starts a session that explicitly selects it.
    Disable uncoordinated router autoload so inference cannot secretly start a
    model transition outside the application state machine.
11. Concurrent requests for the same Hugging Face artifact share one native
    download and one physical cache entry. User-visible references may be
    separate, but deleting one reference must not remove a file still in use.
12. Expiration never removes a model that is loading, loaded, active, or pinned
    by a live session. Only an eligible idle artifact may be deleted.
    The initial retention window is one or two days and should be configurable.
13. Download network and disk activity may overlap generation. This is an
    accepted product policy and is not blocked on a performance benchmark.
    Model loading, unloading, and cache materialization remain separate
    transitions that may require the compute system to be idle.
14. Concurrent generation uses the existing bounded gateway queue. Do not add
    a second queue merely to coordinate model selection; model-transition
    scheduling remains a separate responsibility.

## Optimized presets versus downloaded GGUFs

Built-in models are curated profiles. A profile may include an exact model and
quantization, full context, slot count, non-unified KV, cache policy, mmproj,
reasoning behavior, sampler defaults, MTP or a compatible draft model,
speculative mode, and measured performance metadata. Use explicit placement
and `--fit off` so the tested profile either loads as qualified or fails.

Downloaded GGUFs use a generic profile:

- one non-unified slot;
- explicit `--ctx-size 0`, requesting the context recorded by the model;
- `--fit on`, with GPU-layer placement left unset so native fitting may choose
  a slower placement without reducing the explicitly requested full context;
- prompt caching enabled, host cache disabled with `--cache-ram 0`; and
- no automatically discovered MTP, draft model, mmproj, speculative mode, or
  architecture-specific tuning.

Native load status is authoritative. The application does not add model-size
estimates and reject a load as if that estimate were certain. It still needs a
low-memory emergency circuit breaker because the operating system can enter
severe pressure before a failed child exits.

The user-visible disclaimer should say:

> Downloaded GGUF models use a generic full-context configuration. They may be
> substantially slower than the built-in models because model-specific
> optimizations—such as MTP or speculative decoding, auxiliary draft/projector
> models, tuned sampling, and validated KV settings—are not automatically
> configured. Loading may use slower placement or fail if the complete model
> and context do not fit.

## Deferred saved sampling parameters

Users may save a small set of model-recommended sampling defaults for a
downloaded model only if this phase is later approved. For the current pilot,
the host operator records curated defaults in the llama-server preset file.
Future application-managed values would affect token selection, not process
layout or resource capacity. The proposed allowlist is:

| Parameter | Initial validation | Notes |
|---|---:|---|
| `temperature` | finite number, 0 through 1 | Common to OpenAI- and Anthropic-style requests; 0 is greedy |
| `top_p` | finite number, 0 through 1 | Common nucleus-sampling control |
| `top_k` | integer, 0 through 1000 | Supported by llama.cpp and Anthropic; an OpenAI extension |
| `min_p` | finite number, 0 through 1 | llama.cpp extension |
| `repeat_penalty` | finite number, 0 through 2 | llama.cpp extension; 1 disables the penalty |

Rules:

- store typed numeric fields, never an arbitrary argument string;
- reject unknown fields, non-finite values, and values outside the application
  bounds before contacting llama.cpp;
- show the model's saved value, llama.cpp default, and reset-to-default action;
- an explicit API request value overrides the saved model default;
- record only which parameter names were overridden, not prompts or generated
  content;
- do not expose sampler order, logit bias, grammars, arbitrary templates,
  context controls, batch sizes, GPU placement, KV settings, MTP, draft-model
  paths, or speculative controls in this simple settings surface; and
- preserve protocol behavior: unsupported extension fields require documented
  llama.cpp compatibility and must not be represented as standard OpenAI or
  Anthropic fields.

Applying saved defaults will require a later gateway checkpoint because the
current transport intentionally forwards request bodies byte-for-byte. That
checkpoint must use bounded JSON parsing, preserve streaming and cancellation,
avoid logging request content, and cover precedence and protocol translation
with privacy tests.

## Qualification evidence and optional follow-ups

The controlled 2026-07-17 Qwen qualification found no meaningful exclusive
speed difference between one and three full-context non-unified slots. Three
independent reasoning histories also resumed with at least 99.9863% of the
prior reported total reused. That is sufficient to adopt the three-slot,
one-active Qwen candidate for continued application development.

The minimal two-model follow-up then loaded the two surviving Qwen presets as
separate one-slot, full-context processes in both orders. Across a small
repeated sample, the largest absolute median PP or TG change with the other
model idle was 1.092%, corresponding outputs matched, about 40.4-40.7 GiB
remained available, and zram did not grow. This supports keeping both tested
Qwen presets resident in that one-full-context-slot-per-model profile while the
gateway admits one global active generation. It does not qualify giving both
resident models three slots, concurrent cross-model generation, or automatic
fitting.

The remaining hardware questions are optional, risk-driven follow-ups rather
than prerequisites for account lifecycle or a fixed application phase:

- **Completed application-development residency gate:** the one-active,
  two-Qwen, both-load-orders comparison above found no material exclusive-speed
  penalty. Populated idle histories, more resident models, concurrent
  cross-model generation, and long-running router endurance remain separate
  questions rather than blockers for the next application slice.
- **If near-limit context behavior becomes a reported risk:** run an append-only
  continuation to inspect long-prompt processing, checkpoint/state overhead,
  context shifting or truncation, slot selection, cache reuse near the limit,
  and recovery after cancellation.
- **If reliability evidence warrants it:** run a bounded soak or repeated
  cancellation to look for progressive ROCm/backend state failures and native
  slot cleanup problems. These probes may reveal useful failures, but their
  absence is not required before continuing application development.
- **When downloaded-model loading is implemented:** verify the generic
  full-context `--ctx-size 0 --fit on` profile alone and with another resident
  model. It need not block the next gateway phase.
- **When native model lifecycle orchestration is implemented:** verify that
  `POST /models/load` is treated only as an acknowledgement. Force a safe
  missing-file child failure, observe the later `unloaded`/`failed`/nonzero
  `exit_code` state, and ensure the application reports a sanitized terminal
  error rather than declaring the model loaded.
- **Only if refreshed Gemma becomes an approved built-in preset and evidence is
  useful:** measure its current artifact and operating profile. Old-artifact
  measurements should be labeled historical rather than treated as a blocker.
