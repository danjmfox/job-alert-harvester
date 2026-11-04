# Slice 03b: A Welcome to the Jungle message with only HTML is fetched into the cache

Story: US-03b (HTML-only fetch) in `../feature-delta.md`. Job: J-001 (capture every advertised job in one tracker). Estimate: 0.5 to 0.75 day. Release R2 (fetch and count).

## Goal
`harvest fetch --source wttj --from <d> --to <d>` caches the sender's HTML-only mail, records each fully harvested day under that source, and leaves LinkedIn coverage untouched.

## Why now
Every Welcome to the Jungle message is HTML only. The Gmail reader refuses a message with no plain-text part, so a fetch stops with an error before anything is cached. DR-0019 (HTML read path, accepted) makes the record carry the HTML when there is no text part. Slice 03a already guarantees that a set-aside message leaves its day uncovered.

## Learning hypothesis
Disproves: that a second sender can share the cache and the ledger. The ledger merge was fixed in PR 13; this slice proves it through a real fetch. Fails if LinkedIn intervals move, if a healthy digest is set aside, or if a digest with a broken card commits its day.
Confirms: that the shared cache keyed by message id and coverage per source (DR-0022, DDD-06) need no new store.

## IN scope
- A message with no plain-text part is cached with its HTML; a message with a plain-text part is cached exactly as before.
- The new source's own check: judges card structure, not length; sets aside a message with no readable card or a card missing employer or title.
- `fetch --source wttj`; the sender probe names the sender when it matches nothing.
- Coverage committed under the new source id.

## OUT of scope
- `update` (slice 04). The Sheet. Backfill depth beyond the earliest available message (OQ-09, unreconciled volume).
- Calling the click-tracking link. No code requests it.
- Whether the neither-part refusal keeps its code (DISTILL; existing tests assert it).

## Production data
Loopback Gmail fake with a synthetic HTML-only payload from the fixture set. Dogfood by Dan after the scenarios pass: a real fetch for the earliest days available, then a build from the resulting cache (slice 01b). First reconcile volume with a count; the earlier "about 10 messages" and the spike's 100 disagree. The mailbox is personal data and is never committed.

## Done when
Five scenarios of US-03b pass, and a property shows that whatever the descriptor's screen accepts, its extractor reads without error (DDD-16, screen-implies-extract). Dan's real fetch shows each listed message cached or reported, the build gives the expected rows, and LinkedIn's `coverage.json` entries are byte-identical.

## Dependencies
Slice 03a (coverage integrity), slice 01b (extractor), slice 02 (yield).

## Effort and reference class
0.5 to 0.75 day. Reference: `gmail-api-source`, which this reuses with one more part lookup.

## Privacy
Test messages are synthetic. Fetch logs name ids and reasons only.
