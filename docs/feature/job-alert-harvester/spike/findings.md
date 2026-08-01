# SPIKE Findings — job-alert-harvester

**Date**: 2026-08-01
**Probe location**: `/tmp/spike_job-alert-harvester/` (throwaway)
**Fixtures**: 5 real LinkedIn `jobalerts-noreply` emails (4 = resends of one alert, 1 = distinct)

## Assumption Tested

From LinkedIn `jobalerts-noreply` alert emails alone, can we **deterministically extract**
`{company, title, location, salary?, advert link}` **and assign a stable dedup key** that
collapses the 3–6×/day resends into one job?

## Verdict: WORKS

| Metric | Result |
|---|---|
| Raw job rows parsed | 22 |
| Unique jobs after dedup | 14 |
| Collapse ratio | 1.57× |
| Rows missing a core field | **0** |
| Elapsed | 52 ms (5 fixtures) |

No performance budget was set; volume is trivial (~1k emails/yr).

## Findings that CHANGE the design

### F1 — "Single-job" alerts are actually digests (assumption invalidated)
The email subject names only the **first** job (`"Scrum Master & PMO Lead at Digital Waffle"`),
but the body carried **3 distinct jobs** (Digital Waffle, Wealth Dynamix, Haystack).

**Implication**: the source registry must NOT classify LinkedIn alerts as "single-job" vs
"list" — they are all digests. Subject-only parsing would silently lose ~⅔ of all jobs.
Every message body must be parsed.

### F2 — LinkedIn exposes a stable canonical job ID (better dedup key)
Every job block contains `/jobs/view/(\d+)`, e.g. `4441092711`. Stable across resends.

**Implication**: dedup key = `linkedin:{jobId}` — an **exact, deterministic** key. This
*replaces* the originally proposed fuzzy `hash(company+title+location)`. The fuzzy hash is
retained only as the fallback for sources that expose no canonical ID.
Canonical URL is reconstructable as `https://www.linkedin.com/jobs/view/{id}/`, discarding
~1.5 KB of per-link tracking tokens (`trackingId`, `midToken`, `otpToken`, …).

### F3 — Resends are PARTIALLY-OVERLAPPING digests, not duplicates
The 4 "identical" Stealth iT resends (09:48, 11:48, 15:48, 21:48 on 2026-07-25) each carried
a *different* set of additional jobs. Collapse ratio was only 1.57×, not ~4×.

**Implication**: resends cannot be skipped by subject/thread. Every message must be fetched
and parsed; dedup happens **after** extraction, in the pure core. This validates the
Pure Core / Imperative Shell split — dedup must not live in the fetch adapter.

### F4 — Search terms are recoverable → Sources tab is auto-populated
Line 1 of each body reads `Your job alert for {term}`. The 5 fixtures alone revealed **4
distinct saved searches**: `agile coach in Exampleton`, `scrum master in Exampleton`,
`agile coach in United Kingdom`, `scrum master in England`.

**Implication**: the Sources tab does not need manual authoring — it is derived from the corpus.

### F5 — `plaintextBody` is the parse target, not `htmlBody`
7.5 KB plaintext vs 150 KB HTML for the same message (20× smaller), and the plaintext is
regularly structured: blocks split on `-{20,}`, then `title / company / location`.

**Implication**: no HTML parser dependency needed (Cognitive Load Tax avoided).

## DEFECT found in probe (must be fixed in the skeleton)

**Salary smearing.** Salary appears only in the *subject* (`": up to £75K/year"`), never in
the body. The probe applied the subject salary to **every** job in the digest — so
`£75K` was wrongly attached to Wealth Dynamix and Haystack, when it belongs solely to the
headline job (Digital Waffle).

**Fix required**: bind subject-derived salary to the **first block only** (the headline job),
leaving other blocks' salary `null`. This becomes an explicit acceptance-test scenario —
propagating a wrong salary is worse than recording none.

## Edge cases observed

- Location granularity is inconsistent: `United Kingdom`, `Greater London`, `London Area, United Kingdom`, `Portsmouth`. Normalisation is a real task; remote-friendliness is **not** reliably derivable from LinkedIn alerts.
- Titles contain `&`, `/`, `-`, `(f/m/d)` — no delimiter assumptions are safe.
- Company field is frequently a **recruiter/agency**, not the employer (Lorien, hackajob, Calibre Candidates, Stealth iT Consulting). Confirms the `source_type` column decision; matches the prior tracker where such rows were recorded as `?`.
- The `"This company is actively hiring"` / `"Apply with resume & profile"` interstitials are optional and must be filtered.

## Design implications for DESIGN wave

1. Dedup key strategy is **per-source**: canonical ID where available (LinkedIn), fuzzy hash fallback elsewhere.
2. Watermark must be **message-level** (Gmail message id + internalDate), not job-level, because a single message contributes N jobs and resends overlap.
3. `timesSeen` / `firstSeen` / `lastSeen` are cheap and genuinely informative (repeat-advertising signal → a job re-advertised for weeks is a struggling-to-fill role).
4. Salary must be modelled as `{amount, basis, confidence, sourceField}` — subject-derived salary is lower-confidence and headline-scoped.
5. Fit scoring stays **derived**, never applied at ingest (re-scoreable).

## Promotion

Probe answered its question. Recommend **PROMOTE** to walking skeleton.
