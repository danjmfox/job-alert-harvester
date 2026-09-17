---
id: DR-0009
status: accepted
dateCreated: 2026-09-17
domain: job-alert-harvester
refines: DR-0001
changelog:
  - date: 2026-09-17
    version: 1.0.0
    note: Initial record — pins build's derivation scope before the build subcommand is implemented

---

# `build` derives every row from the whole cache, never from a window

## Context

DR-0002 (coverage intervals, not a watermark) gave `harvest` a family of windowed subcommands:
`plan-fetch` hands out at most one UTC day, and `ingest --window` takes exactly that day. That
shape is deliberate and correct for *fetching* — DR-0002's whole argument is that coverage is a
set of searched intervals, not a scalar.

`build` is a different subcommand with a different question to answer: given everything in the
cache, what should the sheet say? Nothing has settled that yet. `build` is still an unimplemented
RED scaffold — `src/cli/harvest.mjs:26` declares `__SCAFFOLD__ = Object.freeze({ build: true })` —
so no behaviour is committed. That is exactly why this needs recording now, before an
implementation quietly inherits the windowed shape of its neighbours.

### The pull toward the wrong behaviour

`plan-fetch` and `ingest` are windowed. `build` sits next to them in the same CLI, fed by the same
cache. The natural next sentence to write is "harvest the new window, then merge it into the
tracker" — extending the fetch shape one step further. That sentence is precisely wrong for
`build`, and the wrongness is silent.

### The hazard, measured

`First Seen`, `Last Seen` and `Times Seen` are computed **solely from the messages passed to a
single call** of `harvest()`. In `src/core/harvest.mjs`, `upsertByDedupKey` (line 67) sorts the
rows it was given by `seenAt` and, for the first sighting of a `dedupKey` in that batch, sets
`firstSeen: row.seenAt, lastSeen: row.seenAt, timesSeen: 1` (lines 73–78); later sightings *within
that same batch* widen the window and increment the count (lines 81–82). There is no history
awareness — the function never reads a prior `First Seen` or `Times Seen`, and DR-0004 (one owner
per column) confirms none of the three columns is ever read back from the sheet.

Combined with DR-0004's rule that harvester-owned columns are **always overwritten**, a
window-scoped harvest writes the worse value over the better one. Measured on the live corpus,
using the job `IT Product Delivery Manager` at `Biffa`, advertised in both halves of the cached
mail:

| | First Seen | Times Seen |
|---|---|---|
| Rebuild from the whole cache (current `--in` behaviour) | 2026-09-08 | 4 |
| Harvest only the later window, then merge into the tracker | **2026-09-09** | **2** |

`First Seen` moves *forward* and `Times Seen` resets. Both regressions are silent: the values are
plausible, the schema is satisfied, and nothing reports it.

### Why the user cares

"First advertised three weeks ago, seen five times" distinguishes a role that is hard to fill, or
a recruiter fishing, from a genuinely fresh posting. If `First Seen` drifts forward on every run,
an old advert looks new and the sheet loses exactly the signal it exists to carry. This is a
job-search decision aid, not a bookkeeping nicety — the regression is a wrong answer to the
question the sheet is for, not a cosmetic defect.

## Options Considered

### Option 1: `build` always reads the whole cache — *chosen*

- **What:** every `build` run parses every cached message and recomputes `First Seen`,
  `Last Seen` and `Times Seen` over the full corpus, exactly as `--in` does today.
- **Advantage:** DR-0001 (persist what cannot be re-derived) already measured and accepted this
  cost — ~10 ms/message, ~10 s to reparse a year. The cost is negligible and the precedent is set.
- **Disadvantage:** none beyond the already-accepted reparse cost.

### Option 2: Window-scoped build, three columns moved to human-owned

- **What:** stop the harvester writing `First Seen`, `Last Seen`, `Times Seen`; make them
  human-owned blanks like `Status` or `Qualified?`.
- **Advantage:** removes the clobbering hazard directly — nothing overwrites a value the human
  didn't set.
- **Disadvantage:** these three columns are derived from message history, not from human
  judgement. DR-0004 is explicit that a column nothing derives sits with the human; these are
  derived, so moving them there misfiles them and leaves nothing to ever maintain them.
- **Verdict:** rejected.

### Option 3: Window-scoped build, columns read back from the sheet and merged forward

- **What:** `build` reads the sheet's current `First Seen`/`Last Seen`/`Times Seen`, treats the
  window's harvest as an increment, and merges forward (`min(firstSeen)`, `max(lastSeen)`,
  `count + delta`).
- **Advantage:** avoids a full reparse.
- **Disadvantage:** makes the sheet an input to its own derivation — a second source of truth
  that goes stale the moment anyone edits the sheet, which under the interim manual download/
  upload path (DR-0005, target sheet is a plan-executing port) is every edit. This is the
  per-cell-provenance hazard DR-0004 already rejected as its Option 2, recurring in a new place.
- **Verdict:** rejected.

### Option 4: Window-scoped build, accepting the regression

- **What:** do nothing; let `build` operate on whatever window it's handed.
- **Verdict:** rejected. Named only to be rejected — it trades a ten-second reparse for silent,
  unbounded history loss, which is the exact failure DR-0001 exists to prevent.

## Decision

**`build` derives every row from the whole cache. A window-scoped build is a defect, not a
configuration.**

1. `build` derives from the whole cache. A window-scoped build is a defect, not a configuration.
2. Coverage intervals (DR-0002, coverage intervals not a watermark) govern what is **fetched**,
   never what is **derived**. The two windows are unrelated and must not be conflated — this is
   the sentence most likely to prevent the mistake.
3. `First Seen`, `Last Seen` and `Times Seen` are derived from the full corpus every run, and are
   never read back from the sheet.
4. The invariant is pinned by an acceptance test, not by convention. The test must fail if the
   derivation is narrowed to a window — a guard that cannot fail is not a guard.

## Consequences

- Reparse cost grows linearly with the corpus; DR-0001's own Exceptions clause already names
  ~6,000 messages as the point at which a parser-version-keyed cache becomes worth its complexity.
  This record does not move that threshold — `build`'s full-corpus read is the same reparse DR-0001
  already priced in, not an additional cost.
- `harvest()` keeps no history awareness, which keeps it pure and trivially testable — the
  invariant lives at the composition root instead (`src/cli/`), which is where it belongs.
- The interim manual download/upload path (DR-0005) means the sheet can be edited between runs;
  deriving `First Seen`/`Last Seen`/`Times Seen` from the cache rather than the sheet is what
  keeps the harvester's output independent of those edits.

## Exceptions

Revisit if:

- **Corpus growth makes full reparse genuinely slow.** The answer is a parsed cache keyed by
  parser version — DR-0001's own named exception — not a narrowed `build` window.
- **A source arrives with no stable id**, so dedup cannot collapse resends. `Times Seen` stops
  being meaningful for that source and this invariant needs restating per-source.
- **A Gmail API adapter replaces the manual spill path** (DR-0003, agent couriers paths not
  records, names this as a future successor). Does not affect this record — it changes fetching,
  not derivation.
