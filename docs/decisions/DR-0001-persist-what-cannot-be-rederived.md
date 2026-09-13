---
id: DR-0001
status: accepted
dateCreated: 2026-08-01
domain: job-alert-harvester
refinedBy: [DR-0002, DR-0004]
changelog:
  - date: 2026-08-01
    version: 0.1.0
    note: Initial draft — arose from the caching question during SPIKE
  - date: 2026-08-03
    version: 1.1.0
    note: >-
      Amended by DR-0002 (coverage intervals, not a watermark). The conclusion
      stands; the "watermark / processed-id ledger" row bundled two facts and is
      split there. Nothing here became false — one row became more precise.
  - date: 2026-09-13
    version: 1.2.0
    note: >-
      DR-0004 (one owner per column) also refines this record — the manual-annotation
      application; pointer added so the refinement chain is recorded in both directions.

---

# Persist what cannot be re-derived; recompute what can

## Context

The harvester runs incrementally: each run fetches new job-alert emails, extracts jobs, and
updates a target spreadsheet. That forces a question the walking skeleton did not have to answer,
because it ran once over five fixtures: **what state survives between runs?**

Three candidates, usually lumped together as "the cache":

1. Raw emails fetched from Gmail
2. Parsed job rows
3. The watermark / processed-id ledger

Getting this wrong is expensive **asymmetrically**. Persisting too much costs disk, which is
cheap and visible. Persisting the *wrong* thing silently freezes history at an old parser's
understanding — and there is no signal when it happens. You discover it months later when a
parser improvement fails to change any historical row.

The pressure is immediate: the next piece of work is the harvest skill, which is the thing that
will create this state. Deciding after it is built means migrating data rather than shaping it.

### Measured evidence

| Operation | Cost |
|---|---|
| Parse | ~50 ms for 5 messages (~10 ms/msg) — **~10 s to reparse a year** |
| Fetch | one Gmail call per message, ~160 KB per raw result — **~1,000 round trips/year** |
| Storage (slimmed) | ~7.5 KB/msg → **~7.5 MB/year** |
| Storage (unslimmed) | ~160 KB/msg → ~150 MB/year, almost all HTML we never parse |

Parsing is free. Fetching is the real cost. Any argument for caching to "reduce reparsing" is
solving a problem that does not exist.

### Two known parser gaps, already

- The fit scorer under-rates *"Agile Delivery, Scrum and Coaching — Consultant/Senior Consultant"*
  (Capgemini Invent), scoring 1 because "Coaching" does not match `/agile coach/`.
- Salary-range parsing (`£55K–£70K`) is implemented but exercised by no fixture.

Both will be fixed. Whether that fix can reach a year of history depends entirely on this decision.

## Options Considered

### Option 1: Cache nothing — parse in flight, store only extracted rows

- **Advantage:** leanest; no personal data at rest; nothing to invalidate.
- **Disadvantage:** history is frozen at whatever the parser understood on the day it ran. Every
  future parser improvement applies only to *new* mail. Re-deriving history means re-fetching
  ~1,000 messages, which the watermark has already moved past.
- **Principles:** fails **Shift-Left (#5)** — it makes the fragile, unrecoverable thing
  (irreplaceable source data) the thing we discard.

### Option 2: Cache raw slimmed emails only — *chosen*

- **What:** persist `{id, date, sender, subject, snippet, plaintextBody}` keyed by Gmail message
  id, gitignored. Discard `htmlBody` at cache time.
- **Advantage:** Gmail messages are immutable, so a cache keyed by message id **can never go
  stale** — there is no invalidation problem to get wrong. Full reparse becomes a default path,
  not a recovery mode. Parser improvements retroactively upgrade all history.
- **Disadvantage:** ~7.5 MB/year at rest, containing personal job-search history.
- **Principles:** satisfies **idempotency as a virtue (#1)** — the tool is safely re-runnable and
  its state is inspectable. Gitignoring addresses **Self-Stewardship (#7)** ("sensitive data
  gated").

### Option 3: Cache raw + parsed rows

- **Advantage:** saves ~10 s per full run.
- **Disadvantage:** the parsed half is invalidated by *every* parser change, and nothing records
  which parser generation produced which row. The cache silently mixes generations — the exact
  failure mode this decision exists to prevent. Buys ten seconds; costs trustworthiness.
- **Principles:** fails **Cognitive Stewardship (#2)** — a second cache layer with a real
  correctness hazard, for no measurable gain.

### Option 4: Cache parsed rows only

- Strictly worse than Option 3: inherits the staleness hazard *and* discards the source.

## Decision

**Persist what cannot be re-derived; recompute what can.**

This single principle resolves all three candidates:

| State | Re-derivable? | Treatment |
|---|---|---|
| Raw email | Not cheaply — watermark has moved past it | **Persist**, gitignored |
| Parsed rows | Always, in ~10 s | **Recompute** — never cached |
| Manual annotations | **Never** — human judgement | **Persist and merge**, never overwrite |
| ~~Watermark / processed-id ledger~~ | *split — see DR-0002* | **Coverage intervals** persist; **processed ids** derive from the cache |

### Third application: manual annotations (emerged requirement)

The prior 2025 tracker carries hand-typed columns — `Status`, `Qualified?` (`No (SC Clearance)`,
`No (HR)`), `Applied on Date`. These are the user's own judgements: the most valuable data in the
sheet and the only part that **cannot be regenerated by any parser improvement**.

By the same principle, they must be preserved. This **rules out recreating the target spreadsheet
on each run** and requires a read → merge → write upsert keyed on `Dedup Key`. Labelled *emerged
from use*, not a gap in the original spec: it surfaced from inspecting the user's real tracker,
not from the requirements.

### Consequences

- Two commands follow naturally: `harvest --fetch` (incremental, hits Gmail) and
  `harvest --reparse` (offline, rebuilds everything from cache).
- Full reparse being cheap and default means parser quality compounds over history rather than
  only going forward.
- The cache is gitignored: a year of personal job-search activity does not belong in git history.
  Only the five curated test fixtures stay committed.
- The watermark is **not** the cache. It decides what to *fetch*; dedup still runs over everything
  fetched, because LinkedIn resends are partially-overlapping digests (see SPIKE findings F3).

### Trade-offs accepted

- ~7.5 MB/year of personal data at rest on the local machine, unencrypted.
- ~10 s reparse cost on every full run — accepted deliberately as the price of never holding
  stale derived data.

## Exceptions

Revisit this decision if:

- **Corpus growth makes reparse slow.** At ~10 ms/message, reparse stays under a minute up to
  ~6,000 messages. Beyond that, a parsed cache *keyed by parser version* becomes worth its
  complexity — note the key, which is what makes Option 3 safe and its absence is the objection.
- **The cache must leave the local machine** (shared or cloud-synced). Then the personal-data
  exposure changes character and needs encryption-at-rest or a retention policy.
- **A source stops exposing a stable id.** The immutability argument rests on Gmail message ids.
  A source without one would need a different cache key and could go stale.
- **Gmail retention or API limits make re-fetch impossible**, which strengthens rather than
  weakens the decision — but would make the cache load-bearing rather than convenient, and
  warrant a backup policy.
