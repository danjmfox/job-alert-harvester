# RCA: inner whitespace runs survive parsing of Gmail-API bodies

Doc type: Explanation.

**Date**: 2026-09-29
**Analyst**: Rex (nw-troubleshooter)
**Scope**: `src/core/parse-linkedin.mjs` (`runsOf`, `jobAtLine`), `src/core/gmail-message.mjs`. Investigation only; no code or test changed.

## Problem Statement

The same job yields `"Project Manager -  North"` via the Gmail API path and
`"Project Manager - North"` via the connector cache. `scripts/gmail-parity-check.mjs`
found 1 of 64 cached messages (`1a086dc58abb04b6`) differing at job level; job 0
title only. Human decision (2026-09-29, fix in parser not `toMessage`): collapse
inner whitespace in the parser.

## Evidence Base

- Cached record `.cache/messages/2026-09/1a086dc58abb04b6.json` read: body has no
  `\r`, no double space, no indentation; title line is `Project Manager - North`.
- `src/core/gmail-message.mjs:13-16,37-41,44-51` read: `toMessage` base64url-decodes
  the `text/plain` part verbatim; no whitespace normalisation anywhere.
- `src/core/parse-linkedin.mjs` read in full; call graph via grep: `extractJobs` is the
  only consumer of message text, so both fetch paths converge there.
- Probe (`node -e`, no network, no credentials) on the cached record:
  - as cached: job 0 = `["Project Manager - North","Trane Technologies","Southampton"]`
  - body with `"Project Manager -  North"`, `"  Trane   Technologies"` and every `\n` -> `\r\n`:
    job 0 = `["Project Manager -  North","Trane   Technologies","Southampton"]`;
    same 3 jobs, same `dedupKey` `linkedin:4454268518`.
  - CRLF alone: titles unchanged (trim removes the `\r`).
- Not reproduced: the API-side body itself (needs network, forbidden). The claim
  that it carries CRLF and indentation runs is from the parity report, unverified here.
- Corpus scan, 64 cached bodies / 219 parsed rows: 0 bodies with a double space
  between non-space characters, 0 with `\r`, 0 with tabs, 0 with line indentation; 61 with U+00A0 (all inside the
  tracking-URL footer, e.g. `t=plh   ·  Help: https`); 0 of 657 title/company/location fields contain a whitespace run or
  NBSP, and 0 change under `replace(/\s+/g,' ')`.

## WHY chain

- **WHY 1** — Job 0's title contains two spaces. [Evidence: probe above;
  `title` is the raw run text, `parse-linkedin.mjs:131,135`.]
- **WHY 2** — The only text normalisation on a card line is `rawLine.trim()`
  (`parse-linkedin.mjs:88`), which touches ends only. Title, company, location and
  salary line all come from these trimmed `runsOf` entries (`cardFor`, l.110-114).
  [Evidence: probe; no other `replace`/`\s+` on card text in the file.]
- **WHY 3** — The parser was written against connector text that was already
  single-spaced, so it never needed to normalise; `toMessage` (anti-corruption
  layer) passes decoded text through untouched. [Evidence: cached body clean;
  `gmail-message.mjs:37-41`.]
- **WHY 4** — Input-shape assumptions were implicit: no contract states what
  whitespace the parser accepts. The gmail-api-source design named body parity as
  "highest residual risk" (`docs/feature/gmail-api-source/feature-delta.md:306`)
  and deferred it to a one-off DELIVER check rather than a pinned test.
  [Evidence: that line; `tests/regression/job-alert-harvester/` has no whitespace test.]
- **WHY 5 (root cause)** — `parse-linkedin.mjs` trims but does not canonicalise
  line text, and its only fixtures/corpus derive from connector output that already
  had whitespace canonicalised upstream, so the parser silently depended on a
  property of one input source that the second source does not share.

Backward check: a parser that only trims, fed text with inner runs, must emit runs
into title/company/location; the probe does exactly that. Explains the single symptom.

## Contributing factors

- **Connector masked it**: the connector's `plaintextBody` is single-spaced, so
  every cached row since 2026-08 was clean; the defect needs a second source.
- **DISTILL fixtures could not show it**: fixtures (`fixtures/linkedin/`,
  `fixtures/linkedin-variants/`) are composed from cached connector text, so they
  are single-spaced by construction; any assertion on them passes.
- **Low incidence**: only a source email that genuinely has the run (here in the
  subject, hence in the body) triggers it: 1 of 64.

## Parser code paths: what must be covered

All card fields flow through one choke point: `text` in `runsOf`
(`parse-linkedin.mjs:88`). Collapse there and every consumer is covered:

