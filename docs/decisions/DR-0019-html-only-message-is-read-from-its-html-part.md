---
id: DR-0019
status: accepted
dateCreated: 2026-10-26
domain: job-alert-harvester
refines: DR-0001
relatedTo: [DR-0006, DR-0020]
changelog:
  - date: 2026-10-26
    version: 0.1.0
    note: Drafted by the DESIGN wave of welcome-to-the-jungle-source; awaits the human's decision. Not accepted.
  - date: 2026-10-27
    version: 1.0.0
    note: Accepted by the human on 2026-10-27 as the DESIGN architect recommended it.
---

# A message with no plain-text part is read from its HTML part

## Context

The harvester caches one record per Gmail message: `date, id, plaintextBody, sender, snippet, subject` (DR-0001, DR-0002 storage layout). `toMessage` in `src/core/gmail-message.mjs` builds that record from a Gmail message and refuses with `gmail.missing-plaintext-body` when the message has no `text/plain` part (lines 37 to 41). DR-0001 chose to discard the HTML body when caching.

A spike on 2026-10-26 (`docs/feature/welcome-to-the-jungle-source/spike/findings.md`) read 100 alert messages from Welcome to the Jungle. Every one is a single `text/html` part with no `text/plain` part. The plain text seen earlier was the Gmail connector's own conversion, which fused the company with its tagline and the title with its location. With the current code every one of these messages is refused at the adapter.

## Options Considered

### Option A: an optional `htmlBody` beside `plaintextBody`, plain text preferred (proposed)

`toMessage` keeps `plaintextBody` whenever a text part exists, exactly as now. When there is none it takes the HTML part into `htmlBody`. It refuses only when neither part exists.

- Advantage: additive. LinkedIn records stay byte-identical, no migration, and a fixture and a cache record keep the same shape.
- Disadvantage: a record now has one of two body fields, so each extractor must read the one it expects.

### Option B: one `body` field plus a `bodyKind` that the descriptor declares

- Advantage: one shape.
- Disadvantage: about 3,000 existing records need migrating or two readers are needed, and a descriptor that declares how its input looks is the shape field that DR-0006 rule 1 rejects.
- Verdict: rejected.

### Option C: convert HTML to text inside `toMessage` and keep `plaintextBody`

- Advantage: nothing downstream changes.
- Disadvantage: it repeats the lossy conversion that fused the fields, and it needs an HTML reader anyway.
- Verdict: rejected.

## Decision

Proposed: Option A.

1. `toMessage` returns `plaintextBody` when a text part exists, otherwise `htmlBody` from the HTML part. A message with neither is refused.
2. A record keeps `htmlBody` only when it has no plaintext part, so existing LinkedIn records do not change.
3. Which extractor reads which field is the descriptor's business. The LinkedIn screen must handle a record with no `plaintextBody` by quarantining it, not by throwing.
4. The agent path (`raw-spill-source`, `ingest`) is unchanged and LinkedIn-only.
5. Whether the neither-part refusal keeps its current code is left to DISTILL, because existing tests assert it.

## Exceptions

Revisit if:

- A sender sends both parts and the plain part is truncated or wrong. Rule 2 would then need a way to prefer the HTML.
- A third body type appears (for example attachments). The two-field shape would then be replaced by Option B.
- The cache is moved off the local machine (see DR-0020 on what the HTML holds).
