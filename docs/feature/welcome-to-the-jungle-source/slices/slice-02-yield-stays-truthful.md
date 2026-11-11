# Slice 02: The search yield stays truthful with a second source present

Story: US-02 (yield stays truthful) in `../feature-delta.md`. Job: J-002 (know which alert searches earn their place). Estimate: 0.5 to 1 day. Release R2 (fetch and count), first in that release.

## Goal
With Welcome to the Jungle adverts in the cache, `harvest build --dry-run` prints LinkedIn's per-search figures exactly as before and shows the new source on its own labelled row.

## Why second
Once real Welcome to the Jungle mail is cached (slices 03a and 03b), every build, including the 05:30 one, reads it. Without this slice the new adverts fall into the `(no search term)` row by DR-0015 rule 3 (search yield is derived in `harvest()`), raise its `other` share, and blur the comparison Dan uses to edit LinkedIn searches.

## Learning hypothesis
Disproves: that DR-0015's single unparsed bucket can absorb a source that never has a search term. Fails if any LinkedIn figure changes when a digest from the new source is added, or if the total no longer equals the Jobs row count.
Confirms: that the per-search yield generalises by source without changing the pure function's inputs.

## IN scope
- A per-source term-less row, labelled `(no search term) Welcome to the Jungle` (38 of the 40 characters the column holds), `unique` shown `-`, never counted as another search. LinkedIn's term-less row keeps its label. Decided by DDD-11 (per-source term-less row, accepted 2026-10-27), which resolves OQ-05 (yield treatment).
- The reconciliation: total found equals Jobs rows; total `other` equals Jobs rows with Role Family `other`.
- The existing stderr-only rule.

## OUT of scope
- A `--since` option, persisted figures, Sources-tab columns (DR-0015 Exceptions).
- Any change to how LinkedIn searches are counted.
- Sources-tab rows for the new source (no search term, DR-0006 rule 4).

## Production data
The slice-01b synthetic fixture beside the existing synthetic LinkedIn cohorts. Dogfood: `harvest --in <scratch folder with Dan's LinkedIn cache copy plus one real digest> --out scratch.xlsx`; compare the LinkedIn rows by eye with a LinkedIn-only run.

## Done when
The four scenarios of US-02 pass and the Y4-style reconciliation tests for LinkedIn pass unmodified.

## Dependencies
Slice 01a (each row carries its source) and slice 01b (rows to count). A refinement of DR-0015 rule 3 (term-less sightings in one row) is raised at this slice.

## Effort and reference class
0.5 to 1 day. Reference: `search-yield-summary`'s own unparsed-row work.

## Privacy
Fixtures are synthetic reconstructions as in slice 01b. No real body, token or tracking link.
