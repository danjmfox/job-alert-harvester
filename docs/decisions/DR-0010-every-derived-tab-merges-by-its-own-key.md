---
id: DR-0010
status: accepted
dateCreated: 2026-09-17
domain: job-alert-harvester
refines: [DR-0004, DR-0005]
changelog:
  - date: 2026-09-17
    version: 1.0.0
    note: >-
      Initial record — approved by the user 2026-09-17. Extends DR-0004's
      one-owner-per-column merge from the Jobs tab to Companies and Sources,
      and widens DR-0005's plan shape to carry more than one tab per build.

---

# Every derived tab merges by its own key

## Context

`planMerge` in `src/core/merge.mjs:7` is hard-wired to `JOBS_TAB = 'Jobs'`. `apply` (DR-0005,
target sheet is a plan-executing port) preserves every tab the plan does not name, verbatim. So
after a user's first merge, `Companies` and `Sources` **freeze** at whatever that first build
produced — every later run touches only `Jobs`.

That defeats the project's own stated goal. The user's opening requirement was a list of
companies that have advertised jobs they could apply for — the `Companies` tab is the
deliverable, and it is the tab that stops updating.

Both tabs are fully harvester-derived today, per `src/core/harvest.mjs`:

| Tab | Rows (current corpus) | Columns | Natural key |
|---|---|---|---|
| Companies | 102 | `Company`, `Source Type`, `Jobs Seen`, `First Seen`, `Last Seen` | `Company` |
| Sources | 7 | `Source`, `Search Term`, `Sender`, `First Seen`, `Last Seen`, `Messages`, `Jobs Found` | `Source` + `Search Term` (composite) |

The user chose merging both under DR-0004's one-owner-per-column rule over regenerating them
wholesale. Their reasoning: `Companies` is exactly where they are most likely to start
annotating — a target flag, a contact, a note — and a wholesale rewrite would destroy such a
column silently, months later, with no warning. That is the same failure DR-0001 (persist what
cannot be re-derived) exists to prevent, arriving at a second and third tab.

### The design problem: Sources has no single key column

`Jobs` and `Companies` each have one column that identifies a row (`Dedup Key`, `Company`).
`Sources` does not — a row is identified by `Source` *and* `Search Term` together. The current
plan shape carries `updates: [{ key, cells }]`, where `key` is a scalar matched against one
column (`KEY_COLUMN` in `merge.mjs`). That shape cannot express a composite key without a
change, and the change must be additive: 22 committed acceptance tests already pin the current
shapes and must keep passing unchanged —
`tests/acceptance/job-alert-harvester/merge-plan.test.mjs` (9 scenarios, asserting `plan.tab`,
`plan.appendColumns`, `plan.updates[].key`, `plan.updates[].cells`, `plan.appends`,
`plan.changes`) and `tests/acceptance/job-alert-harvester/target-sheet-apply.test.mjs`
(13 scenarios, calling `apply(plan)` with a single-tab plan).

## Options Considered

### Option 1: A `match` object per update, carried alongside the existing scalar `key` — *chosen*

- **What:** `{ key, match: { Source: 'LinkedIn', 'Search Term': 'agile coach in London' }, cells }`.
  `apply` matches a row by testing every `match` entry against the row's columns; `key` is
  retained on every update, single- or composite-key, purely for identity and reporting (the
  `changes` entries and any log line name a row by its `key`, never by a raw `match` object).
  For `Jobs` and `Companies`, `match` is simply `{ 'Dedup Key': ... }` / `{ Company: ... }` —
  the same test the scalar `key` already performs today, so the existing single-key plans need
  not change at all.
- **Advantage:** additive. Every existing `update.key` keeps its meaning; `apply` gains a second,
  optional way to locate a row and falls back to the current `key`-against-`KEY_COLUMN` behaviour
  when `match` is absent. No existing test reads or asserts the absence of `match`, so the 9
  `merge-plan` and 13 `target-sheet-apply` scenarios pass unchanged.
- **Disadvantage:** a little duplication for single-key tabs — `key` and `match` both carry the
  same value. Small, visible, and cheap next to the alternative.

