---
id: DR-0004
status: accepted
dateCreated: 2026-08-01
domain: job-alert-harvester
refines: DR-0001
refinedBy: DR-0010
changelog:
  - date: 2026-08-01
    version: 0.1.0
    note: Implements DR-0001's third application (manual annotations) as a merge policy
  - date: 2026-08-03
    version: 1.0.0
    note: Accepted after review
  - date: 2026-09-17
    version: 1.1.0
    note: >-
      DR-0010 (every derived tab merges by its own key) also refines this record — extending
      the one-owner-per-column rule from the Jobs tab to Companies and Sources; pointer added
      so the refinement chain is recorded in both directions.
  - date: 2026-10-02
    version: 1.2.0
    note: >-
      DR-0014 (Role Family is a derived column) adds `Role Family` to the harvester-owned Jobs
      columns; the ownership table lists it. The rules are unchanged.

---

# Every column has exactly one owner

## Context

DR-0001 established that hand-typed columns — `Status`, `Qualified?` (`No (SC Clearance)`),
`Applied on Date` — are the only data in the sheet that no parser improvement can ever regenerate,
and therefore that the target sheet must be merged, not recreated.

That settles *whether* to merge. It does not say **what wins on a conflict**, and the obvious answer
("harvester wins for its columns, human wins for theirs") is harder than it looks, because the
harvester currently writes `null` into columns the human actually fills in. `Permanent/Contract`,
`Onsite/Hybrid/Remote` and `Full time/Part Time` are all emitted as `null` by
`core/harvest.mjs:toJobsRow` today. A naive "harvester owns everything it emits" policy would blank
them on every run.

The tempting middle position — *fill only if the cell is empty* — is worse than it looks. Consider
`Max Salary (annual)`: the harvester writes 75000; the parser is later fixed and computes 80000; the
cell is non-empty, so the fix never lands. The cell was written by the harvester, not the human, and
the policy cannot tell. Making it tell requires per-cell provenance in a side store — hidden state
that can disagree with the sheet, which is the drift this project exists to resist.

## Options Considered

### Option 1: Fill-if-empty for ambiguous columns

- **Advantage:** no schema change; the human can correct any cell in place.
- **Disadvantage:** correctness depends on provenance the sheet does not carry. Parser improvements
  silently fail to reach any cell that was ever populated. Needs a hidden provenance store to fix.
- **Verdict:** rejected. It reintroduces the "silently frozen history" failure DR-0001 was written
  to prevent, in a new place.

### Option 2: Per-cell provenance store

- **Advantage:** exactly correct; the harvester can overwrite what it wrote and never what the human
  wrote.
- **Disadvantage:** a second source of truth about the sheet, living outside the sheet, keyed by
  (dedup key, column). It goes stale the moment anyone edits the sheet in a way it does not observe —
  which is every edit, since the interim path is a manual download/upload.
- **Verdict:** rejected. Cognitive Load Tax with a correctness hazard attached.

### Option 3: One owner per column; overrides get a sibling column — *chosen*

- **What:** every column is owned by exactly one of the harvester or the human. Where the human needs
  to override a derived value, that is a **new human-owned column** next to it, not an edit to the
  derived one.
- **Advantage:** the ownership boundary is visible in the sheet itself, not encoded in a policy file
  or a side store. "Can the harvester overwrite this?" is answerable by looking at the header row.
  Parser improvements always reach every derived cell. Human judgement is never at risk.
- **Disadvantage:** the sheet grows a column each time an override is wanted, and the human must
  learn which column to type in. Mildly annoying; entirely visible.

## Decision

**Every column has exactly one owner. Where the human needs to override a derived value, add a
human-owned sibling column rather than editing the derived one.**

Merge is keyed on `Dedup Key`.

| Owner | Columns | Merge behaviour |
|---|---|---|
| Key | `Dedup Key` | written once on row creation; never rewritten |
| Harvester | `Job`, `Date Discovered`, `Advert Link`, `Company`, `Location`, `Min Salary (annual)`, `Max Salary (annual)`, `Source`, `Source Type`, `Fit Score`, `Fit Reason`, `Role Family`, `First Seen`, `Last Seen`, `Times Seen` | **always overwritten** with the freshly derived value |
| Human | `Status`, `Qualified?`, `Applied on Date`, `Permanent/Contract`, `Onsite/Hybrid/Remote`, `Full time/Part Time`, `Min Salary (hourly)`, `Day Rate` | **never written** after row creation; created as blank |
| Human (unknown) | any column the harvester does not recognise | **preserved verbatim**, position and value |

`Min Salary (hourly)` and `Day Rate` sit with the human today because nothing derives them. When a
parser learns to, it gets `Day Rate (derived)` — it does not take the human's column.

### Rules the merge must obey

1. **Never delete a row.** A sheet row whose `Dedup Key` is absent from the harvest (an older job, a
   2025 tracker row) is left completely untouched. Deletion is unrecoverable and the harvest is
   window-bounded, so absence never means "gone".
2. **Never match a blank key.** A hand-added row with no `Dedup Key` is a human artefact. It is
   preserved and never matched, merged into, or reordered.
3. **Never reorder or drop columns.** New harvester columns are appended to the right of the existing
   header. Existing column order is the human's.
4. **Report derived changes.** When a harvester-owned cell changes value between runs, record it.
   This is the signal that a parser improvement reached history — the payoff DR-0001 bought with the
   cache — and without a report it is invisible. Summary to stderr; detail to `--report <file>`.

### The merge is a plan, not a write

`core/merge.mjs` is pure: `(sheetState, harvestModel) → WritePlan`. It touches nothing. Only
`TargetSheet.apply(plan)` writes (DR-0005). `build --dry-run` prints the plan and is pure by
construction — "the preview modified the tracker" is not a representable state.

### Consequences

- The human can hand-edit any human-owned cell at any time, including mid-run, and the harvester will
  never argue with it.
- A wrong `Fit Score` or a wrong salary is fixed by fixing the parser and re-running, which is the
  intended repair path and now the only one for derived columns.
- The first real merge against the existing 2025 tracker will surface schema differences. That
  reconciliation is a DISTILL/DELIVER task with the real file in hand, not a design-time guess.

### Open for the human to decide

`Min Salary (annual)` and `Max Salary (annual)` are listed as harvester-owned. Salary is the column
most likely to be worth hand-correcting, and SPIKE flagged range parsing as untested by any fixture.
The alternative is to move both to human-owned and add `Min/Max Salary (derived)`. That is a
preference call about how the sheet reads, not an architectural one — see the DESIGN report.

## Exceptions

Revisit if:

- **Sibling columns proliferate.** More than two or three overrides means the parser is wrong often
  enough that per-cell provenance starts earning its complexity.
- **The sheet gains multiple human editors.** One-owner-per-column resolves harvester-vs-human. It
  says nothing about human-vs-human, which would need the Sheets API's revision identity.
- **A derived column becomes load-bearing for a decision already taken.** If `Fit Score` were ever
  used to *record* something rather than to sort, overwriting it would destroy history.
