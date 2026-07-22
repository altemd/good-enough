# OpenCode subagents, tool-call boundaries, and gateway queueing

Status: research note; the deferral below was superseded on 2026-07-22 by the
implemented bounded gateway queue

Date: 2026-07-18

## Question

When a model used through OpenCode calls a subagent, when does the current
generation stop, when does the subagent's generation start, and what useful
work would a Good Enough gateway queue perform while the active-generation
limit remains one?

## Short answer

A subagent is not part of one continuous llama.cpp generation. The parent
model first generates a structured call to OpenCode's `task` tool. That model
generation ends as a provider response with a tool-call finish reason. OpenCode
executes the tool, creates or resumes a child session, and the child session
sends a separate inference HTTP request. After a foreground child finishes,
OpenCode can send another separate parent inference request containing the tool
result.

Good Enough does not know that these requests are related. It owns capacity at
the HTTP transport boundary: one lease is held until the corresponding
upstream response body completes, fails, or is cancelled. It does not release
capacity merely because a tool-call JSON object appears in an SSE chunk.

There can nevertheless be a short overlap at the request boundary. OpenCode
uses the Vercel AI SDK, which automatically invokes a tool's `execute` function
when a complete tool call is generated. The `task` tool can therefore begin
the child session while the parent provider stream is still delivering its
terminal finish, usage, or `[DONE]` events. If the child request reaches Good
Enough before the parent body closes, an immediate-rejection gateway returns
`429`.

At the time of this research, the pinned OpenCode client treated retryable
`429` responses as transient and
retries with exponential backoff while the AI SDK continues consuming the
parent provider stream. The parent therefore normally drains and releases the
lease while the foreground child starts and retries. This is sufficient for
the then-current foreground-subagent target. A server queue was deferred because it
would add cancellation, timeout, fairness, connection-lifetime, and restart
contracts without demonstrated pilot need or queue-aware UI feedback.

## Runtime ownership

The system has three independent owners:

1. **The model and llama.cpp** produce tokens and decide, through model output,
   stop tokens, and tool-call formatting, when the provider generation ends.
2. **OpenCode and the AI SDK** interpret the structured tool call, execute the
   `task` tool, create the child session, and decide whether work is foreground
   or experimental background work.
3. **Good Enough** authenticates and proxies each inference request. Its
   admission lease follows the upstream HTTP response lifecycle, not
   OpenCode's session or tool lifecycle.

This distinction prevents two misleading mental models:

- A subagent is not an operation running inside the parent llama.cpp request.
- The appearance of tool-call text is not a safe gateway signal that all
  upstream decoding and response delivery has completed.

## Detailed foreground-subagent sequence

The normal foreground flow is:

```text
OpenCode parent session
  -> HTTP generation request A
  -> Good Enough acquires the only active lease
  -> llama-server generates a tool call to `task`
  -> AI SDK validates the completed tool-call arguments
  -> AI SDK invokes OpenCode's TaskTool.execute(...)
  -> TaskTool creates/resumes a child OpenCode session
  -> child session sends HTTP generation request B
  -> request A's upstream body closes and Good Enough releases its lease
  -> request B is admitted on its initial attempt or a retry
  -> child session runs its own model/tool loop
  -> foreground TaskTool returns the child result
  -> OpenCode may send parent HTTP generation request C with that tool result
```

Requests A, B, and C are distinct inference requests with distinct request IDs,
metadata events, response streams, and admission decisions.

The ordering between “TaskTool starts B” and “A's body closes” is the important
race. Source establishes that the AI SDK executes tools automatically when
calls are generated and that OpenCode's `task` tool calls the child prompt
operation. Source alone does not prove the exact byte-level ordering for every
AI SDK/provider/llama.cpp version. If pilot failures emerge, a focused runtime
trace could establish how often B precedes A's terminal body completion.

## Does the active generation end when tool-call text ends?

Not at the Good Enough boundary.

For the current gateway, the active lease ends when the upstream response body
finishes, fails, or is cancelled. The gateway deliberately does not parse the
request body and its metadata observer does not control admission. Treating a
parsed tool-call event as lease release would be unsafe because:

- more upstream bytes can follow, including terminal usage and protocol events;
- malformed or partial tool arguments may still fail parsing;
- a model can emit tool-like text that is not a recognized tool call;
- response parsing differs between OpenAI and Anthropic formats; and
- releasing before llama-server has actually finished could permit real
  overlapping generation while the configured active limit is one.

The correct invariant remains transport-based release. Client retry bridges the
current OpenCode tool-scheduling race without weakening that invariant.

## What is model- and template-dependent?

Tool-call recognition is model- and template-dependent.

llama.cpp documents that OpenAI-style function calling requires a tool-aware
Jinja chat template. Native handlers exist for several model families, while a
generic handler is a fallback. Models use different tool-call syntax, control
tokens, reasoning formats, and end-of-turn tokens. A compatible combination
must:

- present the tool schema in the form expected by the model;
- induce the model to choose the tool rather than describe a call as prose;
- generate complete, valid arguments;
- let llama.cpp parse those tokens into protocol `tool_calls` or Anthropic tool
  blocks; and
- terminate the provider generation with a compatible finish reason.

