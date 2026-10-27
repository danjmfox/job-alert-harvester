---
id: DR-0022
status: accepted
dateCreated: 2026-10-26
domain: job-alert-harvester
refines: DR-0002
relatedTo: [DR-0003, DR-0016]
changelog:
  - date: 2026-10-26
    version: 0.1.0
    note: Drafted by the DESIGN wave of welcome-to-the-jungle-source. Rule 2 changes LinkedIn fetching, so it needs the human's explicit yes. Not accepted.
  - date: 2026-10-27
    version: 1.0.0
    note: Accepted by the human on 2026-10-27 as the DESIGN architect recommended it.
  - date: 2026-10-27
    version: 1.1.0
    note: Rule 1 implemented by commit caf1018 on branch fix/ledger-merge-ignores-source (regression tests included); rules 2 and 3 are not yet implemented.
---

# A coverage commit claims only its own source's days, and only days whose messages are all cached

## Context

The coverage ledger (`.cache/coverage.json`, DR-0002) is a list of closed intervals `{ source, from, to, completedAt, messageCount }`. DR-0002 says an interval is written only when its window is exhausted: every id the search returned has a record in the cache.

Two things in the code break that once a second sender exists. Neither has been executed, because the DESIGN run had no shell; both are read from the code.

**Rule 1 problem: the merge ignores the source.** `ledger-store.commit` merges the new interval with every stored interval (`src/adapters/ledger-store.mjs:62`). `mergeIntervals` (`src/core/coverage.mjs:61-71`) joins any overlapping or day-adjacent intervals, and `mergeTwo` (`:54-58`) keeps the first interval's `source` and adds the message counts. Take an invented ledger holding LinkedIn for 2026-06-15 to 2026-10-24 and commit one Welcome to the Jungle day, 2026-09-11. The two overlap, so the result is a single LinkedIn interval, the new source's day vanishes, and LinkedIn's message count is inflated. Commit a Welcome to the Jungle day of 2026-10-25 and the LinkedIn interval's end becomes 2026-10-25, claiming a LinkedIn day that was never fetched. No current test commits a second source through the store; tests that use another source write the ledger file directly.

**Rule 2 problem: a quarantined message counts as cached.** In `src/cli/fetch-loop.mjs`, a message that `slim` quarantines is added to a set that the completeness check treats as satisfied (lines 53 to 65), and the day is committed (67 to 73). The quarantine is logged (line 55) but the day is recorded as fully harvested without that message.

## Options Considered

For rule 1:

- Option 1A: `mergeIntervals` groups by `source` internally (proposed). Every caller is protected, and a ledger with one source behaves as now.
- Option 1B: only `ledger-store.commit` partitions by source. Leaves the other callers exposed.
- Option 1C: one ledger file per source. Changes layout, probe and migration for no gain once 1A holds.

For rule 2:

- Option 2A: a quarantined message blocks its day for every source (proposed). The loop refuses with `fetch.message-quarantined`, naming ids and reasons; other messages in the day are still cached, so a retry is cheap.
- Option 2B: block only for the new source. Needs a per-source policy flag on the descriptor, which DR-0006 rule 1 argues against.
- Option 2C: commit the day and keep the quarantined payload locally. Coverage then claims a day with a missing message.

## Decision

Proposed: 1A and 2A.

1. `mergeIntervals` merges only intervals of the same `source`. Committing one source's interval leaves every other source's entries unchanged. This is a defect fix and not a preference.
2. A coverage commit happens only if every message the listing returned is in the cache. A quarantined message is not in the cache.
3. The screen that decides quarantine belongs to the source's descriptor (a function from message to reason or nothing). LinkedIn's screen is its existing rules, unchanged.
4. Gmail is the retention for a quarantined message: the day stays uncovered and the next run re-reads it.

Consequences: a persistent bad message wedges its day and, under DR-0016, stops `update` before the build until the screen or the template is fixed. This also applies to LinkedIn: a LinkedIn digest that is too short, or has no advert link, now stops the run where before it was logged and skipped. The failure line names the ids.

## Exceptions

Revisit if:

- A wedged day happens in practice. An operator escape (for example, an explicit accept of a named message) would then be needed.
- One day stops being exhaustible in a pass (DR-0002's own exception).
- Sources are added until per-source stops are unacceptable to the build; then DR-0016's rule that any failure stops the build needs a second look.
