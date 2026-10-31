# Slice 03: Welcome to the Jungle mail is fetched into the cache without being lost

Story: US-03 (fetch into the cache) in `../feature-delta.md`. Job: J-001 (capture every advertised job in one tracker). Estimate: 1 day.

## Goal
`harvest fetch --source wttj --from <d> --to <d>` caches the sender's mail, commits each fully harvested day under that source, and never marks a day covered while one of its messages was set aside unreported.

## Why third
Premise P3: the truncation check in `slim` is LinkedIn-shaped (body under 1,024 characters, or no `/jobs/view/`), and the fetch loop commits a day even when it quarantined a message. A short three-card digest would be quarantined, not cached, and its day recorded as covered. This slice must exist before any real fetch.

## Learning hypothesis
Disproves: that a second sender can be fetched with the existing loop, ledger and cache unchanged. Fails if LinkedIn coverage moves, if a healthy digest is quarantined, or if a truncated one commits its day.
Confirms: that coverage is per source and the cache is shared by message id, so a second sender needs no new store (OQ-06, coverage and cache per sender).

## IN scope
- A descriptor-owned sanity check for truncated mail (shape is DESIGN's).
- `fetch --source <new id>` for the new descriptor; the sender probe names the sender when it matches nothing.
- Coverage committed under the new source id; LinkedIn intervals unchanged.
- Quarantine handling that cannot produce a covered day with a lost message (pending OQ-06).

## OUT of scope
- `update` (slice 04). The Sheet. Backfill depth beyond the earliest message available (OQ-09, backfill depth).
- Changing LinkedIn's truncation thresholds.

## Production data
A real Gmail run for the earliest days available (about 45 days, about 10 messages), by Dan, after the acceptance scenarios pass against the loopback Gmail fake with the slice-01 redacted fixture. The mailbox is personal data and is never committed.

## Done when
Five scenarios of US-03 pass. Dan's real fetch shows each listed message cached or reported, a build from the resulting cache gives the expected rows (slice 01), and LinkedIn's `coverage.json` entries are byte-identical.

## Dependencies
Slice 01 (extractor), slice 02 (yield). OQ-06 (quarantine and coverage), OQ-09 (backfill depth).

## Effort and reference class
1 day. Reference: `gmail-api-source` end to end was larger; this reuses its loop and changes one check.

## Privacy
Test messages are redacted fixtures. Fetch logs name ids and reasons only, never body content.
