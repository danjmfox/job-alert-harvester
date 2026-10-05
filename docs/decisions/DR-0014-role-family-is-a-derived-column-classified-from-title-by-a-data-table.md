---
id: DR-0014
status: accepted
dateCreated: 2026-09-30
domain: job-alert-harvester
refines: DR-0004
relatedTo: [DR-0006, DR-0009, DR-0010]
changelog:
  - date: 2026-10-02
    version: 1.0.0
    note: Accepted by the human together with the ten DESIGN open questions, taken as recommended
  - date: 2026-09-30
    version: 0.1.0
    note: Drafted by the DESIGN wave of role-family-column; awaits the human's ratification (docs/feature/role-family-column/feature-delta.md, Open Questions)

---

# Role Family is a derived column, classified from the title by a data table

## Context

The harvester writes one Jobs row per distinct advert. The operator wants to analyse market trends across the local cache of about 3,050 cached adverts (2,265 distinct adverts after deduplication) and will build pivots and charts in the Google Sheet. Pivots need a low-cardinality grouping column, and the Jobs tab has none: the `Job` column is free text and `Fit Score` is a number.

This need emerged from use, not from the original specification. A first attempt used one crude regular expression over titles and left 606 of the 2,265 distinct adverts unclassified. The classification therefore has to be tunable: the operator must be able to see which titles fall through and add patterns.

Four existing records bear on the choice. DR-0004 (every column has one owner) says a value the harvester derives is harvester-owned and is overwritten on every run, and that new harvester columns are appended to the right of an existing header. DR-0006 (source registry descriptors are data) sets the precedent that variable behaviour lives in plain data tables, not in branches. DR-0009 (build derives from the whole cache) says every derived value is recomputed from the whole cache on each `build`. DR-0001 (persist what cannot be re-derived) says nothing that can be recomputed is stored. A title is already in the cache, so a family derived from it can be recomputed at no cost.

The operator decided the shape before this record: a harvester-owned column, a pure classifier, a data table of patterns, first match in a fixed priority order, fallback `other`, and no Trends tab or report command. This record captures that decision and its consequences so the next reader can see why.

## Options Considered

### Option A: A harvester-owned `Role Family` column on the Jobs tab, classified from the title by a pure function over an ordered data table (chosen)

- **What:** one new derived column. The classifier takes the title and returns exactly one family from a closed set, taking the first family whose patterns match in a fixed order and `other` when none does.
- **Advantage:** the operator's pivots and filters work on it directly. It reuses the whole existing merge path, so existing trackers gain the column without a migration. Pattern edits are tunable and re-derive every row on the next `build` (DR-0009).
- **Disadvantage:** a family label is a value the operator's pivots group by, so renaming one later rewrites every row of that family. On an existing tracker the column lands at the far right, not beside `Fit Reason`.

### Option B: A harvester-owned Trends tab holding aggregates

- **What:** a new derived tab of counts by family and period, written by `build`.
- **Advantage:** the aggregate is visible without building a pivot.
- **Disadvantage:** it moves analysis decisions (which periods, which measures) into the harvester, when the operator has said they will build those in the Sheet. A new tab needs its own key and merge rules under DR-0010 (every derived tab merges by its own key) and adds a fourth tab to every write plan for a question a pivot answers.
- **Verdict:** rejected by the human.

### Option C: A report command that prints or writes trend output

- **What:** a new subcommand that reads the cache and emits a trend report.
- **Advantage:** no change to the tracker.
- **Disadvantage:** a second derivation path outside the tracker that the operator would then copy into the Sheet by hand, and a new CLI surface to document, test and keep in step with the classifier.
- **Verdict:** rejected by the human.

## Decision

**Role Family is a harvester-owned, derived Jobs column. A pure function classifies it from the title alone, by first match over an ordered data table, with fallback `other`.**

1. **Owner.** `Role Family` is harvester-owned and non-key (DR-0004). The harvester overwrites it on every run. A human who wants a different family adds a human-owned sibling column, as DR-0004 says.
2. **Input.** The title is the only input. Company, search term and source do not influence the family, so a given advert has one family regardless of which alert surfaced it or which sighting supplied its title.
3. **Table.** The table is an ordered list of descriptors, each `{ family, patterns }`, held as plain data in `src/core`. The classifier returns the family of the first descriptor with a matching pattern, else `other`. Order is the priority and is part of the data. The family set is closed: the descriptors' family names plus `other`.
4. **Nothing is persisted.** The family is recomputed from the whole cache on every `build` (DR-0001, DR-0009). Editing a pattern re-derives every row on the next build, and each row whose family changed is reported as a derived correction, not as sighting bookkeeping.
5. **Existing trackers.** A target whose Jobs header lacks `Role Family` gains it through the existing append-missing-harvester-column path (DR-0004 rule 3) in both the xlsx and the Sheets target. No header migration is built. The first population of the new column is not itemised as corrections, because the existing report excludes columns the run itself appends.
6. **Tuning aid.** The most frequent `other` titles are an output of `build` and `build --dry-run`. They are not a new tab or a new subcommand. The form is settled in the feature-delta (open question on surfacing).
7. **Labels are a contract.** The family strings written to cells are what the operator's pivots group by. Renaming a family is a decision of this kind, not a refactor.

## Exceptions

Revisit if:

- **Classification needs more than the title.** If the operator finds families that only the company or the job description can separate, the title-only rule fails and the descriptor shape (patterns over one string) has to widen.
- **One advert needs several families.** The closed set and first-match rule give exactly one. A need for tags would replace the column with a multi-valued one, which pivots handle poorly.
- **The table outgrows a flat ordered list.** DR-0006 already records that first-match ordering becomes a subtle dependency at about a dozen entries. The table starts at six descriptors; past about a dozen an explicit priority field and shadowing checks earn their place.
- **Human overrides proliferate.** More than two or three sibling override columns would mean the table is wrong often enough to reconsider (the same trigger DR-0004 names).
- **The Sheets write of the first population fails or is refused as too large.** Item 5 relies on roughly 3,050 single-cell updates fitting one batch. The feature-delta records this as unverified at the request-count level. If it fails, the contingency is to coalesce the contiguous new column into one multi-row update, which changes the request builder but not this decision.
