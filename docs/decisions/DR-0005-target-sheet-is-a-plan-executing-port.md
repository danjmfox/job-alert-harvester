---
id: DR-0005
status: accepted
dateCreated: 2026-08-01
domain: job-alert-harvester
refinedBy: DR-0010
changelog:
  - date: 2026-08-01
    version: 0.1.0
    note: Arose from the absence of any Google Sheets write capability in available connectors
  - date: 2026-08-03
    version: 1.0.0
    note: Accepted after review
  - date: 2026-09-17
    version: 1.1.0
    note: >-
      DR-0010 (every derived tab merges by its own key) also refines this record — widening
      the plan from a single tab to one plan per derived tab, applied atomically in a single
      write; pointer added so the refinement chain is recorded in both directions.

---

# The target sheet is a plan-executing port

## Context

The tracker lives in Google Sheets. **No available connector can write to it** — verified: Drive
offers file *create* only, with no update or append. So the interim path is: the harvester writes an
`.xlsx`, and the human uploads it by hand. The eventual path is a Sheets API adapter behind a service
account.

Two adapters with very different capabilities will sit behind the same port, and the port has to be
shaped so the swap is a swap rather than a rewrite. The obvious shape — `writeWorkbook(path, model)`,
which the walking skeleton already has — cannot survive it. After DR-0004 the operation is no longer
"write a workbook". It is "apply these specific cell changes to a sheet that already contains data I
must not disturb". A whole-model write cannot express that, and the Sheets API cannot implement it.

## Options Considered

### Option 1: Keep `writeWorkbook(path, model)`; the adapter reads and merges internally

- **Advantage:** no change to the existing adapter signature.
- **Disadvantage:** the merge policy of DR-0004 would live inside each adapter and be reimplemented
  for Sheets — the most consequential logic in the system, duplicated across the boundary it is meant
  to be protected from, and only testable through real I/O.
- **Verdict:** rejected. It puts domain logic in the shell.

### Option 2: `read()` + `write(fullModel)`; the core merges and returns a complete sheet

- **Advantage:** simple port; merge stays pure.
- **Disadvantage:** a full-sheet write is the one thing the Sheets adapter should avoid — it destroys
  every Sheets-native feature the model does not represent (validation, conditional formatting,
  notes, filter views), and it makes a 3,000-row `batchUpdate` out of a five-cell change. The port
  would work but would force the target adapter into its worst mode.
- **Verdict:** rejected. It makes the swap legal but not real.

### Option 3: `read()` + `apply(plan)`, where the plan is data produced by the pure core — *chosen*

- **What:**
  ```
  TargetSheet (driven port)
    read()          -> SheetState  { tabs: { name: { columns[], rows[] } } }
    apply(plan)     -> Receipt     { appliedAt, cellsWritten, inputDigest, outputDigest }
    probe()         -> ProbeResult
  ```
  `WritePlan` is data: `{ tab, appendColumns[], updates: [{ key, cells: { column: value } }],
  appends: [ row ] }`. `core/merge.mjs` computes it; only `apply` writes.
- **Advantage:** both adapters consume the same plan, and each executes it in its own natural mode —
  xlsx rebuilds the file in memory and writes it; Sheets issues a targeted `batchUpdate`. The
  merge policy is written once, in a pure module, tested without touching a filesystem or a network.
  `--dry-run` is free and cannot lie, because it stops at the plan.
- **Disadvantage:** a plan format to define and version. It is small, and it is the artifact the
  acceptance tests will assert against, so it earns its keep.

## Decision

**`TargetSheet` exposes `read()`, `apply(plan)` and `probe()`. The plan is data computed by the pure
core; the adapter only executes it.**

This is the plan-value pattern: the function that could write returns a value instead, and a
separate, obviously-impure function executes it. The class of bug where a preview mutates the tracker
is not testable-around — it is unrepresentable.

### What the interim xlsx adapter cannot guarantee

Stated plainly, because the swap is months away and these will be lived with:

1. **No concurrency control.** A file has no revision identity. If the Google Sheet is edited between
   download and re-upload, those edits are invisible to the merge and are lost on upload. Sheets has
   ETags and revision ids; a downloaded file has an mtime that means nothing.
2. **Round-trip fidelity loss.** Download → SheetJS read → SheetJS write → upload does not preserve
   conditional formatting, data validation, filter views, notes, protected ranges, or comments.
   Formulas are re-evaluated on upload. SheetJS cannot preserve what it never read.
3. **Whole-tab rewrite.** The adapter cannot write individual cells, so anything not represented in
   the model is destroyed rather than left alone. The plan's precision is real for the Sheets adapter
   and advisory for this one.
4. **The upload is unverifiable.** The system cannot confirm the human uploaded the file, so
   "written to target" can never enter the coverage ledger (DR-0002). Coverage records what was
   *harvested*, never what was *published*.
5. **No audit trail.** No revision id to record, so a `Receipt` cannot say which version of the sheet
   it merged against.

Mitigation for (1) and (4) — partial, and named as partial. Each run writes
`.cache/receipts/{timestamp}.json` carrying the digest of the file read and the file written. The
next run compares:

| Comparison | Meaning |
|---|---|
| input digest == last output digest | the file was never uploaded, or the download is stale — **warn** |
| input digest != last output digest | the sheet was edited outside the loop — expected and fine |
| no prior receipt | first run |

That converts an invisible loss into a visible warning. It does not prevent the loss.

### Probe contract

`TargetSheet.probe()` must survive, and be tested against:

| Adapter | Scenario |
|---|---|
| xlsx | target file absent → valid, means "create new"; must not be an error |
| xlsx | target file present but not a workbook → refuse |
| xlsx | **`Jobs` tab has no `Dedup Key` column** → refuse. This is the dangerous one: merging without a key appends every job as new and doubles the sheet |
| xlsx | target directory not writable → refuse before any read work |
| xlsx | write path: write to a sibling temp file, fsync, rename — verify the rename landed and the bytes read back |
| Sheets | credentials resolve; spreadsheet id resolves; the named tab exists |
| Sheets | write scope is genuinely granted — attempt a no-op `batchUpdate`, do not trust the scope string |
| Sheets | quota not already exhausted |

Wire → probe → use in `cli/harvest.mjs`. A failed probe refuses to start and emits
`health.startup.refused` with the failing adapter and scenario.

Writes are atomic at the file level: temp file in the same directory, fsync, rename. A crash mid-write
leaves the previous tracker intact. The bounded change universe for this adapter is the target path
plus its sibling temp file — nothing else on the filesystem is touched.

### Consequences

- The existing `writeWorkbook` is retained as the create-new path (no target file, no merge). It
  becomes one branch inside the adapter rather than the whole adapter.
- The walking-skeleton acceptance test continues to exercise the create-new path unchanged.
- New acceptance coverage is needed for merge-into-existing, and it asserts against the **plan**
  rather than the file for everything except the final write.
- The Sheets adapter, when built, shares credential work with the Gmail API adapter named in DR-0003.
  Doing them together is cheaper than doing either alone.

## Exceptions

Revisit if:

- **A connector gains Sheets write.** The manual upload disappears and limitation (4) with it; the
  port is unchanged, which is the point of shaping it this way.
- **The tracker moves off Sheets** (Airtable, Notion, SQLite). The plan format is storage-agnostic;
  a new adapter is a day's work rather than a redesign.
- **Multiple writers appear.** `apply` would need an expected-revision argument, which the xlsx
  adapter cannot supply. That is the point at which the interim path stops being viable at all.
