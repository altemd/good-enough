# config

Repo-wide invariants, commands, and the directory map: `../AGENTS.md`.

Operational configuration kept alongside the repository. This directory is
currently empty (git does not track empty directories).

## What belongs here

The intended home for an editable, LF-normalized review copy of the operator's
llama-server router preset. The **live** preset on the AMD host is
`/mnt/bridge/models/config.ini` and that host file is authoritative. A copy
committed under `config/llama-server/` is for review and diffing only and must
be kept in sync with the host file when it changes.

## Invariants

- The application does not own the model catalog. llama-server's router owns
  curated model routing and autoload, and the host operator owns the live
  preset file. Do not build an application-owned model catalog or sampling
  store here.
- Keep any preset copy loopback-safe: no hostnames other than `127.0.0.1`
  (or `localhost`), no credentials, no machine-specific paths that would leak
  when committed.
- When validating a model profile, run the actual preset, not a summary of the
  filename, and record the effective flags in the operations documentation.
