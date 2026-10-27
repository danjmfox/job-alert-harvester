# fix-ledger-merge-ignores-source — Evolution Record

**Type**: Explanation. **Finalized**: 2026-10-27. **Workspace**: `docs/feature/fix-ledger-merge-ignores-source/` (kept as delivery history; `rca.md` and `deliver/roadmap.json` sit in it).

Assumed background: the coverage ledger (`.cache/coverage.json`) is a list of closed day intervals, each tagged with a `source`, and the fetch planner treats any day inside an interval as already fetched (DR-0002, coverage intervals not a watermark).

## What was wrong

`mergeIntervals` in `src/core/coverage.mjs` merged by date only and ignored `source`. A commit from a second source would be absorbed into a LinkedIn interval, extend its end date, or replace it. The fetch planner would then treat unfetched LinkedIn days as covered, which is silent data loss.

The defect was latent. The real ledger holds one LinkedIn entry, so nothing had gone wrong. It was found by reading during the DESIGN wave of welcome-to-the-jungle-source (contradiction K-1 in `docs/feature/welcome-to-the-jungle-source/feature-delta.md:616`) and reproduced by execution in `docs/feature/fix-ledger-merge-ignores-source/rca.md`.

## What shipped

Rule 1 only of DR-0022 (a coverage commit claims only its own days): `docs/decisions/DR-0022-coverage-commit-claims-only-its-own-cached-days.md`. `mergeIntervals` (`src/core/coverage.mjs:85`) now collapses overlapping and adjacent intervals within each source, never across sources, and orders the result by `from`, then source. An absent source sorts first and sources compare by code point. The human decided that ordering on 2026-10-27.

`mergeTwo` and `src/adapters/ledger-store.mjs` are unchanged. A single-source or legacy ledger merges as before.

Three commits on `fix/ledger-merge-ignores-source`:

- `caf1018` (fix and regression tests).
- `3127af7` (refactor: a quadratic Map rebuild became a distinct-source filter).
- `5c7186c` (two test titles and two variable names).

## Tests

- 3 store-level tests in `tests/integration/job-alert-harvester/ledger-store-source-isolation.test.mjs`.
- 3 core examples, 2 fast-check properties and 2 pinned single-source and legacy cases in `tests/acceptance/job-alert-harvester/coverage.test.mjs`.
- All 7 tests that should fail before the fix were seen to fail. The main instance restored the old `coverage.mjs` temporarily to prove it.
- Full suite at close: 93 files, 1,595 tests passed. The previous record (`docs/evolution/2026-10-06-install-subcommand.md`) closed at 92 files and 1,584 tests. Other work may have landed since, so the baseline for this fix alone was not measured.
- `des-verify-integrity`: "All 1 steps have complete DES traces".

## Process facts worth keeping

- The roadmap was reviewed twice. The first review was NOT PASS on three specification gaps. The second was PASS.
- The refactor crafter could not log a refactor phase in DES without altering the step 01-01 record, so none was logged.
- The adversarial reviewer (Haiku) found no correctness defect and rejected on minor points. Two were fixed in `5c7186c`.
- Three review points were deliberately left: grouping uses a Set and filter, not the Map the roadmap notes named (same behaviour, and a source literally named "undefined" still does not collide; O(sources x intervals) is harmless at ledger size); generator coverage of cross-source adjacency relies on explicit examples; the `rank` helper in the property test is an independent encoding.

## Not done

- **DR-0022 rule 2** (a quarantined message blocks its day) and **rule 3** (a commit claims only fully cached days) belong to later welcome-to-the-jungle-source slices.
- **Repairing a corrupted ledger.** This fix cannot repair a ledger already merged across sources. None exists.
- **Mutation testing** was skipped, per the project's `nightly-delta` strategy.

## Stale-doc candidates, left as they are

Both documents are point-in-time, so they are listed here and not edited.

- `docs/decisions/DR-0002-coverage-intervals-not-a-watermark.md:186` says "Adjacent intervals should be merged on commit". It now means per source.
- The brief's decision index row for DR-0002 (`docs/product/architecture/brief.md`) could note that DR-0022 refines it.
