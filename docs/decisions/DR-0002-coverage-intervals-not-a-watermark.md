---
id: DR-0002
status: accepted
dateCreated: 2026-08-01
domain: job-alert-harvester
refines: DR-0001
changelog:
  - date: 2026-08-01
    version: 0.1.0
    note: Arose from a contradiction inside DR-0001 surfaced during DESIGN
  - date: 2026-08-03
    version: 1.0.0
    note: Accepted after review

---

# Coverage intervals persist; processed ids derive from the cache

## Context

DR-0001 (persist what cannot be re-derived) ends with a table that treats the
"watermark / processed-id ledger" as one thing, judges it not re-derivable, and persists it.

That row contradicts the principle above it. Once slimmed messages are cached, `max(date)` over the
cache is a perfectly good high-water date — so by DR-0001's own rule the watermark should be
**recomputed**, not stored. Either the principle is wrong or the row is.

The contradiction is real and it is worth resolving carefully, because a wrong resolution here is the
silent kind. A watermark that is too new skips mail and nothing ever tells you.

### The two facts hiding under one word

- **Content** — the set of messages we hold. `max(date)` derives this exactly.
- **Coverage** — the set of time windows we have *searched to completion*. Nothing in the cache
  records this.

They are not the same fact, and they diverge in three ways:

| Divergence | What happens with a derived watermark | Severity |
|---|---|---|
| Empty window — the alert was paused for a week | `max(date)` never advances past the last message, so that week is re-searched on every run, forever | Wasteful; self-healing; not dangerous |
| **Partial batch** — the window held 60 messages, the batch limit fetched 25 | `max(date)` jumps to the newest *fetched* message and the 35 unfetched ones are silently skipped | **Silent data loss** |
| Late arrival — a message lands with an older `internalDate` than one already held | Already behind the derived watermark; never fetched | Silent data loss |

The middle row settles it. Batching is not optional (see DR-0003 — ~400 messages cannot be fetched
in one agent session), and under batching the derivation is simply unsound. Coverage cannot be
computed from content, because content does not know what was *asked for*.

### The other half of the row is derivable

The processed-id ledger genuinely is re-derivable: a message is processed exactly when its slimmed
record is in the cache, and the cache is keyed by message id. Listing the cache *is* the ledger.
Storing it separately would create two sources of truth that can disagree — the classic drift.

So DR-0001's row was half right and half wrong, and it bundled the two halves together.

## Options Considered

### Option 1: Derive everything — `max(date)` over the cache, no persisted state

- **Advantage:** zero incremental state; nothing to corrupt or migrate; the leanest reading of DR-0001.
- **Disadvantage:** unsound under batching, per the table above. Silently loses mail.
- **Verdict:** rejected. It fails the one thing DR-0001 exists to prevent.

### Option 2: Persist a scalar high-water date, as DR-0001 literally says

- **Advantage:** one line of state; familiar; trivially inspectable.
- **Disadvantage:** a scalar cannot express "May is done, June is half done, 2025 was never
  attempted". Backfilling an older period would require moving the scalar backwards and re-fetching
  everything newer. Partial batches still corrupt it unless the batch is abandoned wholesale.
- **Verdict:** rejected. The shape is too weak for resumable batches.

### Option 3: Persist completed coverage intervals; derive processed ids from the cache — *chosen*

- **What:** a per-source append-only list of **closed intervals that have been fully harvested**:
  `{ source, from, to, completedAt, messageCount }`. An interval is written **only** when its window
  is exhausted — every id the search returned has a record in the cache. A partial batch writes
  nothing to the ledger; its fetched messages still land in the cache, so the retry is cheap.
- **Advantage:** each divergence above disappears. An empty window is *covered* (recorded with
  `messageCount: 0`) and never re-searched. A partial batch leaves its window uncovered and resumes
  correctly. Non-contiguous backfill is expressible — 2025 can be harvested without disturbing 2026.
  And it is a strict application of DR-0001's principle rather than an exception to it: coverage is
  not derivable from content, processed ids are.
- **Disadvantage:** interval algebra (merge, subtract, find-gaps) is real logic that must be tested.
  It is pure and small — roughly forty lines — but it is not free.

## Decision

**Persist coverage; derive content.**

| State | Re-derivable? | Treatment |
|---|---|---|
| Which windows have been fully searched | **No** — content cannot tell you what was asked for | **Persist** — `.cache/coverage.json` |
| Which message ids have been processed | Yes — list the cache | **Derive** — never stored |
| Slimmed messages | No (per DR-0001) | Persist, gitignored |
| Parsed rows, fit scores | Yes | Recompute |

The word *watermark* is retired for this project. It names a scalar, and the thing we need is a set.

### Storage layout

```
.cache/                       # gitignored
  coverage.json               # [{ source, from, to, completedAt, messageCount }]
  messages/
    2026-05/
      1970abc123def.json      # { id, date, sender, subject, snippet, plaintextBody }
    2026-06/
  receipts/                   # see DR-0005
```

Messages are sharded by their own month. Sharding keeps directory sizes bounded (~130 files/month at
current volume), makes retention a directory delete, and puts the data next to the coverage record
that claims it. The cost over a flat directory is one recursive walk to derive the processed-id set —
milliseconds at this scale.

The cached record shape is **identical to the committed test fixtures**. That is deliberate: the
existing `fixture-message-reader` becomes the cache reader unchanged, and any fixture can be dropped
into the cache to reproduce a bug.

### Fetch planning

`harvest plan-fetch --source linkedin --from <d> --to <d> --batch <n>` is pure with respect to the
outside world: it reads coverage and the cache, subtracts, and prints the next uncovered window plus
the batch size. It writes nothing.

### Probe contract

`CoverageLedger.probe()` must survive, and be tested against:

- ledger file absent → treated as empty coverage, not an error
- ledger file present but truncated or invalid JSON → **refuse to start**, never silently reset
- ledger directory not writable → refuse to start
- an interval with `to` before `from`, or overlapping a committed interval inconsistently → refuse

A corrupt ledger that silently resets to empty is merely wasteful. A corrupt ledger that silently
reads as "everything covered" loses mail. The probe exists to make the second impossible.

### Consequences

- Re-running an interrupted batch is safe and cheap: cached ids are skipped, the window completes,
  the interval commits once.
- Coverage is inspectable. "Have I harvested April?" is answerable by reading one small JSON file,
  which is the property a scalar watermark never had.
- Commands from DR-0001 stand and gain a third: `plan-fetch` (offline), `ingest` (writes cache and
  coverage), `build` (offline, cache → sheet).

### Effect on DR-0001

DR-0001's **conclusion** stands — this state is persisted, separately from the cache. Its **shape and
name** are superseded here, and one of its two bundled items ("processed-id ledger") moves from
persist to derive. DR-0001 is amended by changelog entry rather than replaced; nothing in it becomes
false, one row becomes more precise.

## Exceptions

Revisit if:

- **Gmail search stops being window-addressable.** The whole model rests on being able to ask "every
  message from this sender between these dates" and know when the answer is exhausted.
- **A source delivers out-of-order beyond a bounded lag.** Coverage assumes a window, once exhausted,
  stays exhausted. A source that back-dates messages after the fact would need a re-open policy.
- **Interval count grows unwieldy.** Adjacent intervals should be merged on commit; if the ledger
  still grows past a few hundred entries, the merge is broken, not the design.
