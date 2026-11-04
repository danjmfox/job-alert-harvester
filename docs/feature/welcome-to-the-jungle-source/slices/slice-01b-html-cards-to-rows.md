# Slice 01b: A Welcome to the Jungle digest becomes all of its jobs as rows

Story: US-01b (HTML cards to rows) in `../feature-delta.md`. Job: J-001 (capture every advertised job in one tracker). Estimate: 1 to 1.5 days. Release R1 (rows offline).

## Goal
Dan runs the rebuild form on a folder holding one synthetic HTML-only digest and gets one Jobs row per card, each labelled `Welcome to the Jungle`, with the employer alone in `Company`, without touching his cache or his Sheet.

## Why it carries the risk
The sample digest's subject names one job and its body carries up to three (finding F1). A slice that parsed the subject would ship one row in three. The messages also have no plain-text part, so the existing reader refuses them. This is the riskiest slice of the feature.

## Learning hypothesis
Disproves: that the card fields (employer, tagline, title, salary text, location) sit in positions stable enough to be read separately. The spike found them identical across 100 messages from one template over one period. Fails if a card is read with fused or shifted fields, or if the same job resent gets two keys.
Confirms: that an in-repo reader is enough for one known template (DR-0021, HTML scanning), and that the key from employer, title and location is stable across resends (DDD-09, fuzzy key without salary).

## IN scope
- A Welcome to the Jungle source: matches the sender, returns one advert per card, labelled `Welcome to the Jungle`.
- Reading the HTML of an HTML-only cached record (DR-0019, HTML read path; DR-0020, cache form).
- The card's link stored in `Advert Link`; never requested, never committed (DDD-13, store the card link).
- An unreadable message reported by id and reason; other messages still build. LinkedIn behaviour for an unreadable message is unchanged (DDD-10).
- Role Family and fit from the title as for LinkedIn. No new pattern.
- The synthetic fixture set from *Fixtures* in `../feature-delta.md`.

## OUT of scope
- Salary cells (slice 05), yield (slice 02), fetch (slices 03a and 03b), `update` (slice 04).
- Any Gmail or Sheets call. Any change to LinkedIn output.
- Cross-source duplicate detection.
- The method of reading HTML. Acceptance criteria stay behavioural; DESIGN owns the method.

## Production data
Synthetic reconstructions only. Dogfood after slice 03b: the same command on a scratch folder of real mail kept outside the repository, inspected by Dan the same day. In that run count title groups whose salary text differs (risk R-1 in DESIGN: two real adverts merged on one title).

## Done when
Six scenarios of US-01b pass, the LinkedIn fixtures build cell-for-cell as before, and the scan cost per message is measured and recorded against DR-0001's budget (DR-0020 rule 5), and a property shows that whatever the descriptor's screen accepts, its extractor reads without error (DDD-16, screen-implies-extract).

## Dependencies
Slice 01a (a row needs a source). OQ-01, OQ-02, OQ-04 and OQ-07 are answered.

## Effort and reference class
1 to 1.5 days. Reference: the LinkedIn parser and its card tests. The new reader is a new file and a new scanner, so the upper bound is realistic.

## Privacy
Real message content is personal data. This brief, the fixtures and the tests carry no real body, token or tracking link.
