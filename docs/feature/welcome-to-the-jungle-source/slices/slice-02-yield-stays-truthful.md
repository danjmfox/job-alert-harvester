# Slice 02: The search yield stays truthful with a second source present

Story: US-02 (yield stays truthful) in `../feature-delta.md`. Job: J-002 (know which alert searches earn their place). Estimate: 0.5 to 1 day.

## Goal
With Welcome to the Jungle adverts in the cache, `harvest build --dry-run` prints LinkedIn's per-search figures exactly as before and shows the new source on its own labelled row.

## Why second
Once real Welcome to the Jungle mail is cached (slice 03), every build, including the 05:30 one, reads it. Without this slice the new adverts fall into the `(no search term)` row by DR-0015 rule 3 (search yield is derived in `harvest()`), raise its `other` share, and blur the comparison Dan uses to edit LinkedIn searches.

## Learning hypothesis
Disproves: that DR-0015's single unparsed bucket can absorb a source that never has a search term. Fails if any LinkedIn figure changes when a digest from the new source is added, or if the total no longer equals the Jobs row count.
Confirms: that the per-search yield generalises by source without changing the pure function's inputs.

## IN scope
- A per-source term-less row (OQ-05 recommends it), `unique` shown `-`, never counted as another search.
- The reconciliation: total found equals Jobs rows; total `other` equals Jobs rows with Role Family `other`.
- The existing stderr-only rule.

## OUT of scope
- A `--since` option, persisted figures, Sources-tab columns (DR-0015 Exceptions).
- Any change to how LinkedIn searches are counted.
- Sources-tab rows for the new source (no search term, DR-0006 rule 4).

## Production data
The slice-01 redacted fixture beside the existing synthetic LinkedIn cohorts. Dogfood: `harvest --in <scratch folder with Dan's LinkedIn cache copy plus one real digest> --out scratch.xlsx`; compare the LinkedIn rows by eye with a LinkedIn-only run.

## Done when
The four scenarios of US-02 pass and the Y4-style reconciliation tests for LinkedIn pass unmodified.

## Dependencies
Slice 01 (rows to count). OQ-05 (yield treatment), which amends DR-0015 rule 3 if accepted.

## Effort and reference class
0.5 to 1 day. Reference: `search-yield-summary`'s own unparsed-row work.

## Privacy
Fixtures are redacted as in slice 01. No raw body, token or tracking link.
