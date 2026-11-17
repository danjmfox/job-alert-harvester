---
id: DR-0024
status: proposed
dateCreated: 2026-11-17
domain: job-alert-harvester
refines: DR-0015
relatedTo: [DR-0006, DR-0023]
changelog:
  - date: 2026-11-17
    version: 0.1.0
    note: Drafted after slice 02 of welcome-to-the-jungle-source was delivered (PR 19). Records what the code now does and the window decision the human took on 2026-11-17. Not accepted.
---

# Each source without a search term gets its own row in the search yield

## Context

DR-0015 (search yield derived in `harvest()` and printed, never stored) rule 3 says that sightings with no parsable search term form one labelled row, excluded from the unique figures. That was written when LinkedIn was the only source. Welcome to the Jungle alerts never carry a search term, so with a second source in the cache every one of its adverts would fall into LinkedIn's `(no search term)` row, raise its `other` share and blur the per-search comparison the yield exists to give (job J-002, know which alert searches earn their place).

DR-0023 (build routes every message through the registry) made each row carry `sourceLabel`, so the yield function can tell the sources apart without a new input. Slice 02 delivered the change in `src/core/search-yield.mjs` (PR 19). This record states the rule it implements, in place of rule 3's single row.

## Options Considered

### Option A: one term-less row per source (implemented)
- LinkedIn's row keeps its label `(no search term)`. Each other source gets `(no search term) <source label>`, shown after it and before `all searches`, with `unique` shown as `-`.
- Advantage: LinkedIn figures do not move when another source is cached, and each source's share is visible.
- Disadvantage: a longer label can exceed the 40-character label column and is then cut with an ellipsis. `(no search term) Welcome to the Jungle` is 38 characters.

### Option B: one merged term-less row for every source
- Advantage: no new row and no new field.
- Disadvantage: LinkedIn's term-less share changes the day a second source is cached, and the row cannot say which source it counts.
- Verdict: rejected.

### Option C: leave the other source out of the yield
- Advantage: the block stays as it was.
- Disadvantage: the yield total would no longer equal the number of Jobs rows, a reconciliation the yield tests check.
- Verdict: rejected.

## Decision

**Each source with sightings that have no search term gets its own labelled row in the yield block. LinkedIn's row keeps its label.**

1. A term-less sighting with no `sourceLabel`, or with the LinkedIn label, stays in the existing `unparsed` field and the `(no search term)` row. This keeps LinkedIn-only output identical in shape and figures.
2. Term-less sightings from any other source are grouped by `sourceLabel`, sorted by label, and returned in an additive `unparsedBySource` list. The list is present only when another source has such sightings.
3. Each of these rows is excluded from the unique figures, is not counted as a named search, and so does not affect the rule that a block needs two named searches to print.
4. The total still counts every distinct advert, so it equals the Jobs rows, and the total `other` equals the Jobs rows with Role Family `other`.
5. The 28-day window (DR-0015 rule 4) stays anchored on the latest sighting date across all sources. Decided by the human on 2026-11-17.

## Exceptions

Revisit if:
- A Welcome to the Jungle digest is newer than every LinkedIn sighting and the shift in LinkedIn's recent block misleads. In that case the window moves later, LinkedIn's last days drop out and the `to <date>` heading changes. Anchoring the window on LinkedIn sightings only would avoid it, at the cost of a source filter on the date list. No test pins this case.
- An old digest makes a recent block appear where a LinkedIn-only run printed none, because the "cache spans more than 28 days" check also uses every source's sightings.
- A third source has a label long enough to be cut in the label column.
