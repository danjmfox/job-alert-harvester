# Slice 01a: The build routes every message through the registry

Story: US-01a (registry routing) in `../feature-delta.md`. Job: J-001 (capture every advertised job in one tracker). Estimate: 0.5 day. Release R1 (rows offline).

## Goal
Dan runs the rebuild form on a folder holding LinkedIn fixtures plus a message from another sender. The Jobs rows are exactly what a LinkedIn-only build gives, and stderr names the message that no source claims.

## Why first
Premises P1 and P2: `harvest()` runs the LinkedIn reader on every message and writes `LinkedIn` into every `Source` cell. A second parser cannot be added honestly until the build can say which source produced a row and which messages nobody claimed. DR-0023 (registry routing) is accepted.

## Learning hypothesis
Disproves: that routing through the registry can leave LinkedIn output cell-for-cell identical. Fails if any LinkedIn cell in any tab differs.
Confirms: that a second source is one descriptor and one registry entry, as DR-0006 (registry descriptors are data) claims.

## IN scope
- The build asks the registry to claim each message.
- `Source` in Jobs rows comes from the label of the source that produced the row.
- An unclaimed message is reported by id and sender, and no row is invented for it.
- The report appears in the `--in` rebuild and in `build`.

## OUT of scope
- Any Welcome to the Jungle parsing (slice 01b), yield (slice 02), fetch (slices 03a and 03b), `update` (slice 04).
- Any Gmail or Sheets call. Any change to LinkedIn output.
- Repairing or removing the descriptor's unused `dedupKey` field (flagged by DR-0023, not changed here).
- Exact stderr wording (DISTILL).

## Production data
Existing synthetic LinkedIn fixtures plus one invented message from `newsletter@example.invalid`. No real mail is needed. See *Fixtures* in `../feature-delta.md`.

## Done when
The three scenarios of US-01a pass, every LinkedIn fixture builds cell-for-cell as before, and the new behaviour is pinned by an acceptance test that fails if the routing is removed.

## Dependencies
None upstream. DR-0023 is accepted.

## Effort and reference class
0.5 day. Reference: the LinkedIn descriptor wrap, which was about a day end to end and included a parser.

## Privacy
Fixtures are synthetic. No real body, token or tracking link.
