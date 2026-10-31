# Spike findings: Welcome to the Jungle alert HTML structure

Type: Reference (probe evidence). Date: 2026-10-26. Phase 1 PROBE only, discarded afterwards.

## Question (OQ-01)

Does the Welcome to the Jungle (W2tJ) alert HTML separate company, company tagline, job title, salary text and location per card? Does it carry anything stable (job id, slug, canonical URL, data attribute) that the plain-text rendering lacks?

## Verdict: PARTIAL

- WORKS: per-field extraction. Every card has company, tagline, title, salary and location in separate, positionally fixed elements, identical across 100 messages.
- DOESN'T WORK: a stable per-job key. No job id, slug, data attribute or readable URL exists in the HTML. The card link is an opaque SendGrid click-tracking token.
- ALSO DISCOVERED (blocking): the messages have no `text/plain` part. The existing Gmail adapter refuses such a message (`gmail.missing-plaintext-body`), and the slim rules would quarantine the HTML. The "plain text" seen earlier through the Gmail connector was the connector's own conversion of the HTML.

## Method

Five messages were fetched read-only with the project's own Gmail modules (`format=full`): the Metabase one (subject dated 2026-10-09) plus the four most recent (2026-10-18 to 2026-10-23). To test variety, the same query was then re-read in memory for 100 messages (nothing saved) and only structure counts were taken. No link in any email was requested. Raw messages and scripts were deleted afterwards.

The probe read 95 more messages than the 5 the brief named. It was read-only and stored nothing.

## Evidence per item

1. **HTML part.** Single `text/html` part (43 to 65 KB), no multipart. Stripo-generated nested tables with `es-*` classes and inline styles. No `data-*` attributes, no ids on cards.
2. **Per-card fields.** A card is `a[href] > table.es-content-body > tbody.greyHover`. Inside: a logo `img`; paragraph 1 holds `<strong>` Company; paragraph 2 holds the tagline as plain text; paragraph 3 holds `<strong>` Title, a `<br>`, then an `<em>` with one or two `<br>`-separated lines: `[salary,] location`. Tell the lines apart by line count, not by regex. 100 of 100 messages were identical (154 one-line `em`, 43 two-line).
3. **Stable id: none.**
   - The href is `https://<sendgrid-host>/ls/click?upn=u001.<token>`, with `upn` as the only query key and about 1,110 to 1,140 characters.
   - The token decodes to about 830 to 850 bytes, about 38 percent printable, with no `http` inside. It is opaque: the target is not recoverable offline, and whether it carries a job id is unknown.
   - The token differs per card, probably per recipient and per send.
   - The logo `src` is `storage.googleapis.com/<12>/<16>/<~52>` with no query. It looks like a company-level hash. Its stability across sends is unverified.
   - Image alt text is not the company name. There is no preheader text.
   - The subject is `New match: <title> at <company>`. It matched card 0 in 3 of 5 messages. The cause of the other 2 was not investigated.
4. **Card versus non-card.** Non-card content: the header logo link, an h1 greeting (plural for 2 or 3 cards, singular for 1), a "See all top matches" button (a single link, no extra jobs), a Never/Weekly/Daily menu, a "Change email frequency" button, and footer manage and unsubscribe links. Cards per message: 1, 2 or 3, in 37, 29 and 34 of 100 messages. `greyHover` also appears once in a CSS rule, so match the anchor-wrapped table.
5. **Salary.** Always its own `em` line, never fused with location. Forms seen across 197 cards:
   - absent: 154
   - "Salary above your minimum": 7
   - "Salary: $NNN-NNNK": 22
   - "£NNN-NNNK": 10
   - "£NNNK" (single value): 2
   - "€NNN-NNNK": 2
6. **Size and slim.** HTML is 42,984 to 64,847 characters, so the 1,024-character minimum is not the problem. `toMessage` (`src/core/gmail-message.mjs`) defines the refusal `gmail.missing-plaintext-body`. HTML fed to slim would give `slim.no-advert-link`, because `/jobs/view/` appears in no href.
7. **Plain-text part.** Absent in all 100 messages (mime `text/html` only). The fused line seen earlier was the connector's conversion.
8. **Surprises.** One template family; size varies only with card count, and the two greeting variants track card count. All 197 locations read "Remote (within the UK)", probably because of the saved search (unverified), so location diversity is untested. English only; currencies $, £ and €.

## Edge cases

- 1 to 3 cards per message. No salary is the majority case. Salary may be a range, a single value or generic text, in several currencies.
- Titles and taglines contain HTML entities (`&amp;` seen). Decode before comparing.
- The subject may not equal card 0.
- The `es-*` classes come from the email builder and may change on a re-theme. Uniformity is shown only over the sampled period.

## Design implications for DESIGN

- The adapter must read the `text/html` part. `toMessage` assumes plain text, so this changes an existing contract and needs a decision record.
- The dedup key must come from extracted fields: normalised company, title and location, perhaps salary text. A re-posted role splits into two keys, and two same-title roles in one city collide. Recurrence of the same triple across messages was not tested.
- The link target is unrecoverable offline, and requesting it registers a click. DESIGN decides whether to keep the link.
- OQ-02 (cache form): raw HTML is 40 to 65 KB per message, about 5 MB per 100, and allows re-parsing. A structured form is far smaller and loses nothing a dedup key needs. The evidence leans to the structured form plus a template signature (card count, selector hit) for drift detection, with raw HTML kept only for quarantined messages. This is the human's call.
- A drift check analogous to slim would require: at least one card; each card yields three `p` blocks with `<strong>` in the first and third; the `em` has one or two lines. Otherwise quarantine.

## Not verified

- What `upn` contains beyond its size and printability.
- Logo hash stability across sends.
- Why 2 of the 5 subjects matched no card.
- Behaviour under other saved searches.
- Templates before October 2026.

Checked after the probe: `toMessage` in `src/core/gmail-message.mjs` throws `gmail.missing-plaintext-body` when a message has no `text/plain` part (lines 37 to 41), so the HTML-only W2tJ messages are refused at the adapter.
