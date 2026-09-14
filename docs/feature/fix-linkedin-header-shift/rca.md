# RCA: LinkedIn field shift on unfiltered digest header/banner lines

**Date**: 2026-09-14
**Analyst**: Rex (nw-troubleshooter)
**Scope**: `src/core/parse-linkedin.mjs` — `parseBlocks()` / `meaningfulLines()`. Investigation only; no production code or test changed.

## Problem Statement

`parseBlocks()` extracts a job's title/company/location as "the first three
non-noise lines of a block." When a block contains an unfiltered line ahead
of the real title, the triple shifts by one (or more) positions and the true
location (or company and location) is silently discarded — replaced by
plausible-looking text that still gets a dedup key and a fit score, so the
row does not look broken.

## Evidence Base

- 59 real cached messages, `.cache/messages/2026-09/*.json` (2026-09-01 →
  2026-09-14), re-parsed with the unmodified, shipped `extractJobs()`.
- 5 committed fixtures, `fixtures/linkedin/*.json`.
- `src/core/parse-linkedin.mjs`, `src/core/harvest.mjs` (`upsertByDedupKey`),
  `src/core/sources/linkedin.mjs`, `src/adapters/xlsx-target-sheet.mjs`,
  `src/adapters/merge.mjs` (read).
- `git log` on `fixtures/linkedin/` and `src/core/parse-linkedin.mjs`.
- `docs/decisions/DR-0001`, `DR-0007`.
- Two throwaway probe scripts (deleted; logic reproduced inline below) that:
  (a) split every message into blocks the way `parseBlocks` does and counted
  `meaningfulLines().length !== 3`, and (b) ran the real `extractJobs()` +
  `upsertByDedupKey()` pipeline over the full corpus and flagged any
  persisted row whose `title`/`company` matched a known non-job-title line.

## WHY 1 — Symptom

Three distinct blocks of raw text precede the real title/company/location
triple in different digest subtypes, and none of them are in `NOISE_LINE`:

- **1A** `"New jobs match your preferences."` / `"A new job matches your
  preferences."` — banner on the multi-job / single-job "digest" email.
  [Evidence: 39 + 17 occurrences across 59 messages, e.g.
  `.cache/messages/2026-09/1a08c6f7d19a50c9.json` block 0.]
- **1B** `"New jobs from your other alerts"` followed by
  `<strong class="font-bold" style="font-weight: 600;">{term}</strong> jobs
  in {place}` — the cross-sell section heading LinkedIn inserts for jobs
  matching a *different* saved search. [Evidence: 5 + 7 occurrences, e.g.
  `1a070f8398db9db2.json` block 1.]
- **1C** `"Your job alert has been created: {description}."` followed by
  `"You'll receive notifications when new jobs are posted that match your
  search preferences."` — the one-time confirmation email LinkedIn sends
  when a saved search is first created. This is the "footer variant" flagged
  as unverified in the brief. [Evidence: 3 occurrences, e.g.
  `1a09be37fadab08b.json` block 0 — title becomes the confirmation sentence,
  **company** becomes the "You'll receive notifications…" sentence, and the
  real title lands in `location`, discarding real company and location
  both.]

## WHY 2 — Context: why does an unfiltered line exist in the block?

Because `NOISE_LINE` is a **closed, hand-authored list of exact strings**
matched against whatever LinkedIn happens to put in a block, and LinkedIn
emits at least four distinct digest **subtypes** with different preambles
(plain digest, singular digest, cross-sell section, alert-created
confirmation) — the denylist only covers the noise present in the fixtures
it was written against. [Evidence: none of `1A`/`1B`/`1C` appear in
`NOISE_LINE`, `src/core/parse-linkedin.mjs:9-16`.] Two more gaps of the same
kind exist independent of the reported defect: literal `"Manage alerts:
https://…"` and `"Edit alert https://…"` lines are not filtered either
(`NOISE_LINE` only matches `/^Manage your job alerts/`, a phrase LinkedIn
does not actually send) — evidence the denylist was written from
recollection/assumption, not from a captured sample, even for the phrases it
does partially cover.

## WHY 3 — System: why does this persist / cause silent corruption rather than a loud failure?

`parseBlocks()` has no way to tell "correct triple" from "wrong triple" —
`const [title, company, location] = meaningfulLines(block)` accepts
*whatever* the first three surviving lines are. There is no validation that
the extracted `title` looks like a job title, so an unfiltered line is
indistinguishable from a real field: it is a string, it is truthy
(`if (!title || !company) continue;` only rejects *empty*, never
*implausible*), so the row is emitted, dedup-keyed from the block's own
`/jobs/view/(\d+)/` match (unaffected by the shift), and fit-scored. Nothing
downstream can detect it. [Evidence: `parseBlocks()` lines 63-84; dedup key
derivation is independent of the triple, confirmed by re-running
`extractJobs` — every shifted row still carries the correct `linkedin:<id>`
key.]