| Path | Location | Takes run text? | Covered by collapse at l.88 |
|---|---|---|---|
| title, company, location | `jobAtLine` l.131 via `cardFor` l.110-114 | yes | yes |
| card salary | `cardSalaryIn` l.117 -> `parseCardSalaryLine` (regex uses `\s*`) | yes | yes; tolerant already |
| job id / advertLink | `jobAtLine` l.123 `JOB_ID_IN_URL` on `rawLine` | no, raw | unaffected, must stay raw |
| dedupKey | `linkedin:${jobId}` l.134 | no | unaffected |
| search term | `parseSearchTerm` l.20-23 on whole body | no, body-level | not covered; already `.trim()`s |
| subject salary | `parseSalaryFromSubject` (`\s*` regexes) | no | not covered; not needed |
| link count | `countAdvertisedLinks` l.158 `split('\n')` on raw | no | unaffected |

Collapse must not be applied to `rawLine` before `SEARCH_TERM_LINE.test` or
`JOB_ID_IN_URL` match; apply it to the trimmed text only.

### CRLF sensitivity (`\n` splits and anchored regexes)

- `split('\n')` at l.146 and l.158 leave a trailing `\r`. Harmless: l.88 `trim()`
  strips it; `JOB_ID_IN_URL` is unanchored; verified by the CRLF probe.
- `BLOCK_SEPARATOR` `/^-{20,}$/m` and `SEARCH_TERM_LINE` `/^…(.+)$/m`: in JS `$`
  with `m` matches before `\r`, and `.` excludes `\r`, so CRLF is safe. No change needed.
- `CARD_SALARY_AMOUNT_LINE` is `$`-anchored without `m`, but runs on trimmed text: safe.
- **Latent, not the reported defect**: `SEARCH_TERM_LINE` is `^`-anchored, so an
  indented header (`"  Your job alert for …"`) is not recognised: `parseSearchTerm`
  returns `null` (probe) and the header is no longer a run boundary (falls into
  the card run). In the probe titles still came out right, but
  `searchTerm` is lost. The parity report showed no `searchTerm` diff, so the API
  body does not indent that line in message 1a086dc58abb04b6; a regression test
  should not assume it does. Flag; do not fix under this change.

## Files affected

- `src/core/parse-linkedin.mjs` l.88 only: `rawLine.trim()` -> trim then
  `.replace(/\s+/g, ' ')`.
- New test file (below). `gmail-message.mjs` unchanged (per human decision).

## Proposed minimal fix

In `runsOf`: `const text = SEARCH_TERM_LINE.test(rawLine) ? '' : rawLine.trim().replace(/\s+/g, ' ');`
(a local named constant `collapseWhitespace` is fine). Pure, no `node:` use, no mutation.
Label: permanent fix (parser converges both paths); no immediate mitigation needed
(API path is not yet in production use of the sheet).

## Risk assessment

- **Dedup keys: none.** `dedupKey` comes from the job id. The fuzzy key
  (`src/core/dedup.mjs:22-24`) already collapses `\s+`.
- **Header-shift regression** (`docs/feature/fix-linkedin-header-shift/rca.md`): that
  fix is about position, not content. Collapse changes text after run
  membership is decided (`text === ''` test is unchanged since `\s+` collapse of a non-empty
  trimmed string stays non-empty), so run boundaries and `cardFor` do not move.
- **DR-0008 (card position, not denylist)**: same argument; positional
  extraction and the `prefix.length >= 3` rule depend on line count, not content.
- **Fields where double spaces are meaningful**: none found; 0 of 657 corpus
  fields change. A title's inner run is whitespace noise, not data.
- **NBSP**: `/\s+/` also matches U+00A0. 61 of 64 bodies contain NBSP, but only in the URL
  footer, never in a card field, so no cached row changes. Future NBSP in a title
  would become a plain space (desirable, same as `trim()` already strips it at ends).
- **Existing rows**: cached bodies already single-spaced -> byte-identical output
  (corpus check above). Any API-derived rows would self-heal on reparse (DR-0001,
  harvester columns are overwritten).
- **Silent-zero caution**: the clean-corpus result is evidence of no-op, not of the
  fix working; the regression test below is what proves the fix.

## Regression test

Where: `tests/regression/job-alert-harvester/linkedin-inner-whitespace.test.mjs`
(follows `linkedin-block-anchor.test.mjs` style).

Input: a message built from the real cached record (copy
`1a086dc58abb04b6` into `fixtures/linkedin-variants/`, the DR-0007 way) with the
body altered: `"Project Manager - North"` -> `"Project Manager -  North"`,
`"Trane Technologies"` -> `"  Trane   Technologies"`, `"Southampton"` -> `"Southampton\t "`, and every `\n` -> `\r\n`.

Expected: `extractJobs` gives job 0 `title === "Project Manager - North"`,
`company === "Trane Technologies"`, `location === "Southampton"`, `dedupKey ===
"linkedin:4454268518"`, 3 jobs, and the rows deep-equal `extractJobs` of the
unaltered fixture (parity by construction). RED first: fails on title today.

Optional second `it`: a card salary line `"£59K - £78K  /  year"` still parses (min 59000, max 78000).

## Not fixed here

- Indented `Your job alert for` header loses `searchTerm` (see above).
- The parity claims about the API body (CRLF, indentation) rest on the parity
  report; re-run `scripts/gmail-parity-check.mjs` after the fix to confirm 64 of 64.
