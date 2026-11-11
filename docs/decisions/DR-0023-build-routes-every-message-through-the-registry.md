---
id: DR-0023
status: accepted
dateCreated: 2026-10-26
domain: job-alert-harvester
refines: DR-0006
relatedTo: [DR-0009, DR-0015]
changelog:
  - date: 2026-10-26
    version: 0.1.0
    note: Drafted by the DESIGN wave of welcome-to-the-jungle-source. Makes DR-0006 rules 2 and 5 true of the build path. The containment rule is the human's call (DISCUSS OQ-07). Not accepted.
  - date: 2026-10-27
    version: 1.0.0
    note: Accepted by the human on 2026-10-27 as the DESIGN architect recommended it.
---

# `build` routes every message through the registry and each row carries its source

## Context

DR-0006 (accepted) says unmatched messages are captured and reported (rule 2), that `core/harvest.mjs` is source-agnostic with its label taken from the descriptor (rule 5), and that the dedup key strategy is the descriptor's (rule 3). The code differs, and where a record and the code disagree the code is current truth.

- `harvest()` calls the LinkedIn extractor directly (`src/core/harvest.mjs:198`). The registry's `extractAll`, which builds the unmatched bucket, is called only from a test. A message from another sender in the cache produces no rows and no report.
- `Source` is the constant `'LinkedIn'` in the Jobs and Sources rows (`harvest.mjs:11,123,159`).
- The LinkedIn descriptor's `dedupKey` function reads `rawJob.id` (`src/core/sources/linkedin.mjs:16`), but rows carry no `id`; the parser writes `dedupKey` itself (`src/core/parse-linkedin.mjs:134`). The descriptor field is never called.

One further question arises with a less proven parser: LinkedIn's extractor throws when a card cannot be read, which fails the whole build. For the new source that would stop LinkedIn rows too (DISCUSS OQ-07).

## Options Considered

### Option A: `harvest()` calls `extractAll`, which tags every row and returns three lists (proposed)

Each row gets `sourceId` and `sourceLabel`. `extractAll` returns the rows, the unmatched messages (id and sender) and the unparsed messages (id, sender, source, reason). The build prints the last two on stderr.

- Advantage: the registry does its documented job; the yield and the Jobs rows get their source from the row.

### Option B: `harvest()` loops over descriptors itself

- Disadvantage: duplicates the registry and its unmatched handling.
- Verdict: rejected.

### Option C: leave LinkedIn wired directly and add a branch for the new source

- Disadvantage: the per-source branch that DR-0006 option 2 rejected.
- Verdict: rejected.

For containment of an unreadable message:

- Option X: contain for every source. Changes LinkedIn from a crash to a stderr line, which in an unattended 05:30 run is easy to miss.
- Option Y: contain only a coded refusal the new extractor throws; LinkedIn's plain error is not caught and behaves as now (proposed).
- Option Z: throw for all. A Welcome to the Jungle template change then blocks the build for both sources.

## Decision

Proposed: Option A, with containment Option Y. Containment is the human's call.

1. `harvest()` obtains rows through the registry. Its result gains `unmatched` and `unparsed` beside `searchYield`; the tab writers ignore both.
2. `Source` in the Jobs and Sources rows comes from the row's label. LinkedIn output is cell-for-cell unchanged.
3. The new source's extractor emits its own `dedupKey` from `fuzzyKey` over company, title and location, as the LinkedIn parser emits its key. Salary text is not in the key, because "Salary above your minimum" is relative to the recipient.
4. The descriptor's unused `dedupKey` field is flagged for removal or repair; this record does not change it.
5. Because the fetch-time screen is the descriptor's, a message that passed the screen is readable by its extractor (a property test per descriptor), so containment normally fires only after a code change.

Known risk: the sampled location was identical on all 197 cards, so the key is effectively company plus title and may merge two real adverts that share a title. The error is invisible in the Sheet; dogfood should count title groups whose salary text differs.

## Exceptions

Revisit if:

- A source needs a different row schema (DR-0006's own exception).
- Unparsed messages pile up unseen. An unparsed count would then make `update` exit non-zero.
- The registry passes a dozen sources and first-match ordering needs explicit priority (DR-0006).