### Option 2: A composed string key plus `keyColumns` on the plan

- **What:** `key: 'LinkedIn\0agile coach in London'`, with `plan.keyColumns` naming the
  columns composed and the separator used to join them.
- **Advantage:** compact; one field carries identity for every tab.
- **Disadvantage:** composing two user-supplied values into one string needs a separator
  guaranteed absent from the data — and `Search Term` is free text recovered from an email body
  (DR-0006, source registry descriptors are data, finding F4), so nothing is actually guaranteed
  absent from it. A search term containing the separator collides two distinct rows into one
  merge target, silently: no error, no schema violation, just the wrong row updated. That is
  precisely the class of "plausible, silent, wrong" corruption this project has repeatedly had to
  dig out of (DR-0009, build derives from the whole cache, names the same shape of hazard for
  `First Seen`/`Times Seen`).
- **Verdict:** rejected. The compactness is not worth a collision that only announces itself
  as a wrong answer in the user's tracker, discovered later, if at all.

### Option 3: A synthetic key column written into the Sources tab

- **What:** the harvester writes its own id column (e.g. `Source Key`) into `Sources` and keys
  the merge on that.
- **Advantage:** collapses back to a scalar key; no plan-shape change at all.
- **Disadvantage:** rejected on sight. It puts machinery in the user's sheet to solve a problem
  the plan format can solve on its own — exactly the "encode the boundary in a side artefact"
  move DR-0004's Option 2 (per-cell provenance store) was already rejected for.
- **Verdict:** rejected.

### Option 4: Leave Sources alone; merge only Companies

- **What:** widen the merge to `Companies` only, matching the user's stated deliverable exactly,
  and leave `Sources` frozen as it is today.
- **Advantage:** cheaper — no composite-key design needed at all. `Sources` is small (7 rows) and
  the least likely tab to be hand-annotated.
- **Disadvantage:** it is still a second frozen tab with the identical latent bug this record
  exists to close, just smaller in scope. Nothing about the reasoning that makes freezing wrong
  for `Companies` stops applying to `Sources` — a `Jobs Found` count that never updates is the
  same silent staleness at 7 rows instead of 102.
- **Verdict:** rejected. The composite-key cost is small (Option 1 above), and rejecting it here
  would leave the exact bug class this record is meant to close.

## Decision

**Every derived tab merges by its own key under DR-0004's one-owner-per-column rule. No tab is
regenerated wholesale. `Sources`' composite key is carried as a `match` object alongside the
existing scalar `key`, additively.**

### Rules

1. **Every derived tab merges by its own key.** `Jobs` keys on `Dedup Key`; `Companies` keys on
   `Company`; `Sources` keys on `Source` + `Search Term` (composite, carried via `update.match`).
   No tab is regenerated wholesale — DR-0004's rules (never delete a row, never match a blank
   key, never reorder columns, report derived changes) apply to each tab independently.

2. **Per-tab ownership.**

   | Tab | Key | Harvester-owned | Human-owned |
   |---|---|---|---|
   | Jobs | `Dedup Key` | as DR-0004 (`Job`, `Company`, `Fit Score`, `First Seen`, `Times Seen`, …) | `Status`, `Qualified?`, `Applied on Date`, … |
   | Companies | `Company` | `Source Type`, `Jobs Seen`, `First Seen`, `Last Seen` | **empty set** |
   | Sources | `Source` + `Search Term` | `Sender`, `First Seen`, `Last Seen`, `Messages`, `Jobs Found` | **empty set** |

   `Companies` and `Sources` have **no human-owned columns today** — every column either tab
   carries is harvester-derived. That empty set is the property that makes this decision safe in
   advance: DR-0004's rule 4 already preserves any column the harvester does not recognise,
   verbatim, in position and value, with no code change. So the day the user adds a column to
   `Companies` — a target flag, a contact — it is automatically human-owned and automatically
   protected, by a rule already written and already tested. This record does not need to name
   that future column; DR-0004 already covers it.

