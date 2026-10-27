# RCA: the coverage ledger merge ignores `source`

**Type:** Explanation
**Date:** 2026-10-27
**Author:** `@nw-troubleshooter` (root cause chain, reproduction scripts), reproduced independently by the main instance, which re-ran both scripts and got the same output.

## Summary

`mergeIntervals` in `src/core/coverage.mjs` collapses overlapping or day-adjacent intervals by date alone. When a second source commits coverage, its interval is absorbed into LinkedIn's, extends LinkedIn's `to` over days LinkedIn never fetched, or (if it sorts first) replaces LinkedIn's entry. The fetch planner then treats the unfetched days as covered, so that mail is never fetched. The defect is latent: the real `.cache/coverage.json` holds one LinkedIn entry, and no second source commits yet.

## Reproduction

Ledger input: LinkedIn 2026-06-15 to 2026-10-24 (100 messages), plus one commit from a second source called `wttj`. Run against temp files, never the real ledger.

| Case | Result |
|---|---|
| `wttj` 2026-09-11 (inside LinkedIn's range, 3 messages) | One LinkedIn entry, 100+3 messages. The `wttj` entry is gone. |
| `wttj` 2026-10-25 (adjacent) | One LinkedIn entry now ending 2026-10-25, a day it never fetched. |
| `wttj` 2026-06-10 to 2026-06-14, committed before LinkedIn | One `wttj` entry 2026-06-10 to 2026-10-24. LinkedIn's coverage is deleted. |

Through the real `createLedgerStore` the second case is written to disk and read back. The LinkedIn planner's `nextUncoveredDay` for 2026-10-20 to 2026-10-26 returns 2026-10-25 before the `wttj` commit and 2026-10-26 after it.

## Root cause chain

1. LinkedIn coverage gains days it never fetched, or loses its entries.
2. `mergeTwo` (`src/core/coverage.mjs:54-58`) keeps the first interval's fields, takes the later `to` and sums `messageCount`. Adjacency in `mergeIntervals` (`:52`, `:66`) is by date only.
3. `ledger-store.commit` (`src/adapters/ledger-store.mjs:62`) merges the new interval with the whole stored ledger, whatever the source.
4. The interval type carries `source` (`coverage.mjs:5`) but the merge never reads it. The module was written when only LinkedIn existed.
5. The single-source assumption was never enforced where the data is written. Every reader filters by source before use; the writer was missed.

## Why no test caught it

`anInterval` in `tests/acceptance/job-alert-harvester/support/domain-types.mjs:49` defaults `source` to `'linkedin'`, so every merge and commit test is single-source. The property tests in `coverage.test.mjs` generate intervals with no `source`.

## Callers

Only the write path is wrong. `earliestCoveredDay` and `uncoveredDaysWithin` (`update-plan.mjs`), the fetch loop, `harvest.mjs` and `baselineWarning` (`install-plan.mjs`) all filter by source before they merge or subtract. `subtractCoverage` calls `mergeIntervals` internally and is safe only because its callers pre-filter.

## Fix (DR-0022 rule 1, grouping)

Change `mergeIntervals` only: group by `source` (an undefined `source` is one group), run the existing sort and reduce inside each group, concatenate. Order the result by `from`, then by `source`. A single-source or legacy ledger comes out byte-identical to today. `mergeTwo` and `ledger-store.mjs` do not change.

Ordering by `from` then `source` was the human's decision on 2026-10-27, matching the existing sort by `from`.

## Out of scope

DR-0022's other rules (a quarantined message blocks its day; a commit claims only days whose messages are all cached) belong to the W2tJ slices. An already corrupted multi-source ledger cannot be repaired by this fix; none exists today.

## Regression tests

1. Through the real ledger store: seed LinkedIn 2026-06-15 to 2026-10-24, commit `wttj` 2026-10-25. The returned and stored ledger holds both entries, LinkedIn's `to` unchanged, counts unchanged. A second case commits `wttj` 2026-09-11 and keeps it as its own entry.
2. After the first commit, the LinkedIn-filtered `nextUncoveredDay` for 2026-10-20 to 2026-10-26 still returns 2026-10-25.
3. Property: for mixed-source intervals, `mergeIntervals` preserves each source's day set and message-count sum.

## Unverified

Behaviour on Node versions without `Object.groupBy` (this machine runs Node 24.22.1). Whether any evolution record states an expected ledger order.