## WHY 4 — Design: why wasn't a structural check designed in?

At walking-skeleton time (2026-08-01, single commit `c9ba19a`) all 5
fixtures came from one capture session and share one template: no banner
line, no cross-sell section, no confirmation email. [Evidence: `git log
--follow` shows `parse-linkedin.mjs` and `fixtures/linkedin/` created
together in one commit; all 5 fixture subjects share the pattern `"{title}
at {company}"`; grepping all 5 for `match your preferences`, `other alerts`,
`alert has been created`, `receive notifications` returns zero hits.] Given
that sample, "first three non-noise lines" was a reasonable design — the
noise really was closed and small in every example the author had. The
design was never re-examined against a wider sample as real traffic
accumulated, because nothing forced that re-examination: there is no
anchor/invariant check (e.g. "does the extracted title look unlike our own
noise phrases?") and no process step that revisits fixture coverage as the
live cache (DR-0001's gitignored `.cache/`) grows past the original 5
examples.

## WHY 5 — Root Cause

**A positional extraction rule (`first three non-noise lines`) was encoded
against a single-session, single-template sample of LinkedIn's actual digest
format, with no structural anchor tying the triple to something LinkedIn
guarantees is present in every job card, and no standing practice of
re-deriving the noise model from live traffic as new digest subtypes
appeared.** Every distinct unfiltered-line variant (1A/1B/1C, plus the
`Manage alerts:`/`Edit alert` gaps) is a different symptom of this one
design choice, not a separate defect each.

This is the same failure shape DR-0007 already named and fixed once, in a
different layer: DR-0007's context states the spill-contract test model "was
invented — in the one place DR-0003 had already named as fragile." Here the
parser's *noise model* was invented from one capture session and never
revalidated, in the one place (free-text email bodies, wholly outside
LinkedIn's control or any contract) most likely to drift. The project has no
standing mechanism that catches this class of drift before it reaches
production — DR-0007 closed the gap for the spill file *shape*; this defect
shows the same gap still exists for message *content*.

## Cross-Validation

- Root Cause explains 1A, 1B, and 1C identically: each is "an unfiltered
  line (or pair of lines) precedes the real triple," differing only in
  *which* LinkedIn subtype supplies the noise. No contradiction between
  branches.
- Backwards check: if the root cause is correct, every future LinkedIn copy
  change that adds new preamble text to any digest subtype should reproduce
  the same shift, with no code change required to trigger it — consistent
  with three independent variants already found from one three-week corpus
  and zero LinkedIn-side change.
- **Is 1C (footer) the same defect as 1A?** Yes — same root cause, same
  mechanism (unfiltered line(s) before the triple), different LinkedIn
  digest subtype. Not a distinct defect requiring separate root-cause
  analysis; it is evidence the denylist gap is systemic rather than
  confined to the "digest" subtype the bug was first noticed in.

## Variant Enumeration (across all 59 cached messages)

| # | Pattern | Literal or dynamic | Occurrences | Digest subtype |
|---|---|---|---|---|
| 1 | `New jobs match your preferences.` | literal | 39 | plain digest, plural |
| 2 | `A new job matches your preferences.` | literal | 17 | plain digest, singular |
| 3 | `New jobs from your other alerts` | literal | 5 | cross-sell section header |
| 4 | `<strong class="font-bold" style="font-weight: 600;">{term}</strong> jobs in {place}` | **dynamic** (search term + place) | 7 | cross-sell section sub-header |
| 5 | `Your job alert has been created: {description}.` | **dynamic** (per saved search) | 3 | alert-created confirmation |
| 6 | `You'll receive notifications when new jobs are posted that match your search preferences.` | literal (curly apostrophe, U+2019) | 3 | alert-created confirmation |
| — | `Manage alerts: https://…` / `Edit alert https://…` | literal prefix, dynamic tail | several | pre-existing gap, not part of the reported defect but same root cause |
| — | Long tracking-URL continuation lines (e.g. `See all jobs`/`Manage alerts` URLs wrapping onto a bare line with no recognizable prefix) | unbounded | several | line-wrap artifact — no denylist entry can close this one; see Proposed Fix |

Variants 1–2 are the reported defect exactly. Variant 3–4 (cross-sell
section) can shift by **two** lines, discarding company *and* location, and
in one observed case a stray wrapped-URL fragment from the *previous*
section leaked in ahead of the section header, discarding the title too.
Variants 5–6 are the footer case named in the brief, confirmed as the same
root cause.

## Question 3 — how many rows are actually affected?

The brief states 7 of 146. Re-running the full pipeline (`extractJobs` +
`upsertByDedupKey`, the real `src/core/harvest.mjs` first-seen-wins upsert,
unmodified) over all 59 cached messages gives **45 of 146** distinct
`Dedup Key` rows with a shifted `title` or `company` on their first-seen
occurrence — the occurrence that wins under `upsertByDedupKey`'s
`if (!existing) { collapsed.set(...) }` (title/company/location are only
ever taken from the *first* chronological sighting; later sightings only
update `lastSeen`/`timesSeen`/salary-if-missing).

**I could not reconcile this against the brief's "7 of 146."** My count is
reproducible directly from the shipped code and the full corpus and is not
restricted to one variant — it includes all of 1–6 above. Possible
explanations I could not verify: the "7" may have come from spot-checking
rather than an exhaustive scan, from a partial/earlier corpus snapshot, or
from counting only variant 1A. Flagging this as an open item rather than
silently adopting either number.

## Question 4 — why didn't the fixtures catch this, given DR-0007?

Confirmed directly: all 5 fixtures were captured in one session
(2026-08-01, commit `c9ba19a`) sharing one narrow template (title/company/
location directly after "Your job alert for…", `This company is actively
hiring`/`Apply with resume` as the only interstitials, no banner, no
cross-sell section, no confirmation email). The acceptance test
(`tests/acceptance/job-alert-harvester/walking-skeleton.test.mjs`) asserts
`title`/`company` are *truthy* (`expect(j['Job'], 'title').toBeTruthy()`)
and pins specific values only for the two fixture-specific regression cases
it was written for (`linkedin:4441092711`, salary-smear check) — it has no
assertion that would fail if a *different* line were truthy in `title`'s
place. A shifted-but-truthy string passes every existing check. This is
structurally the same gap DR-0007 named for the spill contract: a test
model invented from a small early sample, never widened as real traffic
(the 59-message live cache, entirely disjoint from the fixture sample in
subtype coverage) diverged from it.

## Proposed Fix

**Anchor on the `View job:` line rather than the start of the block.**

Every job card — primary or cross-sell, in every subtype observed — carries
exactly one `View job: {url}` line immediately after its
title/company/location triple and whatever trailing noise follows it
(`This company is actively hiring`, `Apply with resume & profile`, and a
LinkedIn social-proof line: `N connections`, `N company alum(ni)`, `N school
alum(ni)`). Confirmed structurally: `grep -c 'View job:'` equals
`grep -c '/jobs/view/'` in every sampled message, including multi-job
merged blocks.

Change `parseBlocks` to, per block: locate the `View job:` line, then walk
*backward* from it, skipping known **trailing** noise (hiring / apply /
`See all jobs` / the numeric social-proof line — one new pattern needed:
`/^\d+ (connections?|company alumni?|school alumni?)$/`), and take the next
three lines as `[location, company, title]` (reversed).

**Why this is more robust than extending the denylist:**

- Denylist extension is reactive and already demonstrably incomplete —
  6 distinct preceding-noise variants found in one 3-week corpus, plus 2
  more (`Manage alerts:`, `Edit alert`) missed even before this
  investigation, 2 of which are **dynamic** (contain the search term/place)
  and cannot be denylisted as exact strings at all.
  Any future LinkedIn copy change to *preamble* text (unbounded surface —
  marketing banners, section headers, confirmation copy) reproduces the bug
  with zero code change.
- The **trailing** side (between location and `View job:`) is a small,
  closed, low-churn set: LinkedIn's own UI chrome for "why you're seeing
  this" (hiring flag, apply-CTA, social proof), which the codebase already
  denylists two of three variants for. Anchoring there converts an
  unbounded failure surface (arbitrary preamble copy) into a bounded one
  (three known trailing-noise shapes), and only one new pattern is needed
  to close it.
- It fixes 1A, 1B, 1C, the `Manage alerts:`/`Edit alert` gap, and the
  stray-wrapped-URL-fragment case all at once, with no per-variant
  denylist entry, because none of them matter once extraction no longer
  depends on being at the start of the block.

**Residual gap (out of scope to fix here, flagged for the fix task):**
`JOB_ID_IN_URL` and the block-splitting logic assume one job per block.
Cross-sell sections were observed merging two `View job:` occurrences into
a single `BLOCK_SEPARATOR`-delimited block (missing separator between
consecutive cross-sell cards). `parseBlocks`'s `.match()` (singular) only
finds the first job ID per block, so the second job in such a block is
**silently dropped**, not shifted. A backward-anchor fix should iterate all
`View job:` occurrences per block, not just the first — otherwise it fixes
the shift but leaves the drop.

## Files Affected

- `src/core/parse-linkedin.mjs` — `parseBlocks()`, `meaningfulLines()` (or
  its replacement), `NOISE_LINE` (add the one trailing social-proof
  pattern; the preamble-specific entries become unnecessary once anchoring
  lands, though removing them is optional cleanup, not required for
  correctness).
- Test fixtures: the existing 5 are insufficient to specify this fix (per
  Q4) — new fixtures/builders covering at minimum variants 1, 3+4, and 5+6
  are needed for DISTILL, ideally copied from real cache entries the way
  DR-0007 mandated for the spill fixture, not re-invented.

## Risk Assessment

- **Low risk to dedup keys.** `dedupKey` is derived from `JOB_ID_IN_URL`
  matched against the raw block text, entirely independent of the
  title/company/location triple. Confirmed by direct comparison: every
  shifted row in the corpus still carries its correct `linkedin:<id>` key.
  Re-parsing under the fix will not change any key, will not create
  duplicate rows, and will not break `upsertByDedupKey`'s collapsing.
- **Reparse is the intended repair path (DR-0001).** `HARVESTER_COLUMNS`
  in `src/adapters/xlsx-target-sheet.mjs` (currently a RED/unimplemented
  scaffold) is documented as "always overwritten with the freshly derived
  value" on merge, and `Job`/`Company`/`Location` are in that list — so
  once the parser is fixed, a full reparse self-heals every previously
  corrupted row without a special migration, and `HUMAN_COLUMNS` (manual
  annotations) are untouched either way.
- **No live target spreadsheet exists yet to corrupt further** —
  `src/adapters/merge.mjs` and `src/adapters/xlsx-target-sheet.mjs` are
  both unimplemented RED scaffolds (`__SCAFFOLD__ = true`) as of this
  investigation; the only current output path is `src/core/harvest.mjs`
  building a workbook fresh from the cache each run, which is exactly what
  this investigation exercised.
- **Test-authoring risk, not code risk, is the main cost of the fix**:
  the existing 8/8 walking-skeleton acceptance test only asserts
  truthiness, so it will not catch a broken backward-anchor implementation
  either, unless DISTILL adds assertions on actual extracted values (not
  just presence) using fixtures drawn from the real corpus.

## Unresolved / Flagged for Follow-Up

1. ~~Row-count discrepancy: 45/146 (measured, reproducible) vs. 7/146 (brief).
   Not reconciled — see Question 3.~~ **RESOLVED 2026-09-14** — measured at
   54/146 after the fix landed; see § Post-Fix Verification.
2. ~~Whether the block-merge/dropped-row issue (cross-sell cards sharing one
   block, second job ID never matched) is in-scope for the same fix task or
   a separate ticket — flagged, not triaged, per investigation-only scope.~~
   **RESOLVED 2026-09-14 — the hypothesis was not borne out.** No block in
   the corpus carries more than one distinct job id; see § Post-Fix
   Verification.
3. No test or production code was changed. This document and the two
   throwaway probe scripts (already deleted from the scratchpad) are the
   only artifacts produced.

## Post-Fix Verification (2026-09-14)

Measured across all 59 cached messages after `c23b4a4` (anchor on the job
link) and `b808ab8` (pipeline refactor), by running the pre-fix parser
(`15a47b5:src/core/parse-linkedin.mjs`) and the fixed parser over the same
corpus and diffing by `dedupKey`.

| Measure | Before | After |
|---|---|---|
| Link occurrences / rows produced | 198 | 198 |
| Unique job ids | 146 | 146 |
| Triples corrected | — | **54** |
| Triples unchanged | — | 92 |
| Rows recovered | — | 0 |
| Rows lost | — | 0 |

### Two claims in this document did not survive the corpus

**The "residual gap" (§ Proposed Fix) is not real in this corpus.** Blocks
containing at least one job link: 198. Blocks containing more than one
*distinct* job id: **0**. The pre-fix parser produced the same 198 rows and
the same 146 unique ids as the fixed parser, so no card was ever dropped.
The defect was purely the field shift. The fix iterates every `/jobs/view/`
occurrence per block regardless — the behaviour is now correct by
construction rather than by corpus accident — but it repaired nothing that
was broken, and the "leaves the drop" warning was unfounded.

**The affected-row count is 54, not 45 and not 7.** The brief's 7 counted
literal-string matches for two banner variants; 45 was an interim probe;
54 is the exhaustive triple-level diff above.

### Not closed by this fix

`jobAtLine` returns `null` when a link's triple lacks a title or company,
which would drop that card silently. It never fires on the current corpus
(198 links → 198 rows), so it is unexercised rather than safe — it
contradicts DR-0006 rule 2 (unmatched input is captured, never dropped),
which mandates an `Unmatched` bucket rather than a null return.