Consequently, the reliability and exact token at which a tool call becomes
recognizable vary by model artifact, chat template, and llama.cpp parser. A
poor combination may produce prose, malformed JSON, incomplete arguments, or a
normal stop instead of a usable tool call.

Once llama-server has produced a valid provider response, however, Good
Enough's lease semantics are not model-dependent. Every model uses the same
response-body completion rule.

## What is OpenCode-dependent?

The existence and scheduling of a subagent are primarily OpenCode behavior.

Current OpenCode source shows that:

- `streamText` receives executable OpenCode tools and an abort signal;
- the AI SDK owns provider streaming and automatic tool dispatch;
- `TaskTool` creates or resumes a child session and invokes the child prompt;
- foreground task execution waits for the child result or cancellation;
- background subagents are experimental, return immediately, and can continue
  independently; and
- the parent prompt loop sends separate model calls as it continues through
  tool results and later assistant steps.

A different client could wait for the entire provider stream to close before
executing tools, execute tool calls serially, execute multiple calls in
parallel, or not support subagents at all. Good Enough must therefore avoid
encoding OpenCode-specific session assumptions into its generic API transport.

## Background and multiple subagents

Foreground does not mean that all traffic is globally sequential. Several
cases can create competing requests:

- a model emits multiple tool calls and the client executes them concurrently;
- experimental OpenCode background subagents continue after their tool call
  returns to the parent;
- separate OpenCode sessions use the same or different API keys;
- several users submit requests concurrently; or
- a parent continues after starting background work.

With one global active generation, Good Enough rejects competing generation
requests with `429` regardless of how many llama.cpp KV slots or model
processes are resident. Compatible foreground clients may retry. Background or
parallel subagents remain unsupported while the active-generation limit is one.

## What could justify reconsidering queueing

A future bounded queue could have four defensible purposes:

1. **Parent-to-child handoff.** It absorbs the short interval in which
   OpenCode starts a child request before the parent response body has released
   the lease.
2. **Tool-result continuation handoff.** It can similarly absorb timing between
   the end of one agentic step and the next provider request without asking the
   client to retry.
3. **Small cross-user bursts.** It preserves FIFO order for a few authenticated
   users who arrive while one generation is active.
4. **Backpressure and fairness.** A global bound plus one waiter per principal
   prevents unbounded connections and one user or subagent swarm from owning
   all future capacity.

Queueing could also avoid immediate `429` retry churn. Current OpenCode retries
are adequate for the supported foreground flow, so this benefit is not enough
to justify implementation by itself.

## What queueing does not solve

Queueing does not:

- make llama.cpp generate concurrently;
- make parallel OpenCode subagents supported;
- give OpenCode a queue position or estimated start time;
- prevent client, ingress, or network timeouts while waiting for headers;
- guarantee fairness across processes, because state is process-local;
- make a silent wait good API user experience; or
- replace hardware qualification before raising active concurrency above one.

For OpenCode, a queued request is simply a pending provider request. Its
provider `headerTimeout` and total `timeout`, when configured, include the
queue wait because Good Enough has not returned response headers. Its SSE chunk
timeout applies only after a streaming response exists. A separate Good Enough
chat UI could show queue state, but that would not make the standard OpenCode
client queue-aware.

## Superseded product decision

The original decision was to preserve immediate protocol-compatible `429`
rejection. Live `llama.cpp -np 1` testing later confirmed that an overlapping
request waits without preempting the active stream, and the observed OpenCode
title-request overlap justified moving that waiting boundary into Good Enough.
The implemented policy keeps one active generation, bounded principal-aware
waiting, cancellation, a maximum wait, and privacy-safe queue telemetry.

Revalidate client header-timeout behavior whenever the pinned OpenCode or AI
SDK version changes because queued requests have not received response headers.

## Evidence that could reopen the decision

If observed failures justify reconsideration, use a content-free timing probe
with the deployed OpenCode, AI SDK, Good Enough, and llama.cpp versions:

1. Run one synthetic OpenCode prompt that deterministically calls a foreground
   subagent.
2. Record only request IDs and monotonic timestamps for parent upstream-body
   completion, child request arrival, admission decision, and child start.
3. Repeat across the relevant model/chat-template profiles when useful.
4. Test a normal tool, a foreground subagent, multiple tool calls, and an
   experimental background subagent separately.
5. Confirm cancellation propagates from OpenCode to a waiting child.

This test would determine whether retry exhaustion, handoff latency, or
cross-user unfairness is significant enough to justify a new queue product
contract. It must not store prompts, generated text, tool arguments, or
principal IDs.

## Sources

- [Good Enough admission controller](../../src/features/inference-gateway/admission.ts)
- [Good Enough proxy lifecycle](../../src/features/inference-gateway/proxy-stream.ts)
- [OpenCode TaskTool source](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/task.ts)
- [OpenCode LLM streaming source](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/llm.ts)
- [OpenCode prompt loop source](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/prompt.ts)
- [OpenCode processor source](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/processor.ts)
- [Vercel AI SDK tool-calling documentation](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [Vercel AI SDK `streamText` reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)
- [llama.cpp function-calling documentation](https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md)
- [llama-server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
