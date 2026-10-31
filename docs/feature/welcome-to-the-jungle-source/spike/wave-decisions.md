# SPIKE Decisions -- welcome-to-the-jungle-source

## Assumption Tested
- OQ-01: does the W2tJ alert HTML separate company, tagline, title, salary and location per card, and carry a stable per-job identifier that the plain-text rendering lacks?

## Probe Verdict
- PARTIAL: per-field extraction works across 100 messages (one Stripo template, positional fields). No stable job id exists (opaque SendGrid `upn` link). No `text/plain` part exists, which the current Gmail adapter requires.

## Promotion Decision
- DISCARD: human directed probe only; findings are the deliverable. No walking skeleton. Probe code and raw messages deleted.

## Design Implications
- Add an HTML read path; the plain-text assumption in `toMessage` does not hold for this sender (decision record needed).
- The dedup key must be derived from extracted fields, not the link.
- OQ-02 (cache form) is open; findings lean to structured form plus a drift signature.
- The link target is unrecoverable offline and using it registers a click.

## Constraints Discovered
- HTML-only messages: `toMessage` refuses them, and `slim` would quarantine them (`no-advert-link`).
- Salary forms: absent, generic text, `$`/`£`/`€` single or range.
- The template relies on builder-generated `es-*` classes; drift is possible.
