# Slice 01: One Welcome to the Jungle digest becomes all of its jobs as rows

Story: US-01 (a digest becomes all of its jobs as rows) in `../feature-delta.md`. Job: J-001 (capture every advertised job in one tracker). Estimate: 1 day, after the half-day spike if the human takes OQ-01 (HTML spike).

## Goal
Dan runs the rebuild form on a folder holding one real digest and gets one Jobs row per card, labelled with the new source, without touching his cache or his Sheet.

## Why first (F1)
The sample message's subject names one job and its body carries three. A slice that parsed the subject would ship one row in three, the exact loss DR-0006 (registry descriptors are data) was written to make unrepresentable. The slice is the digest, not the job.

## Learning hypothesis
Disproves: that the plain-text rendering is enough to recover, per card, the employer alone, the title, and the location. If the employer arrives fused to its tagline, or the title fuses to the location, the fuzzy dedup key is unstable and every resend duplicates. Failure means the HTML must be read, the cache record shape widens (OQ-02, cache holds HTML?), and this slice is redone.
Confirms: that a second source is one descriptor and one registry entry, as DR-0006 claims, once the build actually routes through the registry (premise P1).

## IN scope
- A Welcome to the Jungle descriptor: `matches` on the sender, `extract` returning an array, a fuzzy `dedupKey`, a `label`.
- `harvest()` routes messages through the registry and takes the `Source` label from the descriptor.
- An unclaimed message is reported by id and sender, and is never dropped.
- Role Family and fit derived from the title as for LinkedIn. No new pattern.
- Redacted fixture of one real message in the cache record shape.

## OUT of scope
- Salary (US-05), yield (US-02), fetch (US-03), `update` (US-04).
- Any Gmail or Sheets call. Any change to LinkedIn output.
- Resolving Advert Link: store what the card carries (OQ-04). Never commit it.
- Cross-source duplicate detection.

## Production data
A real digest, redacted by the rule in `../feature-delta.md` (*Fixture Redaction*): URLs replaced by `https://example.invalid/<n>`, tokens removed, recipient name and message id invented. The unredacted original stays outside the repository. Dogfood: the same command on the unredacted original, in a scratch folder, inspected by Dan the same day.

## Done when
Seven scenarios of US-01 pass, the LinkedIn fixtures build cell-for-cell as before, and Dan's dogfood run shows the right number of cards as rows with employers alone in `Company`.

## Dependencies
OQ-01 (HTML spike), OQ-04 (Advert Link), OQ-07 (unreadable card). Tracked.

## Effort and reference class
1 day. Reference: the LinkedIn descriptor wrap and `search-yield` additions, each about a day end to end. Uncertainty is concentrated in one question, which the spike answers first.

## Pre-slice spike (human's call)
Half a day, local. Read the HTML of up to five messages and record structure only: the delimiter between employer and tagline, between title, salary and location, whether any job id or direct advert link exists, the range of location values, card counts per message. Write findings into the feature delta without content.

## Privacy
Real message content is personal data. This brief, the fixture and the tests carry no raw body, token or tracking link.
