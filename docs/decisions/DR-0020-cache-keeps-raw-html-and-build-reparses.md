---
id: DR-0020
status: accepted
dateCreated: 2026-10-26
domain: job-alert-harvester
refines: DR-0001
relatedTo: [DR-0009, DR-0019]
changelog:
  - date: 2026-10-26
    version: 0.1.0
    note: Drafted by the DESIGN wave of welcome-to-the-jungle-source. The cache form is the human's decision (DISCUSS OQ-02); this record only proposes. Not accepted.
  - date: 2026-10-27
    version: 1.0.0
    note: Accepted by the human on 2026-10-27 as the DESIGN architect recommended it.
---

# The cache keeps the raw HTML of an HTML-only message and the build re-parses it

## Context

DR-0001 says to persist what cannot be re-derived and recompute what can, and DR-0009 says `build` derives every row from the whole cache. The cache is local and gitignored. A message from Welcome to the Jungle is an HTML document of 42,984 to 64,847 characters (spike, 100 messages). DR-0019 lets the record carry it as `htmlBody`.

The question is what to persist: the HTML, or only what was extracted from it. The spike leaned to the extracted form with a template signature. The raw HTML holds per-recipient tokens: click-tracking links on each card and unsubscribe and manage-preference links in the footer. The cache already holds LinkedIn bodies with tracking parameters, and DR-0001 accepted "personal job-search history at rest, unencrypted, gitignored".

Two facts the spike left unknown can only be answered from raw markup: whether the company logo address is stable across sends (a possible stable company key), and what older templates looked like.

Volume is unreconciled. The discovery brief counted about 10 messages in 45 days, which is about 4 to 5 MB a year raw. The spike re-read 100 messages from the same query, about 5 MB for that sample.

## Options Considered

### Option A: keep the raw HTML as `htmlBody` and parse at build (proposed)

- Advantage: follows DR-0001 and DR-0009 directly. A scanner fix or a new field reaches the whole history. The unknowns above stay answerable.
- Disadvantage: more bytes at rest, and the tokens above stay in the cache. Scan cost per message is unmeasured (DR-0001 budgets about 10 ms a message for LinkedIn).

### Option B: cache only the extracted cards plus a template signature

- Advantage: small, no tokens, and the signature detects drift.
- Disadvantage: the parse is frozen at fetch time, which is what DR-0001 options 3 and 4 rejected, and the Advert Link would be blank unless the link is also stored. Logo stability could not be checked later.

### Option C: raw HTML with link and image values stripped when caching

- Advantage: fewer personal tokens.
- Disadvantage: it rewrites the source on the fetch path (itself a scan of the template), and removes the card link, so the Advert Link is blank.

## Decision

Proposed: Option A. The human decides.

1. An HTML-only record carries `htmlBody`; nothing derived from it is stored.
2. `build` scans the HTML on every run, as it parses LinkedIn text.
3. The Advert Link follows: if the human accepts storing the card link, it is read from the cached HTML at build.
4. If personal data becomes the larger concern, Option C is the cheap next step and does not change the record shape.
5. The scan cost is measured in the first slice that scans, against DR-0001's reparse budget.

## Exceptions

Revisit if:

- The cache must leave the local machine. DR-0001 already requires encryption or retention then, and these tokens make that more pressing.
- The full reparse exceeds a minute (DR-0001 names about 6,000 messages for LinkedIn). A parsed cache keyed by scanner version becomes worth its complexity.
- The unknown volume turns out to be far larger than a year of about 80 messages.