3. **The plan contract widens additively.** `update.match` is optional; when present, `apply`
   matches a row by testing every entry in `match` against the row's own columns instead of
   matching `key` against a single configured key column. When absent, behaviour is exactly
   today's: `key` matched against the tab's key column. Existing single-tab, single-key calls
   and their 22 pinned acceptance scenarios are unaffected.

4. **One plan per tab, one write per build.** `core/merge.mjs` gains `planMergeCompanies` and
   `planMergeSources` alongside the existing `planMerge` (retained, unchanged, still the `Jobs`
   planner — the function the 9 `merge-plan` scenarios call directly). A new `planMergeAll(sheetState,
   harvestModel)` returns `WritePlan[]`, one entry per derived tab present in the harvest.
   `TargetSheet.apply` widens to accept `plan | plan[]` — a bare object is treated as a
   single-element array internally, so `sheet.apply(plan)` (the shape all 13
   `target-sheet-apply` scenarios call) is unchanged. The composition root
   (`src/cli/harvest.mjs`) calls `apply(planMergeAll(...))` once. One `apply` call means one
   temp-file-write-fsync-rename (DR-0005's atomic write); three tabs updated in one rewrite of the
   book, not three sequential rewrites that could leave the tracker half-merged if the process is
   interrupted between them.

5. **Tab presence, not just row presence, follows DR-0004 rule 1.** A tab present in the harvest
   but absent from the tracker is created (mirrors `appends` for a row). A tab present in the
   tracker but absent from the harvest is left completely untouched — never deleted, never
   emptied — the same "absence never means gone" reasoning DR-0004 states for rows, applied at
   tab scope.

## Consequences

- `Jobs Seen` (Companies), `Messages` and `Jobs Found` (Sources) are counters computed over the
  harvest exactly as `Times Seen` is on `Jobs`. DR-0009 (build derives from the whole cache)
  therefore governs all three the same way it governs `Times Seen`: a window-scoped build would
  silently understate them, for the identical reason — `toCompaniesRows` and `toSourcesRows`
  (`src/core/harvest.mjs:131`, `:165`) fold over whatever rows they are given, with no history
  awareness, and DR-0004's "harvester-owned columns are always overwritten" would write the
  smaller, wrong number over the larger, correct one. `build`'s full-corpus derivation is what
  keeps that from happening; this record does not change that invariant, it inherits it.
- The `changes` report (DR-0004 rule 4) now covers three tabs instead of one. The already-named
  and still-unresolved concern stands and gets louder: `First Seen`/`Last Seen` churn on
  `Companies` and `Sources` can drown the signal the report exists to carry — a parser fix
  reaching history. Widening the report's scope before that noise problem is addressed makes it a
  three-tab problem instead of a one-tab problem; not solved here, only inherited and enlarged.
- `Company` is a parsed string, not a stable id. A parser fix that corrects a company name (say,
  a supplier suffix trimmed, or a franchise name normalised) makes the merge see a *new* company
  and leaves the old row behind, unmatched and unmerged — never deleted (rule 1), but stale and
  duplicated. This is the same fuzzy-key weakness DR-0006 (source registry descriptors are data)
  already names for jobs with no canonical id (`fuzzyKey(company|title|location)`), arriving here
  through a different door: `Companies`' key is exactly the field DR-0006 already flagged as
  unstable, now load-bearing for merge identity rather than only for dedup.

## Exceptions

Revisit if:

- **A human-owned column is wanted on `Companies` or `Sources`.** It is simply added to the
  sheet; no code change, per rule 2 above and DR-0004 rule 4.
- **The tracker moves to the Sheets API** (DR-0005's named successor). Per-tab plans map onto
  `batchUpdate` ranges more directly than a whole-tab rewrite would — this record's "one plan per
  tab" shape is already the unit the Sheets adapter will want.
- **A fourth derived tab appears.** It needs its own key. What makes a key acceptable: one or
  more columns whose *combination* uniquely identifies a row in that tab, tested by exact-value
  comparison per column (as `match` does here) rather than composed into a single string (Option
  2, rejected above, for the collision reason given there).
