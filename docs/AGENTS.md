# docs

Repo-wide invariants, commands, and the directory map: `../AGENTS.md`.

Long-form decisions, evidence, and operations references. Each document states
its own **Status** up top; respect it.

## Kinds

| Path | Kind | Rule |
| --- | --- | --- |
| `docs/design/` | Product and architecture decision records | These are the **product contract**: `inference-scheduling-and-model-lifecycle.md` (admission/queue, model residency, deferrals) and `live-inference-console.md` (the console's privacy and runtime contract). Keep them accurate to implemented behavior. When behavior changes, update the design doc in the same checkpoint. They are contracts, not benchmarks. |
| `docs/operations/` | Public operator guide | `amd-pilot-host-setup.md` is the single-host pilot setup and first-validation guide. It is **public**: no machine-specific secrets, credentials, SSH aliases, or private container commands. Keep it copy-paste-runnable. |
| `docs/research/` | Research notes | Time-stamped investigations that inform, but do not gate, work (e.g. `opencode-subagents-and-gateway-queueing.md`). A research note can be **superseded**; record the supersession in its header rather than deleting it. |
| `docs/diagnosis/` | Temporary diagnosis | Scratch investigation notes. May remain uncommitted. Promote a durable conclusion into `design/` or `research/` and then drop or archive the diagnosis. |

## Invariants

- **Status headers are binding.** "research note", "product contract", "public
  operator guide", "temporary diagnosis" each carry different obligations.
  Don't silently promote a research claim into product behavior.
- **Design docs are contracts, not evidence.** They record decided behavior.
  Measured results and unfinished experiments are not asserted here as
  implemented behavior. If a design doc references a path that no longer
  exists (a deleted benchmark or research file), fix the reference or note the
  gap — do not leave dangling links.
- **Supersede, don't delete, superseded decisions.** When a decision is
  reversed (e.g. queueing going from deferred to implemented), leave a
  "superseded" marker and a pointer to the new source of truth.
- **Public docs stay sanitized.** Nothing in `docs/operations/` may contain a
  real credential, key, host-specific secret, or private command. Machine
  specifics go in private operator notes.
- **Update on evidence.** New hardware or runtime evidence that changes a
  conclusion is recorded where that conclusion lives (usually `design/`), not
  buried in code comments.
