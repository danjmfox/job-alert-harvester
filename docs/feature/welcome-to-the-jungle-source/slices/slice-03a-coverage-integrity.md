# Slice 03a: A day is recorded as harvested only when all its messages are cached

Story: US-03a (coverage integrity) in `../feature-delta.md`. Job: J-001 (capture every advertised job in one tracker). Estimate: 0.5 to 0.75 day. Release R2 (fetch and count).

## Goal
A coverage commit claims a day only if every message Gmail listed for it is in the cache. A message the fetch loop sets aside leaves its day uncovered, is named in the run, and is read again next time.

## Why before any real fetch
Premise P3: the fetch loop treats a quarantined message as satisfied and commits the day. That is silent loss with a clean ledger, and it already applies to LinkedIn. DR-0022 (coverage commit, accepted) rule 1 (ledger merge per source) shipped in PR 13. This slice is rules 2 and 3 only: commit claims only fully cached days, and each source's descriptor owns the check that sets a message aside.

## Learning hypothesis
Disproves: that the quarantine allowance in the commit decision can be removed without breaking a healthy LinkedIn fetch. Fails if a healthy day stops committing, or if a LinkedIn day with a set-aside message still commits.
Confirms: that Gmail is enough retention for a set-aside message (DR-0022 rule 4).

## IN scope
- No coverage commit while any listed message is not in the cache, for every source.
- The run names each set-aside message by id and reason.
- The healthy messages of that day are still cached.
- LinkedIn's rules move behind its descriptor with their logic unchanged, except that a record with no plain-text body is set aside and reported instead of throwing (DR-0019, HTML read path, rule 3).
- A quiet day is still recorded with zero messages.

## OUT of scope
- Ledger merge per source (shipped in PR 13). It stays as a guard in slice 03b.
- HTML-only messages and the Welcome to the Jungle check (slice 03b).
- An operator escape from a wedged day (deferred to DISTILL or DELIVER; revisit if a wedge happens).
- Changing LinkedIn's thresholds.

## Production data
Loopback Gmail fake with synthetic LinkedIn alerts: one healthy, one too short. No real mail.

## Done when
Three scenarios of US-03a pass, and the set-aside scenario is the first RED test, seen failing before the change.

## Dependencies
None upstream. Slice 02 lands first within release R2 by the human's cut.

## Effort and reference class
0.5 to 0.75 day. Reference: the fetch loop's own acceptance tests; the change removes one allowance.

## Risks
Behaviour change for LinkedIn fetching, not LinkedIn rows. A persistent bad LinkedIn message now wedges its day and, under DR-0016 (update owns the sequence), stops `update` before the build. Accepted with DR-0022.

## Privacy
Fetch logs name ids and reasons only. No real body, token or tracking link.
