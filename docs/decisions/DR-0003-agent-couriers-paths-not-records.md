---
id: DR-0003
status: accepted
dateCreated: 2026-08-01
domain: job-alert-harvester
changelog:
  - date: 2026-08-01
    version: 0.1.0
    note: Arose from two observed data corruptions during the 2026-08-01 session
  - date: 2026-08-03
    version: 1.0.0
    note: Accepted after review

---

# The agent couriers paths and control values, never records

## Context

The Gmail credential lives in a Claude Code connector. The connector is available to an agent
session and not to a Node process. Everything deterministic — parsing, dedup, merge — lives in the
CLI, which has no connector. So the two halves of the system are separated by an agent.

That separation was crossed by hand twice on 2026-08-01, and it corrupted the output both times:

| Incident | Mechanism | Detectability |
|---|---|---|
| Mangled base64 | agent re-typed an encoded body into a file | none until parse failed downstream |
| Salary in the wrong column | a stray comma in a re-typed CSV row shifted every field right | **none** — the row looked plausible |

The second is the important one. A shifted row is syntactically valid and semantically wrong. No
schema check catches it. This is not a diligence problem to be solved by being more careful; it is a
channel that cannot carry records reliably and must not be asked to.

Volume forces the issue anyway: ~400 messages at ~160 KB of raw payload each is ~64 MB. No agent
session holds that, so batching is mandatory (see DR-0002 for how batches resume).

The available lever: the harness spills large tool results to disk and gives the agent a **path**.
Paths are short, and — critically — a corrupted path fails to open. The failure is loud.

## Options Considered

### Option 1: Agent transcribes records into files it writes

- **Advantage:** no dependency on harness internals; works in any environment.
- **Disadvantage:** it is exactly the channel that produced both corruptions. Failure mode is silent
  and shaped like valid data.
- **Verdict:** rejected outright. Not a fallback either — see below.

### Option 2: Give the CLI its own Gmail credential now (service account / OAuth)

- **Advantage:** removes the agent from the data path entirely; no harness coupling; the honest
  end state.
- **Disadvantage:** a Google Cloud project, OAuth consent or domain-wide delegation, token storage,
  and a `googleapis` dependency — before a single message has been harvested at scale. It also
  duplicates work that the Sheets adapter will need, so doing it now means doing the harder half of
  two integrations before either is proven.
- **Verdict:** deferred, not rejected. This is the **named successor**, not a hypothetical.

### Option 3: Agent couriers file paths and control values only — *chosen*

- **What:** the agent drives the connector; the connector spills each raw result to disk; the CLI
  globs that directory. The agent transmits no record content at any point.
- **Advantage:** the corrupting channel is closed by construction rather than by care. The remaining
  channel carries only values whose corruption is either impossible to miss or independently checkable.
- **Disadvantage:** couples to harness behaviour that is an implementation detail. Assessed below.

## Decision

**The agent is a courier of paths and control values. It never carries a record.**

Three rules make that enforceable rather than aspirational.

### Rule 1 — Data moves by filesystem, never through context

The connector spills each raw fetch result into a directory. `harvest ingest --raw <dir>` globs that
directory, slims each payload (`core/slim.mjs`, pure), and writes cache records. The agent never
opens a spill file, never quotes one, and never summarises one.

### Rule 2 — Agent-supplied identifiers are fetch *hints*, never data keys

The agent passes Gmail message ids to the connector to fetch. Those ids are never used to key
anything. Each cache record is keyed by the id found **inside its own payload**. A mis-transcribed id
therefore produces a failed fetch — loud — and can never produce a record filed under the wrong key.

### Rule 3 — The agent may transmit only low-entropy control values, each independently verifiable

| Value | Verified by |
|---|---|
| window bounds (`--window 2026-05-01..2026-05-31`) | every ingested message's date must fall inside the window; ingest refuses otherwise |
| expected count (`--expect 25`) | must equal the number of spill files found; ingest refuses otherwise |
| window-exhausted flag (`--complete`) | coverage commits only when `--complete` is given **and** the count check passed |

A wrong window, a wrong count or a wrong flag all fail closed. There is no value the agent can supply
whose corruption produces a plausible-but-wrong result.

### Fragility assessment of the harness coupling — honestly

This design depends on a behaviour that is not a published contract: the threshold at which Claude
Code spills tool results to disk, the directory it uses, and the JSON wrapper it writes. All three
can change between CLI versions without notice, and there is no version to pin.

What makes it acceptable is the **shape of the failure**, not its probability:

- Spill directory changes or disappears → `ingest` finds zero files → count check fails → refuse.
- Wrapper shape changes → `core/slim.mjs` cannot find `plaintextBody` → schema check fails → refuse.
- Threshold rises and small results stop spilling → fewer files than expected → refuse.

Every plausible drift lands on "nothing ingested", never on "partially ingested". That is designed,
not lucky: the count check exists precisely to convert a partial into a refusal.

What is **not** mitigated: if the harness spilled a *truncated* payload that still parsed, a message
could be cached with a short body and fewer jobs than it advertised. Mitigation is a slim-time
sanity check (a LinkedIn digest body under ~1 KB, or with no `/jobs/view/` link, is suspicious and is
quarantined rather than cached). This is a real residual risk and it is not fully closed.

Explicitly **not** a fallback: reverting to agent transcription if the spill behaviour changes. That
trades a loud failure for a silent one. The fallback is Option 2 — build the Gmail API adapter.

### Successor obligation

`MessageSource` has two adapters by design: `raw-spill-source` (interim, agent in the data path) and
`gmail-api-source` (target, agent absent). The port is specified so that swapping one for the other
touches no core module and no CLI subcommand. The same obligation applies to `TargetSheet`
(see DR-0005), and the two share the same credential work — which is the argument for doing them
together when the time comes.

**Every agent-mediated port in this project ships with its named API successor.** A port that has no
named successor is a port we have quietly decided to depend on an agent for.

### Probe contract

`MessageSource.probe()` (raw-spill adapter) must survive, and be tested against:

- spill directory absent or empty → refuse with the expected/actual count
- a spill file that is not JSON → refuse, naming the file; do not skip it
- a spill file missing `plaintextBody` → refuse, naming the file
- a message whose date falls outside the declared window → refuse
- a duplicate id already in the cache → skip silently, and count it as satisfied (this is the
  resumability path from DR-0002 and must not be an error)

### Consequences

- The skill is thin by construction: search, fetch a batch, invoke the CLI, repeat. It holds no
  parsing rules and no domain knowledge, so it cannot drift from the CLI.
- The skill does not yet exist — there is no `.claude/` directory in this project. It is a DELIVER
  deliverable.
- Sessions become resumable at the batch boundary rather than the run boundary, which is what makes
  ~400 messages tractable at all.

## Exceptions

Revisit if:

- **The Gmail API adapter lands.** The skill then becomes optional convenience, and Rules 1–3 apply
  only to whatever agent-mediated ports remain.
- **The harness publishes a stable spill contract.** The fragility assessment softens; the rules stay.
- **A source has no API.** Then the agent stays in the data path permanently for that source, and the
  count/window checks stop being belt-and-braces and become the only integrity mechanism there is.
