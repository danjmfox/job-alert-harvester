<!-- markdownlint-disable MD024 -->
# Feature Delta — welcome-to-the-jungle-source

Narrative record of the DISCUSS wave. Doc type: Explanation plus Reference (same mix as the sibling `search-yield-summary` delta). Assumed background: the harvester fetches alert mail from Gmail into a local cache (`fetch`), derives a tracker from the whole cache (`build`, DR-0009 whole-cache derivation), and `harvest update` runs both from a 05:30 LaunchAgent (DR-0016 update owns the sequence). A source is a plain-data descriptor whose extractor returns an array (DR-0006 registry descriptors are data).

Mode: lean plus ask-intelligent (human decision). Feature type: backend, brownfield. No walking skeleton (human decision). UX depth: lightweight (no UI; the outputs are Sheet rows and stderr/stdout lines). JTBD: yes. Nothing under `src/` or `test/` was written. Nothing was committed.

Warnings carried by this wave:

- One real Welcome to the Jungle message was read, in plain text only. Every claim about the other messages is a hypothesis. The HTML has not been inspected by anyone.
- No interview was run. The persona and the job scores are the operator's brief restated (`docs/product/personas/dan-job-seeker.yaml`, `docs/product/jobs.yaml`).
- No shell was available. The density resolver, `nwave-ai outcomes check-delta` and telemetry events were not run. Density is the human's stated default.
- No raw message body, token or tracking link appears in any file written. Employer names, taglines and titles in the examples below are invented to match the observed shapes.

---

## Wave: DISCUSS / [REF] Prior Wave Consultation

- ✓ `docs/decisions/DR-0006-source-registry-descriptors-are-data.md` (read in full)
- ✓ `docs/decisions/DR-0002-coverage-intervals-not-a-watermark.md`, `DR-0009-build-derives-from-the-whole-cache.md`, `DR-0010-every-derived-tab-merges-by-its-own-key.md`, `DR-0014-role-family-is-a-derived-column-...md`, `DR-0015-search-yield-is-derived-in-harvest-and-printed-never-stored.md`, `DR-0016-update-subcommand-owns-the-fetch-then-build-sequence.md` (read in full)
- ✓ `docs/product/architecture/brief.md` (read in full, sections 4, 5, 7, 12, 15 and 16 closely)
- ✓ `docs/feature/search-yield-summary/feature-delta.md` (lines 1 to 484 of 584: DESIGN and DISTILL sections; the AT audit tail not read)
- ◐ `docs/feature/job-alert-harvester/feature-delta.md` (headings and the rows for D-14 source descriptors, D-15 unmatched bucket and Q5 truncation check only), `spike/findings.md` (F1 to F5 headings and F5 body)
- ✓ `src/core/sources/registry.mjs`, `sources/linkedin.mjs`, `parse-linkedin.mjs`, `gmail-query.mjs`, `dedup.mjs`, `harvest.mjs`, `search-yield.mjs`, `slim.mjs`, `gmail-message.mjs`; `src/adapters/gmail-api-source.mjs` (lines 40 to 159); `src/cli/harvest.mjs` (lines 150 to 279 plus greps for the source id); `src/cli/fetch-loop.mjs`; `src/core/update-plan.mjs` (grep)
- ✓ the redacted real-message sample (scratchpad `w2tj-sample-redacted.md`)
- ⊘ `docs/product/vision.md`, `docs/project-brief.md`, `docs/stakeholders.yaml`, any `discover/` or `diverge/` directory for this feature (not found or not present)
- ⊘ `docs/reference/cli.md`, `docs/how-to/run-update-on-a-schedule.md`, `DR-0018` body (not read; named below as docs that go stale)
- ⊘ `.cache/` (personal data, never read)

DISCOVER contradictions: none, because there is no DISCOVER for this feature. Contradictions between the decision records and the code are in *Upstream Contradictions* below.

## Wave: DISCUSS / [REF] Persona ID

`dan-job-seeker` (`docs/product/personas/dan-job-seeker.yaml`): a UK-based senior agile and delivery professional who is also the sole operator of the harvester. Works in the Google Sheet after the 05:30 run.

## Wave: DISCUSS / [REF] JTBD One-liner

J-001 (capture every advertised job in one tracker, `docs/product/jobs.yaml`): when job-alert emails arrive from several senders, Dan wants every job each one advertises to appear once in his tracker, so he can decide which to pursue without opening the emails. The feature also touches J-002 (know which alert searches earn their place) and J-003 (have the tracker current without attention).

Journey: `docs/product/journeys/morning-update.yaml`.

---

## Wave: DISCUSS / [REF] Scope Assessment

PASS, borderline: 5 stories, 5 modules touched (source descriptor and registry, `harvest()`, `slim` and the fetch path, `search-yield`, `update`), about 5 days. Two oversized signals are arguably present (more than three modules; one independently shippable outcome, US-05 salary). The slices below are the split. US-05 (salary where stated) can ship after, or apart from, the rest.

## Wave: DISCUSS / [REF] What the Code Says (premise checks)

The brief said the seam exists. Four things that the human's brief treats as given were checked against the code, and they matter to slicing.

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| P1 | `build` does not use the registry. `harvest()` calls `extractJobs` (LinkedIn) on every message, and the unmatched bucket is never read outside a unit test. A Welcome to the Jungle message put in the cache today parses to zero rows with no report. | `src/core/harvest.mjs:198`; `extractAll` is called only from `tests/acceptance/job-alert-harvester/source-registry.test.mjs` | This is finding F1 at message scale. DR-0006 rules 2 and 5 are not yet true of the build path. US-01 (digest to rows) must route through the registry first. |
| P2 | `Source` is a constant in the build. Every Jobs and Sources row says `LinkedIn`, and the LinkedIn parser writes `linkedin:` into the dedup key itself. | `src/core/harvest.mjs:11,123,159`; `src/core/parse-linkedin.mjs:134` | New rows would be mislabelled unless the label comes from the descriptor (DR-0006 rule 5). |
| P3 | `slim` is LinkedIn-shaped. It quarantines a body under 1,024 characters or without `/jobs/view/`. The fetch loop then commits that day as covered. | `src/core/slim.mjs:10,17,45`; `src/cli/fetch-loop.mjs:53-57,67` | A three-card Welcome to the Jungle plain-text body is short and has no `/jobs/view/`. Fetching it today would log a quarantine line, cache nothing, and mark the day covered: silent loss with a clean ledger. US-03 (fetch into the cache) must come before any real fetch. |
| P4 | `update` is single-source. `source` is `DEFAULT_SOURCE` (`'linkedin'`) at both call sites, and the range plan refuses a source with no ledger (`update.no-baseline`). DR-0016 already lists "a second source is added" as a revisit trigger. | `src/cli/harvest.mjs:74,547,609`; `src/core/update-plan.mjs:22,56`; DR-0016 Exceptions | The 05:30 run needs a decision on how it covers a second source and on first-run baseline (US-04, morning update brings both). |

Facts that help: coverage intervals are already keyed by `source` (`fetch-loop.mjs:35,68`), `fetch --source` already resolves a descriptor (`harvest.mjs:169`), and the cache is keyed by message id, so two senders do not collide in it. The open design question the human raised (is coverage and the cache per sender) is therefore narrower than it looks: coverage is per source today, the cache is shared, and the unanswered parts are quarantine (P3), `update` (P4) and what the probe and verification do with a second sender. Recorded as OQ-06 (coverage and cache per sender); not decided here.

Also relevant: spike finding F5 (plain text is the parse target, HTML not needed) was established for LinkedIn. In the Welcome to the Jungle plain text, title, salary and location run together on one line with no delimiter (`Technical Product Lead Salary above your minimum Remote (within the UK)`), and company and tagline run together too. The title/location boundary works only while the location is a known string; every card seen says `Remote (within the UK)`. Whether F5 carries over is the riskiest unknown in the feature. It is OQ-01 (HTML spike).

---

## Wave: DISCUSS / [REF] Locked Decisions

| ID | Decision | Status | Source |
|---|---|---|---|
| D-01 | Backend, brownfield; lightweight UX; no walking skeleton; JTBD on; density lean plus ask-intelligent | LOCKED (human) | task brief |
| D-02 | Welcome to the Jungle (sender `help@welcometothejungle.com`) is a new source behind the existing registry seam | LOCKED (human) | task brief |
| D-03 | A job seen on two sources is two rows; keys are namespaced by source | LOCKED | DR-0006 rule 3 |
| D-04 | `extract` returns an array; no source shape field | LOCKED | DR-0006 rule 1 |
| D-05 | A message matching no source is reported, never dropped | LOCKED in the record, not yet true in the build (P1) | DR-0006 rule 2 |
| D-06 | A source with no search term produces no Sources-tab rows | LOCKED | DR-0006 rule 4 |
| D-07 | `Source Type` classification stays global | LOCKED | DR-0006 Consequences |
| D-08 | The fuzzy key (company, title, location, normalised) is the dedup fallback for a source with no canonical id | LOCKED as strategy; whether it applies here is unconfirmed until OQ-01 | DR-0006 rule 3 |
| D-09 | Build derives every row from the whole cache; nothing derived is stored | LOCKED | DR-0009 |
| D-10 | Slices: five, in this order: US-01 digest to rows, US-02 yield stays truthful, US-03 fetch into the cache, US-04 morning update brings both, US-05 salary where stated | PROPOSED (Luna), for the human to accept | this wave |
| D-11 | Slice 1 is "one real digest produces all its jobs as rows", not "one job per message", because the sample body held three jobs under a subject naming one | PROPOSED | F1 lesson (spike findings) |
| D-12 | Slice 1 is proven offline with `harvest --in <dir> --out <file>` on a copy of one message, so it touches neither the real cache nor the Sheet | PROPOSED | `--in` rebuild form |

## Wave: DISCUSS / [REF] Open Questions (the human's domain)

Each carries my recommendation. None is decided here.

| ID | Question | Recommendation | If you choose otherwise |
|---|---|---|---|
| OQ-01 (HTML spike) | Is the plain text enough to split company from tagline and title from location, and does the HTML hold a job id or a direct advert link? Only one body was read, plain text only. | Yes, spike first: half a day, local, read the HTML of up to five messages, record structure only (no content) in the delta. Run it before US-01 (digest to rows). | Skip the spike: US-01 becomes the experiment. If it fails its hypothesis the cache record widens (see OQ-02) and US-01 is redone. |
| OQ-02 (cache holds HTML?) | If plain text is not enough, the cache record (`date, id, plaintextBody, sender, snippet, subject`) must keep the HTML part, or a derived structured form. That changes DR-0001's record shape and `toMessage`. | Decide only after OQ-01. Prefer a structured form over raw HTML if the spike allows. | Keep raw HTML (about 60 to 73 KB a message, roughly 1 to 2 MB a year at this volume; the personal-data cost is the larger concern). |
| OQ-03 (non-GBP salary) | Salary appears as `$229-258K`, `£118K`, `€100-110K`, `Salary above your minimum`, or nothing. The Jobs columns are annual min and max with no currency, and the existing parser is GBP only. | US-05 writes GBP into the annual columns and leaves every other form blank. Writing 229000 under a column that reads as pounds would mislead. | A currency column, which is a column-ownership decision under DR-0004 (one owner per column) and a header migration. |
| OQ-04 (Advert Link) | The links seen are click-tracking redirects. Store the redirect as the Advert Link, leave it blank, or use a direct link if the HTML has one? | Store whatever link the card carries, so the row is actionable. Never commit it. Re-check after OQ-01. | Blank: the row is not actionable. A redirect may expire or identify the recipient in the Sheet. |
| OQ-05 (yield treatment) | Welcome to the Jungle sightings have no search term. DR-0015 rule 3 puts every term-less sighting in one `(no search term)` row, and its reconciliation says the total equals the Jobs row count. | One `(no search term)` row per source, labelled with the source label, `unique` shown `-`. Keeps the total reconciled and LinkedIn's per-search figures untouched. Needs a DR-0015 amendment (DESIGN). | Exclude the new source from the yield: the total no longer equals the Jobs row count and the Y4 reconciliation tests change. |
| OQ-06 (coverage and cache per sender) | Is coverage per sender and the cache shared (as the code does today), and what should quarantine, the sender probe and the fetch verification do for a second sender? | DESIGN decides. Evidence: ledger intervals carry `source`; cache keyed by message id; `fetch --source` exists; P3 (quarantine commits coverage) is the open defect. | none |
| OQ-07 (unreadable card) | LinkedIn's extractor throws and refuses the whole message when a card cannot be read, which fails the whole build. For a new, less proven parser that would stop LinkedIn rows too. | Contain it: report the message id as unparsed and keep building. US-01 AC-6 is written this way and is pending your answer. | Throw as LinkedIn does: fails loud, but a Welcome to the Jungle template change blocks the 05:30 build for both sources. |
| OQ-08 (`update` and a second source) | Loop over every registered source, or add `--source`? What happens at first run when the new source has no ledger (`update.no-baseline`)? | Loop over all sources with a fetch capability; seed the new source with an explicit `--from` once, not by silently defaulting. DESIGN to confirm. DR-0016's own revisit trigger is this case. | `--source` per run: two scheduled jobs, or a manual second command. |
| OQ-09 (backfill depth) | How far back does the first fetch reach? | From the earliest Welcome to the Jungle message still in Gmail (about 45 days, about 10 messages, were seen). | A fixed shorter window. |
| OQ-10 (spike is yours to call) | Whether any spike beyond OQ-01 is needed, for example a live check that a second-sender `fetch` leaves LinkedIn coverage unchanged. | Cover it by an acceptance scenario in US-03 (fetch into the cache) rather than a spike. | A spike. |
| OQ-11 (Sources tab) | W2tJ yields no Sources rows (D-06). Dan then has no per-source "is this alert still arriving" signal in the Sheet. | Accept for now; the closing fetch line shows message counts. | A Sources row keyed on source with an empty term, which DR-0010 would need extending. |
| OQ-12 (source naming) | Source id and label: `wttj` and `Welcome to the Jungle`. The label is a cell value Dan's filters will use. | Accept. Treat the label as a contract once shipped (as DR-0014 does for family labels). | Another label. |

## Wave: DISCUSS / [REF] Out-of-Scope

| Item | Placement | Reason |
|---|---|---|
| Google Jobs, Cord, BBC and ITV alerts | out | other senders; each is its own feature behind the same seam. Nothing found here changes that. |
| Jobs/Redefined, Built In, LinkedIn `jobs-noreply` | out | DR-0006 queue; separate features |
| `Source Type` classification per source | out | stays global (DR-0006 Consequences) |
| Role Family table changes (DR-0014 classified from title) | out, verify only | US-01 checks Welcome to the Jungle titles classify; no pattern is added |
| Fit-scorer defect (Capgemini case) | out | carried-forward known defect (DR-0006) |
| Yield summary (DR-0015) | in, US-02 (yield stays truthful) | W2tJ would otherwise fill the `(no search term)` row |
| Sources tab | out | no rows by rule (D-06); see OQ-11 (Sources tab) |
| Cross-source duplicate detection | out | two rows is deliberate (D-03) |
| Deriving `Onsite/Hybrid/Remote` from location | out | human-owned column (DR-0004) |
| Hourly or day-rate salary | out | human-owned columns |
| "See all top matches" page, email frequency settings | out | not in the alert body's job data |
| Changing LinkedIn behaviour | out | LinkedIn rows must stay identical (guardrail) |

## Wave: DISCUSS / [REF] WS Strategy

No new walking skeleton (human decision; the seam exists). Test approach for DISTILL, by recommendation: the real CLI in a subprocess against a synthetic or redacted cache, with the Gmail and Sheets loopback fakes, as `search-yield-summary` and `sheets-api-target` did. The strategy letter is DISTILL's to assign.

## Wave: DISCUSS / [REF] Driving Ports

| Port | Used by |
|---|---|
| `harvest --in <dir> --out <file>` (rebuild) | US-01 (digest to rows) |
| `harvest build [--dry-run] [--target sheets]` | US-01, US-02 (yield stays truthful) |
| `harvest fetch --source <id> --from <d> --to <d>` | US-03 (fetch into the cache) |
| `harvest update [--from <d>] [--dry-run]` | US-04 (morning update brings both) |
| Jobs tab cells | US-05 (salary where stated) |

## Wave: DISCUSS / [REF] Pre-requisites

- Human answers to OQ-01 (HTML spike) and OQ-07 (unreadable card) before DISTILL of US-01. DESIGN may start without them.
- US-02 (yield stays truthful) before US-03 (fetch into the cache): once real mail is cached, every build includes it.
- US-03 before US-04 (morning update brings both).
- Gmail credential and the Sheets target already work (DR-0011, DR-0012). No new credential or scope.
- A redacted fixture of one real message, made by the rule in *Fixture Redaction* below.

## Wave: DISCUSS / [REF] Fixture Redaction (applies to every slice)

Real message content is personal data. A committed fixture is made from a real message by: replacing every URL with `https://example.invalid/<n>`; removing unsubscribe and manage-notification tokens; replacing the recipient's first name in the greeting; replacing the Gmail message id and the sender's tracking identifiers with invented values; and keeping card text (employer, tagline, title, salary, location), which is public advert content. The unredacted original stays outside the repository. No raw body, token or tracking link may be committed, in a fixture, a test, a doc or a log line. Each slice brief repeats this.

---

## Wave: DISCUSS / [REF] Story Map

Backbone, Dan's morning: **Receive** (mail arrives) → **Fetch** (into the cache) → **Parse** (digest to adverts) → **Build** (rows, yield) → **Triage** (read the Sheet).

| Receive | Fetch | Parse | Build | Triage |
|---|---|---|---|---|
| | US-03 fetch into the cache | US-01 digest to rows | US-02 yield stays truthful | US-05 salary where stated |
| | US-04 morning update brings both | | | |

Skeleton: none (D-01). Release order is the slice order, by learning leverage: US-01 tests the riskiest assumption (can a card be split reliably from plain text), US-02 removes a hazard that would corrupt something that works, US-03 and US-04 remove silent-loss hazards before the schedule touches the new source, US-05 is separable.

### Priority Rationale

1. US-01 first: highest uncertainty (OQ-01), and every later slice needs its extractor.
2. US-02 before US-03: once Welcome to the Jungle mail is cached, every build, including the 05:30 one, would put its adverts in the `(no search term)` row and distort the LinkedIn comparison Dan relies on.
3. US-03 before US-04: the quarantine rule (P3) would otherwise lose the mail with a clean ledger.
4. US-04 last of the pipeline slices: it is the only one that touches the live schedule.
5. US-05 last: independent, lowest risk, and `Salary above your minimum` carries no figure whatever is built.

### Slice Taste Tests

| Test | Result |
|---|---|
| A slice ships four or more new components | Pass. Largest is US-01: one descriptor, `harvest()` through the registry, one label. |
| Every slice depends on a new abstraction | Pass. The abstraction (registry) exists; US-01 wires it. |
| No slice disproves a pre-commitment | Pass. Each slice names what it disproves. |
| A slice uses only synthetic data | Pass with a note. Committed fixtures are redacted real messages; the dogfood step in US-01, US-03 and US-04 uses real mail. |
| Two slices differ only in scale | Pass. |

Slice briefs: `slices/slice-01-digest-to-rows.md`, `slice-02-yield-stays-truthful.md`, `slice-03-fetch-into-the-cache.md`, `slice-04-morning-update-brings-both.md`, `slice-05-salary-where-stated.md`.

---

## Wave: DISCUSS / [REF] User Stories

System constraints, all stories: `src/core` is pure, with no classes, mutation or `node:` builtins; adapters hold I/O; `src/cli` composes (project CLAUDE.md, DR-0013 layering). LinkedIn output must not change. No personal data in committed files.

Shared artifacts, single sources:

| Artifact | Source of truth | Consumers |
|---|---|---|
| Source label | the descriptor's `label` | Jobs `Source`, yield rows |
| Dedup key | the descriptor's `dedupKey` | Jobs `Dedup Key`, `Times Seen`, yield, Companies |
| Sender address | the descriptor's `sender` | Gmail query, `matches` |
| Coverage interval | `.cache/coverage.json`, one list per source id | fetch loop, update range |
| Advert link | the extractor | Jobs `Advert Link` |

### US-01: A Welcome to the Jungle digest becomes all of its jobs as rows

job_id: J-001 (capture every advertised job in one tracker)
Slice: slice-01-digest-to-rows. Estimate: 1 day, after the spike (OQ-01).

#### Problem
Dan receives a Welcome to the Jungle email whose subject names one job but whose body carries three. He reads these by hand because none of it reaches his tracker. LinkedIn had the same shape (finding F1) and subject-only parsing would have lost two thirds of the jobs. A Welcome to the Jungle message in the cache today produces zero rows and no report (P1).

#### Who
Dan, building the tracker offline from a folder of cached messages, before anything touches his real Sheet.

#### Solution
A Welcome to the Jungle source whose extractor returns one advert per card in the digest. `build` routes every message through the registry, labels each row from its source, and reports a message that no source claims.

### Elevator Pitch
Before: Dan cannot get any Welcome to the Jungle job into the tracker.
After: run `harvest --in <folder holding one redacted digest> --out welcome.xlsx` → the Jobs tab of `welcome.xlsx` holds one row per card (three rows for the sample), each with `Source` = `Welcome to the Jungle`, the job title in `Job`, the employer alone in `Company`, and `Remote (within the UK)` in `Location`.
Decision enabled: whether the parser is good enough to point at his real cache and Sheet.

#### Domain Examples
1. Happy path: the digest (invented names) `[ Northwind Analytics Open-source dashboards for product teams | Technical Product Lead Salary above your minimum Remote (within the UK) ]`, a second card for Fabrikam Security's "Engineering Manager (AI Platform)" and a third for Contoso Data's "Product Manager (Monitoring)" gives three rows. Companies are `Northwind Analytics`, `Fabrikam Security`, `Contoso Data`.
2. Resend: the next day's digest repeats the Northwind card and adds a new one. The Jobs tab holds four rows, and Northwind's `Times Seen` is 2.
3. Edge: a card with no salary (the Contoso card) and a card whose title ends in a bracket, "(AI Platform)", both keep their full title; the bracket is not read as a location.
4. Error: a message from `newsletter@example.invalid` sits in the same folder. Its id and sender are reported on stderr and no row is invented.

#### UAT Scenarios (BDD)
Scenario: Every card in a digest becomes a row
  Given a cached Welcome to the Jungle alert advertising three jobs under a subject that names the first
  When Dan builds a workbook from the folder
  Then the Jobs tab holds three Welcome to the Jungle rows, one per card

Scenario: Company is the employer alone
  Given the card for Northwind Analytics with its tagline
  When Dan builds
  Then the row's Company is `Northwind Analytics` and the tagline is not part of it

Scenario: A resent job is one row seen twice
  Given two cached alerts, the second repeating the Northwind card
  When Dan builds
  Then Northwind appears once, with Times Seen 2 and First Seen from the earlier alert

Scenario: LinkedIn rows are untouched beside the new source
  Given a folder holding the LinkedIn fixtures and one Welcome to the Jungle alert
  When Dan builds
  Then every LinkedIn row is cell-for-cell what a LinkedIn-only build produces

Scenario: A message nobody claims is reported
  Given a cached message from a sender no source matches
  When Dan builds
  Then stderr names the message id and sender, and no row is added for it

Scenario: One unreadable card does not stop the build (pending OQ-07)
  Given a Welcome to the Jungle alert one of whose cards cannot be split
  When Dan builds
  Then the alert's id is reported as unparsed and every other message still produces its rows

Scenario: Role Family comes from the title
  Given the three sample cards
  When Dan builds
  Then each row's Role Family is the family its title classifies to, as for a LinkedIn advert

#### Acceptance Criteria
- [ ] AC-1: a digest of N cards gives N rows; the subject is not used to decide how many.
- [ ] AC-2: Company holds the employer only (pending OQ-01, HTML spike, for the method).
- [ ] AC-3: a resend collapses on the dedup key; `Times Seen`, `First Seen` and `Last Seen` follow (DR-0009).
- [ ] AC-4: LinkedIn rows are unchanged, cell for cell.
- [ ] AC-5: an unclaimed message is reported by id and sender, never dropped (DR-0006 rule 2).
- [ ] AC-6: an unreadable Welcome to the Jungle message is reported and does not stop other rows (pending OQ-07, unreadable card).
- [ ] AC-7: the fixture is redacted as in *Fixture Redaction*.

#### Outcome KPIs
- Who: Dan. Does what: finds every card of a Welcome to the Jungle digest as a row. By how much: 100% of cards (3 of 3 in the sample; 0% today). Measured by: acceptance scenario over the redacted fixture, and one run on the unredacted original that Dan inspects. Baseline: 0 rows from this sender.
- Guardrail: LinkedIn rows differ in 0 cells.

#### Technical Notes
- Dependencies: OQ-01 (HTML spike), OQ-04 (Advert Link), OQ-07 (unreadable card). Tracked, not resolved.
- Risk: DR-0010's Companies key is a parsed string. A Welcome to the Jungle employer spelled differently from LinkedIn's makes two Companies rows. Not solved here.
- Risk: DR-0009's revisit trigger ("a source arrives with no stable id") may fire. `Times Seen` is meaningful for this source only while the fuzzy key is stable.
- `harvest()` going through the registry changes a core interface; DR-0006 rule 5 already says it should. DESIGN decides whether that needs a record.

### US-02: The search yield stays truthful with a second source present

job_id: J-002 (know which alert searches earn their place)
Slice: slice-02-yield-stays-truthful. Estimate: 0.5 to 1 day.

#### Problem
Dan tightens LinkedIn alerts by reading the per-search yield table. Welcome to the Jungle adverts carry no search term, so by DR-0015 rule 3 they would land in the `(no search term)` row and in the total, raising its `other` share and hiding which LinkedIn searches are noisy.

#### Who
Dan, after a build, deciding which LinkedIn search to edit.

#### Solution
The yield gives Welcome to the Jungle adverts their own labelled row and leaves every LinkedIn figure as it was (OQ-05 recommends this).

### Elevator Pitch
Before: with Welcome to the Jungle rows in the cache the LinkedIn yield table would be wrong, and Dan could not tell.
After: run `harvest build --dry-run` → stderr shows the same per-search rows for LinkedIn as before, a separate `(no search term) Welcome to the Jungle` row with `unique` `-`, and a total equal to the Jobs row count.
Decision enabled: which LinkedIn search to tighten, unaffected by the new source.

#### Domain Examples
1. Cache holds four LinkedIn searches (invented: `agile coach in Examplestan`) and a three-card Welcome to the Jungle digest. The four LinkedIn rows equal their LinkedIn-only values; a new row shows found 3.
2. Welcome to the Jungle only (no LinkedIn): fewer than two named searches, so no block is printed, as DR-0015 rule 5 already says.
3. A LinkedIn alert with a garbled search line (term null) and a Welcome to the Jungle alert: two separate unparsed rows, one per source.

#### UAT Scenarios (BDD)
Scenario: LinkedIn search rows do not change
  Given a cache of four LinkedIn searches
  When Dan builds before and after a Welcome to the Jungle digest is cached
  Then every LinkedIn search row prints the same figures

Scenario: The new source has its own row
  Given a cached three-card Welcome to the Jungle digest and two or more LinkedIn searches
  When Dan runs a dry-run build
  Then a row labelled for Welcome to the Jungle shows found 3 and unique `-`

Scenario: The total still equals the Jobs rows
  Given both sources in the cache
  When Dan builds
  Then the `all searches` found equals the number of Jobs rows

Scenario: LinkedIn's own unparsed alerts stay separate
  Given a LinkedIn alert with no readable search line and a Welcome to the Jungle digest
  When Dan builds
  Then the two are different rows

#### Acceptance Criteria
- [ ] AC-1: LinkedIn rows' figures are identical with and without the new source cached.
- [ ] AC-2: the new source shows on its own row, `unique` `-`, never counted as "another search" in anyone's unique reckoning.
- [ ] AC-3: total found equals the Jobs row count; total `other` equals Jobs rows with Role Family `other`.
- [ ] AC-4: stdout and `--report` still carry no yield line.

#### Outcome KPIs
- Who: Dan. Does what: reads LinkedIn per-search figures unchanged after the second source is added. By how much: 0 differing figures across all LinkedIn rows. Measured by: acceptance scenario comparing the two builds. Baseline: figures as of the shipped DR-0015 behaviour.

#### Technical Notes
- Depends on US-01 (digest to rows) for rows to count. Depends on OQ-05 (yield treatment); amends DR-0015 rule 3 if accepted.
- Reconciliation tests (Y4) from `search-yield-summary` are the oracle and stay unchanged for LinkedIn.

### US-03: Welcome to the Jungle mail is fetched into the cache without being lost

job_id: J-001 (capture every advertised job in one tracker)
Slice: slice-03-fetch-into-the-cache. Estimate: 1 day.

#### Problem
`fetch` knows one sender. The check that guards against truncated mail is built for LinkedIn, so a Welcome to the Jungle message would be quarantined, not cached, and its day marked covered (P3). Dan would believe the day was harvested.

#### Who
Dan, running `fetch` by hand for the first time against the new sender.

#### Solution
`fetch --source <the new id>` fetches its sender's mail, caches it, and applies a sanity check that fits that source. Coverage for the new source is recorded beside LinkedIn's without changing it.

### Elevator Pitch
Before: Welcome to the Jungle mail never reaches the cache, and a fetch of it would mark days covered with nothing cached.
After: run `harvest fetch --source wttj --from 2026-09-11 --to 2026-10-25` → stdout prints `harvest fetch: <day>..<day> — <n> message(s)` per day, no `quarantined` line for a healthy digest, and the cache holds the messages.
Decision enabled: whether to trust this source in the scheduled run.

#### Domain Examples
1. 2026-10-09 has one digest of three cards. It is cached; the line reads `... — 1 message(s)`.
2. A day with no Welcome to the Jungle mail is committed as covered with `0 message(s)`, as for LinkedIn.
3. A truncated digest (body cut in the middle of a card) is quarantined, reported by id and reason, and the day is not committed as covered (this differs from today's behaviour for quarantine and is pending OQ-06, coverage and cache per sender).

#### UAT Scenarios (BDD)
Scenario: A healthy digest is cached
  Given Gmail holds one Welcome to the Jungle digest on 2026-10-09
  When Dan fetches that day for the new source
  Then the message is in the cache and the day is covered with one message

Scenario: LinkedIn coverage is untouched
  Given LinkedIn is covered through 2026-10-24
  When Dan fetches the new source for the same days
  Then LinkedIn's intervals are byte-identical afterwards

Scenario: A quiet day is covered, not an error
  Given no Welcome to the Jungle mail on 2026-10-12
  When Dan fetches that day
  Then the day is covered with zero messages

Scenario: A truncated digest is not mistaken for a covered day
  Given a Welcome to the Jungle digest whose body stops mid-card
  When Dan fetches its day
  Then the message is reported as quarantined and the day is not recorded as fully harvested (pending OQ-06)

Scenario: The new sender matching nothing is named
  Given the mailbox has no mail from the new sender
  When Dan fetches
  Then the run refuses and names the sender, as the LinkedIn probe does

#### Acceptance Criteria
- [ ] AC-1: a healthy digest is cached and its day committed.
- [ ] AC-2: LinkedIn's coverage and cache are unchanged by a second-sender fetch.
- [ ] AC-3: no day is committed as covered while one of its messages was set aside without being reported.
- [ ] AC-4: the truncation check is the descriptor's, not LinkedIn's (shape decided in DESIGN).
- [ ] AC-5: a real run on Dan's mailbox for the earliest available days shows each cached digest parses to its cards (US-01).

#### Outcome KPIs
- Who: Dan. Does what: finds every Welcome to the Jungle message in Gmail for the window present in the cache. By how much: 100% of listed messages cached or reported (about 10 in 45 days; 0 today). Measured by: fetch lines plus a count of cached records from the sender. Baseline: 0.

#### Technical Notes
- Depends on US-01 (digest to rows) and US-02 (yield stays truthful). Decision on quarantine and coverage: OQ-06.
- Live Gmail is used in the dogfood step only. Tests use the Gmail loopback fake. The mailbox is personal data.

### US-04: The 05:30 update brings both sources into the Sheet

job_id: J-003 (have the tracker current without attention)
Slice: slice-04-morning-update-brings-both. Estimate: 1 day.

#### Problem
`harvest update` is wired to LinkedIn only. A second source needs its own range, and a source with no ledger makes the planner refuse (`update.no-baseline`). A naive change would make the 05:30 run fail every morning, or fetch one source and build a Sheet with a gap in the other.

#### Who
Dan, asleep, with the LaunchAgent firing.

#### Solution
`update` fetches each registered source in turn, builds only if every fetch succeeded, and reports per source. The first run for a new source needs an explicit start day.

### Elevator Pitch
Before: the morning run never brings Welcome to the Jungle jobs into the Sheet.
After: run `harvest update --dry-run` → stdout names each source with the range it would fetch and the uncovered days (for example `would fetch 2026-10-09..2026-10-25, 17 uncovered day(s)`), then the build preview; run `harvest update` → the closing line reports the days fetched and that the Sheet was built, and the new adverts are in the Jobs tab.
Decision enabled: whether to leave the schedule alone or run something by hand.

#### Domain Examples
1. Both sources covered through yesterday; new mail in each. The run fetches both, builds, and the Sheet gains rows from both.
2. Only Welcome to the Jungle has nothing new. The run says so for that source and still builds.
3. First morning after release: no Welcome to the Jungle ledger. Without `--from` the run refuses before fetching anything, naming the source and the fix.
4. LinkedIn fetch succeeds, Welcome to the Jungle fetch fails. No build runs, exit 1, the failure names the source and stage, and LinkedIn's committed days are kept.

#### UAT Scenarios (BDD)
Scenario: One run brings in both sources
  Given both sources have new mail since yesterday
  When the scheduled update runs
  Then the Sheet holds the new adverts from both and the run reports success

Scenario: A failure in either source stops the build
  Given the Welcome to the Jungle fetch fails
  When the update runs
  Then no build happens, the exit is 1, and the failure names the source

Scenario: A new source with no history is explained, not guessed
  Given no ledger exists for the new source and no start day is given
  When the update runs
  Then it refuses before any fetch, names the source and says to give a start day

Scenario: A preview never fetches
  Given both sources have uncovered days
  When Dan runs the update with `--dry-run`
  Then each source's range and uncovered days are printed and no Gmail call or write is made

Scenario: LinkedIn alone still works
  Given only the LinkedIn ledger exists and the new source is not yet seeded
  When the update runs with a start day for the new source
  Then both sources are fetched from their own start days

#### Acceptance Criteria
- [ ] AC-1: a successful run fetches every registered source before one build.
- [ ] AC-2: any source's failure or partial fetch exits 1 and skips the build (DR-0016 fail closed).
- [ ] AC-3: a source with no ledger and no start day refuses before any fetch, naming the source.
- [ ] AC-4: `--dry-run` holds no fetch capability and writes nothing, per source.
- [ ] AC-5: the real 05:30 run after release adds Welcome to the Jungle rows with no manual step (observed once by Dan).

#### Outcome KPIs
- Who: Dan. Does what: starts the day with Welcome to the Jungle adverts already in the Sheet. By how much: 7 of 7 mornings in the first fortnight with no manual command for either source. Measured by: the log under `.cache/logs/` and the Sheet's `Last Seen` for the new source. Baseline: 0 of 7.
- Guardrail: LinkedIn rows added per day unchanged.

#### Technical Notes
- Depends on US-03 (fetch into the cache). Decision: OQ-08 (`update` and a second source), which is DR-0016's own revisit trigger.
- The scheduled job runs whatever the checkout holds when it fires (DR-0018), so this slice merges to `main` only when its acceptance tests pass.

### US-05: A stated salary appears in the Sheet

job_id: J-001 (capture every advertised job in one tracker)
Slice: slice-05-salary-where-stated. Estimate: 0.5 day. May ship after the others.

#### Problem
Some cards state a salary and Dan wants it in the row to judge a role without opening the email. Four forms occur: none, `Salary above your minimum`, `Salary: $229-258K`, `£118K`, `€100-110K`. The existing parser reads pounds only, and the annual columns carry no currency.

#### Who
Dan, triaging new rows in the Sheet.

#### Solution
The extractor reads a stated sterling salary into the annual columns and leaves other forms blank (OQ-03 recommends this).

### Elevator Pitch
Before: salaries on Welcome to the Jungle cards are lost.
After: run `harvest --in <folder> --out welcome.xlsx` → a `£118K` card shows 118000 in `Min Salary (annual)` and `Max Salary (annual)`; a `£90-110K` card shows 90000 and 110000; `$`, `€` and `above your minimum` cards show both cells blank.
Decision enabled: whether a role clears Dan's pay floor without opening the email.

#### Domain Examples
1. `£118K` gives min 118000, max 118000.
2. `£90-110K` gives min 90000, max 110000.
3. `$229-258K`, `€100-110K` and `Salary above your minimum` give blanks, and the row still exists.
4. A title containing a number such as "Head of Delivery 2" is not read as a salary.

#### UAT Scenarios (BDD)
Scenario: A single sterling figure
  Given a card stating £118K
  When Dan builds
  Then both annual cells read 118000

Scenario: A sterling range
  Given a card stating £90-110K
  When Dan builds
  Then the annual cells read 90000 and 110000

Scenario: Another currency is not guessed
  Given cards stating $229-258K and €100-110K
  When Dan builds
  Then both rows exist with the annual cells blank

Scenario: No figure, no cell
  Given cards stating nothing and "Salary above your minimum"
  When Dan builds
  Then the annual cells are blank

#### Acceptance Criteria
- [ ] AC-1: `£N K` and `£N-M K` fill the annual columns.
- [ ] AC-2: any other currency or phrase leaves them blank and never drops the row.
- [ ] AC-3: salary text never changes the Job or Company cell, or the dedup key.

#### Outcome KPIs
- Who: Dan. Does what: sees stated sterling salaries without opening the email. By how much: every sterling salary in a fixture of the four observed forms appears (100%). Measured by: acceptance scenario. Baseline: 0.

#### Technical Notes
- Depends on US-01 (digest to rows). Decision: OQ-03 (non-GBP salary).
- A title/salary/location run on one plain-text line makes this the second consumer of the same boundary question as US-01 (OQ-01, HTML spike).

---

## Wave: DISCUSS / [REF] Acceptance Criteria Summary

Embedded per story above. Every Elevator Pitch "After" names a real command. Acceptance criteria marked "pending" wait on a human decision, not on clearer wording: US-01 AC-2 (company method, OQ-01), US-01 AC-6 (unreadable card, OQ-07), the truncated-digest scenario and AC-3 of US-03 (quarantine and coverage, OQ-06).

## Wave: DISCUSS / [REF] Outcome KPIs

| # | Who | Does what | By how much | Baseline | Measured by | Type |
|---|---|---|---|---|---|---|
| 1 | Dan | Finds each Welcome to the Jungle card as a Jobs row | 100% of cards | 0 | acceptance over redacted fixture; one real run | leading |
| 2 | Dan | Loses no Welcome to the Jungle message silently | 0 messages neither cached nor reported | not measurable today | fetch lines vs cache count | leading |
| 3 | Dan | Reads unchanged LinkedIn rows and yield | 0 differing cells or figures | current | acceptance comparison | guardrail |
| 4 | Dan | Sees one row per advert after resends | 0 duplicates in a 10-message real fortnight | n/a | Jobs rows vs distinct (company, title, location) | leading |
| 5 | Dan | Starts the day with both sources in the Sheet | 7 of 7 mornings, no manual command | 0 of 7 | `.cache/logs/`, Sheet `Last Seen` | lagging |

North star: KPI 2, no silent loss, because it is the failure Dan distrusts most (persona). Smell test: all five have a baseline and are measurable with existing output; none needs new instrumentation, except KPI 4, which needs a one-off count over the Sheet.

## Wave: DISCUSS / [REF] Definition of Done (9 items)

1. Every acceptance scenario of the story passes, and was seen failing first.
2. `npm test` and `npm run check:arch` pass; `src/core` has no `node:` import.
3. LinkedIn output is cell-for-cell unchanged (guardrail KPI 3).
4. Mutation testing runs on the nightly-delta strategy (project CLAUDE.md) and surviving mutants in changed code are examined.
5. The new behaviour is pinned by its own acceptance test, which fails if the behaviour is deleted.
6. A real-data dogfood step ran (Dan, on unredacted mail) and found nothing the fixture hid.
7. No raw body, token or tracking link in any committed file (fixtures, tests, docs, logs).
8. Docs that go stale are corrected in the same slice: `docs/reference/cli.md`, `docs/how-to/run-update-on-a-schedule.md` (not read in this wave), `docs/product/architecture/brief.md` (section 1 says other sources are out of scope; section 5 ports table), the README design table.
9. Reasoning is recorded where the next reader looks: a decision record for any changed contract (candidates: `harvest()` through the registry; the quarantine rule; yield per source; `update` over several sources).

## Wave: DISCUSS / [REF] DoR Validation

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Problem in domain language | PASS | each story opens with Dan's situation and pain (US-01 digest to rows: subject names one job, body carries three) |
| 2 | Persona specific | PASS | `dan-job-seeker`; a named operator with a 05:30 schedule |
| 3 | 3+ domain examples with real-shaped data | PASS | 3 to 4 per story; names are invented to match observed shapes, because the originals are personal data |
| 4 | UAT 3 to 7 scenarios | PASS | US-01: 7, US-02: 4, US-03: 5, US-04: 5, US-05: 4 |
| 5 | AC derived from UAT | PASS | each AC maps to a scenario |
| 6 | Right-sized | PASS, with a note | each slice at most 1 day; US-01 depends on a half-day spike if the human takes OQ-01 |
| 7 | Technical notes | PASS | constraints, risks and dependencies per story; P1 to P4 recorded |
| 8 | Dependencies resolved or tracked | PASS (tracked) | OQ-01, OQ-03, OQ-04, OQ-05, OQ-06, OQ-07, OQ-08 are open and owned by the human. Marked ACs depend on them. |
| 9 | Outcome KPIs measurable | PASS | KPI table above |
| + | JTBD traceability (`job_id`) | PASS | J-001, J-002, J-003 exist in `docs/product/jobs.yaml` |
| + | Elevator Pitch, real entry point | PASS | all five name a `harvest` command |
| + | No `@infrastructure`-only slice | PASS | every slice has a user-visible output; the registry wiring is a precursor inside US-01, not a slice |

Requirements completeness was not scored numerically. Functional, non-functional (no silent loss, LinkedIn unchanged, no personal data) and business-rule requirements (D-03 to D-09) are each covered. The honest gap is the part of each story that waits on an open question.

Per-wave peer review: not run (optional per the skill; the consolidated review is at the end of DISTILL). Triggers fired by `ask-intelligent`: compliance (the ACs mention personal data and redaction), which suggests `journey-deep-dive`. No menu is rendered here; the caller decides.

## Wave: DISCUSS / [REF] Upstream Contradictions

| # | Record | Says | Code or evidence says |
|---|---|---|---|
| C-1 | DR-0006 rules 2 and 5; D-14 and D-15 marked LOCKED in the job-alert-harvester delta | `harvest()` is source-agnostic; unmatched messages are reported | `harvest()` calls the LinkedIn extractor directly and the unmatched bucket is never reported by the build (P1, P2) |
| C-2 | Spike finding F5 (plain text is the parse target) | no HTML parser needed | true for LinkedIn; unverified for this sender, whose plain text merges fields (OQ-01) |
| C-3 | DR-0015 rule 3 and the Y4 reconciliation | every term-less sighting is one `(no search term)` row; the total equals the Jobs rows | a second source with no terms inflates that row (US-02) |
| C-4 | DR-0003 truncation check (job-alert-harvester delta Q5) | quarantine protects against truncated payloads | the check is LinkedIn-shaped, and a quarantined message still lets the day commit (P3) |
| C-5 | DR-0009 Exceptions | a source with no stable id makes `Times Seen` meaningless for it | Welcome to the Jungle appears to have none; the fuzzy key must be stable (US-01 technical notes) |
| C-6 | DR-0016 decisions 1 and 6 | `update` plans one source's range | named as a revisit trigger by DR-0016 itself (US-04) |

Where a decision record and the code disagree, the code is current truth and the record is the stated intent. Nothing was back-patched. Whether C-1 and C-4 need a new record or an amendment is DESIGN's and the human's call.

## Wave: DISCUSS / [REF] Handoff to DESIGN

Hand over this file, `slices/`, `docs/product/jobs.yaml`, `docs/product/personas/dan-job-seeker.yaml` and `docs/product/journeys/morning-update.yaml`. DESIGN should settle OQ-02 (cache holds HTML?), OQ-05 (yield treatment), OQ-06 (coverage and cache per sender), OQ-08 (`update` and a second source) and the shape of the descriptor-owned truncation check. The human owns OQ-01 (HTML spike), OQ-03 (non-GBP salary), OQ-04 (Advert Link), OQ-07 (unreadable card), OQ-09 to OQ-12 (backfill depth, further spikes, Sources tab, source naming).

---

# DESIGN wave (application scope, PROPOSE mode)

Doc type: Reference plus Explanation. Author: Morgan (solution architect). Date: 2026-10-26. Paradigm: functional (project CLAUDE.md). Nothing under `src/` or `tests/` was written and nothing was committed. Every verdict below is PROPOSED or OPEN: the human decides. The DISCUSS sections above are unchanged; changes to them are in `design/upstream-changes.md`.

Not run: the density resolver, `nwave-ai outcomes check-delta` (no shell; run it before DISTILL), telemetry events, any code. The ledger defect in the first contradiction below was found by reading and is not executed. Per-wave peer review was not run; two of its triggers apply (a contested record on cache form, and personal data now held as raw HTML), so the human may want it.

## Wave: DESIGN / [REF] Prior Wave Consultation

- ✓ `feature-delta.md` DISCUSS sections (premise checks P1 to P4, locked decisions, OQ-01 to OQ-12, US-01 to US-05, upstream contradictions, handoff)
- ✓ `slices/slice-01` to `slice-05`
- ✓ `spike/findings.md` and `spike/wave-decisions.md` (verdict PARTIAL)
- ✓ `docs/product/architecture/brief.md` sections 1 to 17
- ✓ `docs/product/jobs.yaml` (J-001 to J-003 read in part), ✓ `docs/product/journeys/morning-update.yaml` (steps 1 and 2 read)
- ✓ DR-0001, DR-0002, DR-0003, DR-0006, DR-0009, DR-0013, DR-0015, DR-0016 (read in full)
- ◐ DR-0004, DR-0007, DR-0010, DR-0014, DR-0018 (frontmatter and Context only)
- ✓ code: `gmail-message`, `slim`, `harvest`, `parse-linkedin`, `dedup`, `search-yield`, `update-plan`, `gmail-query`, `coverage`, `install-plan` (lines 68-107), `sources/registry`, `sources/linkedin`; adapters `gmail-api-source`, `message-cache`, `json-message-reader`, `ledger-store`; `cli/harvest.mjs` (lines 60-629), `cli/fetch-loop`, `cli/update`; `package.json`, `.dependency-cruiser.cjs`
- ⊘ `docs/product/personas/dan-job-seeker.yaml`, `docs/reference/cli.md`, `docs/how-to/run-update-on-a-schedule.md`, `tests/` bodies (not read; test coverage claims below come from grep only)
- ⊘ `.cache/` (personal data, never read)

No HTML parser exists in the project: `package.json` has one runtime dependency, `xlsx`, imported only by two adapters, and `src/` has no HTML handling.

## Wave: DESIGN / [REF] Contradictions Found

Where a record or report and the code disagree, the code wins and the line is cited. None is resolved by me: each needs the human or the product owner.

| # | Statement | Code says | Consequence |
|---|---|---|---|
| K-1 | DISCUSS line 59: coverage is "already keyed by `source`"; US-03 AC-2: LinkedIn coverage unchanged by a second-sender fetch | The ledger merge ignores `source`: `src/core/coverage.mjs:61-71` (`mergeIntervals`) and `:54-58` (`mergeTwo` keeps the first interval's source and sums counts); `src/adapters/ledger-store.mjs:62` merges every source together on commit. No test commits a second source through the store (tests seed other sources by writing the file). | A second source's commit would be absorbed into LinkedIn's interval or extend its `to`, claiming an unfetched LinkedIn day as covered: silent loss. Blocks slice 03. Not executed. |
| K-2 | DISCUSS and spike F5: plain text is the parse target | The messages have no `text/plain` part; `toMessage` refuses with `gmail.missing-plaintext-body` (`src/core/gmail-message.mjs:37-41`) | An HTML read path is needed first. |
| K-3 | P3: a W2tJ fetch would "log a quarantine line ... and mark the day covered" | For real messages `source.read` throws before `slim` is reached (`gmail-api-source.mjs:131` calls `toMessage`) | The first failure is a fetch error, not a quarantine. The quarantine-commits-the-day defect (`fetch-loop.mjs:62-73`) is real for any message that reaches `slim`. |
| K-4 | DR-0006 rule 3: the dedup key strategy is the descriptor's | The LinkedIn descriptor's `dedupKey` reads `rawJob.id` (`sources/linkedin.mjs:16`), but rows carry no `id`; the parser writes `dedupKey` itself (`parse-linkedin.mjs:134`). The descriptor field is never called. | The working precedent is "the extractor emits the key". The descriptor field is dead for LinkedIn. |
| K-5 | Brief section 4 and DR-0006 rules 2 and 5: the registry routes messages and the build is source-agnostic | `harvest()` calls `extractJobs` directly (`harvest.mjs:198`) and holds `SOURCE = 'LinkedIn'` (`harvest.mjs:11,123,159`) | Same as DISCUSS P1 and P2; confirmed. |
| K-6 | DISCUSS OQ-09: about 10 messages in 45 days | The spike re-read 100 messages from the same query (`findings.md`, Method) | Volume unreconciled; changes cache size and backfill. |
| K-7 | DISCUSS OQ-02: 60 to 73 KB a message | Spike: 42,984 to 64,847 characters, measured on the HTML | I use the spike figure. |
| K-8 | `update.no-baseline` text: "run harvest fetch --from <day> first" | `src/cli/update.mjs:5` names no source | With two sources the message is ambiguous. |
| K-9 | Install status warns when the daily update "would refuse" | `install-plan.mjs:74-77` checks one source (`DEFAULT_SOURCE`, `cli/harvest.mjs:609`) | An unseeded second source would not be warned about. |

## Wave: DESIGN / [REF] Quality Attributes and Constraints

Taken from brief section 8, unchanged. Integrity (no silent loss) is dominant; testability and maintainability high; reliability high; confidentiality medium; performance low. One operator, so no team-boundary conflict (Conway's law check: none). Style stays pure core / imperative shell, a modular monolith with dependency inversion: no style change is proposed. Simpler alternatives rejected for the new parts are listed per fork below.

## Wave: DESIGN / [REF] Fork Proposals

Each fork: options with one-line trade-offs, then the recommendation. All recommendations are PROPOSED. Detail for the first five is in the draft decision records.

Status 2026-10-27: the human accepted every recommendation below. The Decisions table carries the verdicts.

**Fork 1: how an HTML-only message is carried** (DR-0019 on the HTML read path)
- 1A. Add an optional `htmlBody` to the record; `toMessage` keeps `plaintextBody` when a text part exists and otherwise takes the HTML part; refuse only when neither exists. LinkedIn records stay byte-identical. Contract change is additive.
- 1B. Replace both fields with `body` plus a `bodyKind` the descriptor declares. Needs a migration of the existing cache or two readers, and a descriptor-declared kind is the shape field DR-0006 rule 1 rejects.
- 1C. Convert HTML to text in `toMessage` and keep `plaintextBody`. That is the connector's lossy conversion that fused fields, and it is an HTML parser anyway.
- Recommend 1A.

**Fork 2: cache form (OQ-02, cache holds HTML?)** (DR-0020 on the cache form)
- 2A. Keep the raw HTML as `htmlBody`; the build re-parses. Costs about 43 to 65 KB a message (about 5 MB per 100) and holds per-recipient unsubscribe and click tokens at rest, as the LinkedIn bodies already hold tracking parameters. Re-parse of history stays possible.
- 2B. Cache only extracted cards plus a template signature (the spike's lean). Small, no tokens. The parse is frozen at fetch time, which DR-0001 options 3 and 4 reject, and unknowns the spike left open (logo hash stability, older templates) cannot be revisited.
- 2C. Raw HTML with link and image values stripped at cache time. Less personal data, but it rewrites the source on the fetch path and loses the link, so the Advert Link falls to blank.
- Recommend 2A. Open: this is the human's call (OQ-02).

**Fork 3: reading HTML in a pure core** (DR-0021 on HTML scanning)
- 3A. A small scanner in `src/core` for known templates: closed entity table, comments and style bodies ignored, unknown entity or unbalanced tag is a refusal, not a guess. No new dependency. Risk is owning tokenizer edge cases (Stripo templates carry Outlook conditional comments); property tests with the existing `fast-check` mitigate.
- 3B. A library (`parse5` or `htmlparser2`; I believe both MIT, from memory, not verified: no shell). Cognitive load tax: the project's second runtime dependency, which would sit in a process holding Gmail and Sheets credentials, and no dependency-cruiser rule yet governs npm packages in core.
- 3C. Parse at the adapter edge and cache the structured result. Still needs a parser, and forces 2B.
- Recommend 3A, with a stated trigger to adopt 3B: a second HTML-only sender, or the first scanner defect found in dogfood.

**Fork 4: quarantine and drift** (DR-0022 on the coverage commit)
- 4A. A quarantined message blocks its day for every source (the loop refuses before committing, naming the ids), and the screen is the descriptor's. Restores DR-0002's rule that an interval is written only when every listed id is cached. A bad message wedges its day and stops `update` until fixed.
- 4B. Apply the block to the new source only. Avoids touching LinkedIn fetching but needs a per-source policy, which is the shape-field smell.
- 4C. Commit the day, keep the payload under `.cache/quarantine/`, report loudly. Nothing is "lost" but coverage claims a day with a missing message.
- Recommend 4A. The fetch loop's listing check is already per source (it queries `from:<sender>`); the only LinkedIn-shaped check is `slim`. A W2tJ quarantine looks like a message whose card structure fails the descriptor's screen: no card, a card without three paragraphs, a `<strong>` missing in paragraph 1 or 3, an `em` of other than one or two lines, or an unknown entity. Gmail itself is the retention for a quarantined message, so nothing is stored locally.

**Fork 5: coverage and cache per sender (OQ-06)** (DR-0022)
- 5A. One shared cache keyed by message id; coverage per source; fix the ledger merge to group by source.
- 5B. A cache directory per source. Breaks the rule that fixtures equal cache records and migrates about 3,000 files.
- 5C. A ledger file per source. Changes layout and the probe for no gain once the merge is fixed.
- Recommend 5A. The record already carries `sender`, which routes it at build.

**Fork 6: `update` with several sources (OQ-08)** (decision DDD-12 below; the record is raised at slice 04)
- 6A. Plan every source first (any source without a ledger and without `--from` refuses before any fetch, naming the source); fetch in registry order, stop at the first failure; build once if all succeeded. `--from` keeps its meaning (overrides every source's start), and seeding is `update --from <day>` or a manual `fetch --source wttj --from <day>`.
- 6B. `--from` applies only to sources with no ledger. Protects LinkedIn from an early `--from`, but changes DR-0016 decision 6.
- 6C. A `--source` option and two scheduled jobs. Contradicts the single job DR-0018 installs.
- Recommend 6A. Related and OPEN (DDD-17): DR-0016 and US-04 AC-2 make any source's failure skip the build, so a W2tJ template change would also stop the LinkedIn rows that morning. The alternative is to build from the sources that succeeded and exit 1 afterwards. Not recommended by me because it relitigates an accepted record, but the human should see it.

**Fork 7: yield for a source with no search term (OQ-05)** (DDD-11; DR-0015 amendment raised at slice 02)
- 7A. Partition the term-less sightings by source. LinkedIn's row keeps the label `(no search term)`; another source's row is `(no search term) <source label>` (38 characters for this one; the column is 40 wide). Unique shown `-`. Total still equals the Jobs rows.
- 7B. Exclude the new source: total no longer equals the Jobs row count.
- 7C. Keep one shared row, as DR-0015 rule 3 says today: it inflates LinkedIn's `other` share.
- Recommend 7A. Needs each sighting to carry its source id, which fork 8 supplies.

**Fork 8: registry wiring (P1)** (DR-0023 on registry routing)
- 8A. `harvest()` calls `extractAll`, which tags each row with `sourceId` and `sourceLabel` and returns the unmatched and unparsed lists; the build prints both on stderr.
- 8B. `harvest()` loops over descriptors itself. Duplicates the registry.
- 8C. Leave LinkedIn direct and add a W2tJ branch. The branch DR-0006 option 2 warned about.
- Recommend 8A.

**Fork 9: Advert Link and Source label (OQ-04, P2)**
- 9A. Store the card's click-tracking link (about 1,100 characters, per recipient). Actionable; identifies the recipient inside Dan's private Sheet; no code ever requests it.
- 9B. Leave the cell blank. Row is not actionable.
- 9C. Build a search link from company and title. I could not verify any site URL scheme, so not recommended.
- Recommend 9A; open (OQ-04). Label: from the descriptor (`Welcome to the Jungle`, id `wttj`).

## Wave: DESIGN / [REF] DDD List

| ID | Decision | Verdict | One-line rationale |
|---|---|---|---|
| DDD-01 | HTML read path: optional `htmlBody` beside `plaintextBody` | ACCEPTED 2026-10-27 | Additive; LinkedIn records unchanged (DR-0019, HTML read path) |
| DDD-02 | Cache keeps raw HTML; build re-parses | ACCEPTED 2026-10-27 | DR-0001: persist what cannot be re-derived (DR-0020, cache form) |
| DDD-03 | HTML read by a small core scanner, no library | ACCEPTED 2026-10-27 | Avoids a second runtime dependency for one template; revisit trigger set (DR-0021, HTML scanning) |
| DDD-04 | The descriptor owns a `screen`; a quarantined message blocks its day | ACCEPTED 2026-10-27 | Restores DR-0002's rule (DR-0022, coverage commit) |
| DDD-05 | Ledger merge groups by source | ACCEPTED 2026-10-27 (a defect fix, not a preference) | K-1 above (DR-0022, coverage commit) |
| DDD-06 | One shared cache, coverage per source | ACCEPTED 2026-10-27 | Fork 5 |
| DDD-07 | `build` routes through the registry; unmatched and unparsed are reported | ACCEPTED 2026-10-27 | DR-0006 rules 2 and 5 become true (DR-0023, registry routing) |
| DDD-08 | Source id and label travel on each row | ACCEPTED 2026-10-27 | Removes the constant `'LinkedIn'` (DR-0023) |
| DDD-09 | The extractor emits `fuzzyKey('wttj', company, title, location)`; salary text is not in the key | ACCEPTED 2026-10-27 | "Salary above your minimum" is recipient-relative; location was identical on all 197 cards, so the key is effectively company plus title and may merge two real adverts with one title (risk R-1) |
| DDD-10 | An unreadable W2tJ message is contained per message and reported; LinkedIn still throws | ACCEPTED 2026-10-27 | Policy is carried by a coded error, not a descriptor flag |
| DDD-11 | Yield: one term-less row per source | ACCEPTED 2026-10-27 | Fork 7 |
| DDD-12 | `update` loops registered sources; `--from` overrides all; fail fast | ACCEPTED 2026-10-27 | Fork 6; DR-0016's own revisit trigger |
| DDD-13 | Advert Link stores the card link | ACCEPTED 2026-10-27 | Fork 9 |
| DDD-14 | Salary: sterling only, from the `em` line; the raw text is kept on the row but not in the key | ACCEPTED 2026-10-27 | Agrees with the DISCUSS recommendation for OQ-03 |
| DDD-15 | Fixtures are synthetic reconstructions | ACCEPTED 2026-10-27 | U-13 in upstream-changes |
| DDD-16 | Enforcement: a new dependency-cruiser rule forbidding npm packages in core, plus a per-descriptor property: whatever the screen accepts, extract reads without error | ACCEPTED 2026-10-27 | Rules without enforcement erode |
| DDD-17 | A source's failure blocks the whole Sheet build (DR-0016 as written) | ACCEPTED 2026-10-27 | Fork 6 note |

## Wave: DESIGN / [REF] Component Decomposition

Change types: NEW, EXTEND, UNCHANGED. Contract shapes: pure (return only), bounded-change (declared write set).

| Path | Change | Responsibility after this feature | Contract shape |
|---|---|---|---|
| `src/core/gmail-message.mjs` | EXTEND | `toMessage` takes the HTML part when there is no text part; refuses only when neither exists | pure |
| `src/core/html-scan.mjs` | NEW | Total scan of an HTML string into an element tree, or a refusal result; no selectors | pure, total |
| `src/core/parse-wttj.mjs` | NEW | Finds anchor-wrapped card tables; maps paragraphs and `em` lines to company, title, salary text, location, link; refuses on any structural deviation | pure |
| `src/core/sources/wttj.mjs` | NEW | Descriptor: id `wttj`, label `Welcome to the Jungle`, sender `help@welcometothejungle.com`, `matches`, `extract`, `screen` | pure data |
| `src/core/sources/linkedin.mjs` | EXTEND | Gains `screen` (the existing drift rules, logic unchanged) | pure data |
| `src/core/sources/registry.mjs` | EXTEND | REGISTRY gains the new descriptor; `extractAll` tags rows with source id and label, contains coded refusals, returns `{ rows, unmatched, unparsed }` | pure |
| `src/core/slim.mjs` | EXTEND | Takes the screen as an argument (one-argument callers keep LinkedIn's); `htmlBody` joins the kept keys when present | pure |
| `src/core/coverage.mjs` | EXTEND | `mergeIntervals` merges only within one source | pure |
| `src/core/harvest.mjs` | EXTEND | Calls `extractAll`; `Source` from the row; returns `unmatched` and `unparsed` beside `searchYield` | pure |
| `src/core/search-yield.mjs` | EXTEND | Term-less sightings partition by source | pure, total |
| `src/core/update-plan.mjs` | EXTEND | Plans, previews and summarises per source | pure |
| `src/core/install-plan.mjs` | EXTEND | Baseline warning covers every fetchable source | pure |
| `src/core/dedup.mjs`, `classify.mjs`, `fit.mjs`, `role-families.mjs` | UNCHANGED | Reused as is (`fuzzyKey` exists and is unused today) | pure |
| `src/cli/fetch-loop.mjs` | EXTEND | A quarantined message stops the day before commit; refusal `fetch.message-quarantined` names the ids | bounded-change: cache writes, ledger commit only when every listed id is cached |
| `src/cli/update.mjs` | EXTEND | Fetch stage runs per source; preview prints per source | imperative, capability-injected |
| `src/cli/harvest.mjs` | EXTEND | Passes the descriptor's screen into `slim`; prints unmatched and unparsed at the build sites and in the `--in` rebuild; fetch stage over all sources | imperative |
| `src/adapters/gmail-api-source.mjs`, `message-cache.mjs`, `json-message-reader.mjs`, `ledger-store.mjs` | UNCHANGED (files) | Behaviour of `commit` changes through `coverage.mjs`; the other three are reused | as before |
| `.dependency-cruiser.cjs` | EXTEND | New rule: `src/core` imports no npm package | config |

## Wave: DESIGN / [REF] Driving Ports

| Port | Change |
|---|---|
| `harvest --in <dir> --out <file>` | prints unmatched and unparsed messages on stderr |
| `harvest build [--dry-run] [--target sheets]` | same; yield gains a per-source term-less row |
| `harvest fetch --source wttj --from <d> --to <d>` | works for the new descriptor; refuses a day with a quarantined message |
| `harvest update [--from <d>] [--dry-run]` | fetches every registered source; refuses before any fetch if a source has no baseline |
| `harvest install` / `status` | baseline warning covers every source |
| Jobs tab cells | `Source` is `Welcome to the Jungle` for new rows |

Read and write stay separate ports: the build receives the cache reader only, and the reader has no write method. No new inbound surface.

## Wave: DESIGN / [REF] Driven Ports and Adapters

No new driven port and no new adapter, so no new probe is owed. The existing probes (Gmail sender-has-mail, ledger readable, cache writable) stay and apply per source. The environment can lie in two ways here. Gmail can return HTML only, which `toMessage` now handles. The sender's template can change, which the descriptor's screen catches at fetch and the build's extractor catches again; the screen-implies-extract property ties the two. The link target is never requested, since that registers a click.

| Port | Adapter | Change |
|---|---|---|
| `MessageSource` | `gmail-api-source`, built per sender | none; a second instance for the new sender |
| `MessageCacheWriter` / `Reader` | `message-cache`, `json-message-reader` | none; the record may carry `htmlBody` |
| `CoverageLedger` | `ledger-store` | `commit` leaves other sources' entries untouched (bounded-change, universe: this source's entries; asserted by an acceptance test and a property over arbitrary ledgers) |

The interim agent path (`raw-spill-source`, `plan-fetch`, `ingest`) stays LinkedIn-only; the new source is API-only.

## Wave: DESIGN / [REF] Technology Choices

| Choice | Value | Licence | Note |
|---|---|---|---|
| Runtime | Node 22, ESM `.mjs` | n/a | unchanged |
| Runtime dependencies | `xlsx` only | Apache-2.0 | no addition proposed |
| HTML reading | in-repo scanner (`src/core/html-scan.mjs`) | n/a | fallback if its trigger fires: `parse5` (MIT, from memory) |
| Tests | Vitest, `fast-check` (existing) | MIT | property tests for the scanner and the ledger |
| Layering | dependency-cruiser (existing) | MIT | one new rule |

## Wave: DESIGN / [REF] Decisions Table

| ID | Decision | Status | Record |
|---|---|---|---|
| DDD-01 | Optional `htmlBody`, plain text preferred | ACCEPTED 2026-10-27 | DR-0019 (HTML read path), accepted 2026-10-27 |
| DDD-02 | Raw HTML cached | ACCEPTED 2026-10-27 | DR-0020 (cache form), accepted 2026-10-27 |
| DDD-03 | In-repo scanner | ACCEPTED 2026-10-27 | DR-0021 (HTML scanning), accepted 2026-10-27 |
| DDD-04, DDD-05 | Screen per descriptor; quarantine blocks the day; ledger merge per source | ACCEPTED 2026-10-27 | DR-0022 (coverage commit), accepted 2026-10-27 |
| DDD-07, DDD-08, DDD-10 | Registry routing, row source, contained refusal | ACCEPTED 2026-10-27 | DR-0023 (registry routing), accepted 2026-10-27 |
| DDD-11 | Per-source term-less yield row | ACCEPTED 2026-10-27 | record raised at slice 02, refines DR-0015 (yield) |
| DDD-12, DDD-17 | `update` over every source | ACCEPTED 2026-10-27 | record raised at slice 04, refines DR-0016 (update) |
| DDD-09, DDD-13, DDD-14 | Dedup key, Advert Link, salary | ACCEPTED 2026-10-27 | feature-delta only; no decision record is raised |

## Wave: DESIGN / [REF] Reuse Analysis

Every overlap is EXTEND unless a new file is listed with its evidence. The last column follows the effect-isolation rule: contract shape, universe, and how the crafter asserts it.

| Existing component | File | Overlap | Decision | Justification | Shape, universe, assertion |
|---|---|---|---|---|---|
| `toMessage` | `src/core/gmail-message.mjs` | Gmail resource to record | EXTEND | One more part lookup (about 5 lines) beside the plain lookup | pure; return-only; unit test: LinkedIn resource gives the identical record |
| `slim` and drift rules | `src/core/slim.mjs` | Fetch-time sanity check | EXTEND | Accepts the screen as an argument; LinkedIn's rules move behind its descriptor unchanged | pure; existing slim tests stay green unmodified |
| Registry and `extractAll` | `src/core/sources/registry.mjs` | Routing and unmatched bucket | EXTEND | The unmatched bucket exists (P1); add tagging and the unparsed list | pure; property: every message lands in exactly one of rows-source, unmatched, unparsed |
| LinkedIn descriptor | `src/core/sources/linkedin.mjs` | Descriptor shape | EXTEND | Adds `screen` only | pure data |
| `harvest()` | `src/core/harvest.mjs` | Row assembly, label | EXTEND | Replace two constants and one call; collapse and tabs untouched | pure; LinkedIn-only cache gives cell-for-cell identical tabs |
| Search yield | `src/core/search-yield.mjs` | Term-less bucket | EXTEND | Partition one existing set by one new field | pure, total; existing Y4 reconciliation tests unmodified for LinkedIn |
| Interval algebra | `src/core/coverage.mjs` | Merge | EXTEND | Group by `source` inside `mergeIntervals`; protects every caller | pure; property: committing source s never changes entries of other sources |
| Fetch loop | `src/cli/fetch-loop.mjs` | Commit decision | EXTEND | Remove the "quarantined counts as cached" allowance | bounded-change; acceptance test: a quarantined message leaves its day uncovered |
| `planUpdateRange`, `summariseUpdate`, `previewUpdateRange` | `src/core/update-plan.mjs` | Range and summary | EXTEND | Already take a `source` argument; call per source | pure; existing single-source properties unchanged |
| `runUpdate` | `src/cli/update.mjs` | Sequence | EXTEND | Same sequence, fetch stage looped | imperative; fetch capability still absent from the preview |
| `planInstall` baseline | `src/core/install-plan.mjs` | Warning | EXTEND | One check mapped over sources | pure |
| `fuzzyKey` | `src/core/dedup.mjs` | Dedup key | EXTEND (no change) | Exists for exactly this case and is unused | pure |
| LinkedIn card parser | `src/core/parse-linkedin.mjs` | Card parsing | CREATE NEW `parse-wttj.mjs` | Evidence: the parser works on blank-line-separated text runs and `/jobs/view/` links (lines 85-142); the new input is a tag tree with no text runs and no job-id link. Nothing is shared except salary arithmetic, which the new file reuses by import only if slice 05 needs it. | pure |
| (none) | `src/core/html-scan.mjs` | HTML reading | CREATE NEW | Evidence: no HTML parser or tokenizer exists in `src/` (grep for `htmlBody`, `text/html`, parser names finds only test fixtures and one OAuth page); `package.json` has no parser. | pure, total |
| (none) | `src/core/sources/wttj.mjs` | Descriptor | CREATE NEW | DR-0006: one descriptor file per source | pure data |

## Wave: DESIGN / [REF] Open Questions

For the human (my recommendation in brackets):

1. OQ-02 cache form: raw HTML or structured [raw HTML].
2. OQ-04 Advert Link: store the tracking link, blank, or other [store it].
3. OQ-07 unreadable card: contain for the new source only, contain for all, or throw [contain for the new source only, via a coded refusal].
4. DDD-04: may a quarantined message now stop LinkedIn fetching too [yes; it restores DR-0002 and a persistent bad message is then loud, but it can wedge a day].
5. DDD-17: should a failing W2tJ fetch still stop the LinkedIn Sheet build [yes, per DR-0016 and US-04 AC-2].
6. DDD-09: accept the company-plus-title key knowing it may merge two real adverts [yes, and count collisions in dogfood].
7. OQ-03 non-GBP salary [blank for non-sterling, as DISCUSS]; design impact: the raw salary text is kept on the row, so a currency column could be filled later without re-parsing.
8. OQ-09 backfill depth: design impact is only cost (two Gmail reads per message plus one list per day) [from the earliest available, after K-6 is reconciled].
9. OQ-10 further spikes [none; the second-sender fetch becomes a RED acceptance test that K-1 will fail first].
10. OQ-11 Sources tab: no rows by rule; no design impact [accept].
11. OQ-12 naming: id `wttj`, label `Welcome to the Jungle`; the label becomes a contract and the yield column fits it (38 of 40 characters with its prefix) [accept].

Deferred to DISTILL or DELIVER:
- Whether the neither-part refusal keeps the code `gmail.missing-plaintext-body` (existing tests assert it at `tests/acceptance/gmail-api-source/gmail-message.test.mjs:42,49`) or is renamed.
- Exact stderr wording for unmatched and unparsed messages.
- The `update` line that names each source, and the changes to the existing update acceptance tests that assert the current dry-run line.
- Whether `update` exits non-zero when any message is unparsed (a 05:30 notification fires only on non-zero).
- An operator escape from a wedged day.
- Whether to remove the unused `dedupKey` field from descriptors.
- Measuring scan cost per message (unmeasured; DR-0001 budgets about 10 ms per message).
- How the LinkedIn screen reports a record with no plain text (it would otherwise throw on `.length`).
- Stale documents to correct at delivery: brief sections 1 (LinkedIn-only framing, other sources out of scope), 3 (cache described as about 7.5 KB a record), 4 (registry row), 5 (ports table), 8 (about 7.5 MB at rest), 11 (decision index lacks the new records), 16 (second-source revisit trigger), `docs/reference/cli.md`, `docs/how-to/run-update-on-a-schedule.md`, the README design table, and the sentence in `src/core/slim.mjs:33` saying it discards `htmlBody`.

## Wave: DESIGN / [REF] Slice Impact

The five slices still hold in story order. They do not hold as sized: the HTML read path adds a scanner, and K-1 adds a coverage fix that touches LinkedIn fetching.

| Slice | DISCUSS | Now | Why |
|---|---|---|---|
| 01a registry routing | part of 01 | 0.5 day | `harvest()` through the registry, label from the row, unmatched list; LinkedIn cell-for-cell unchanged. Visible: the `--in` rebuild names unclaimed messages. |
| 01b HTML cards to rows | part of 01, 1 day | 1 to 1.5 days | Scanner, card reader, descriptor, fuzzy key, synthetic fixture. The riskiest slice; the learning hypothesis becomes positional-field stability. |
| 02 yield | 0.5 to 1 | 0.5 to 1 | Needs row source from 01a. |
| 03a coverage integrity | part of 03 | 0.5 to 0.75 | Ledger merge per source, quarantine blocks the day. Touches LinkedIn fetching; first RED test exposes K-1. |
| 03b HTML-only fetch | part of 03, 1 day | 0.5 to 0.75 | `toMessage` fallback, screen wired, `fetch --source wttj`. |
| 04 update | 1 | 1 to 1.5 | Per-source plan, summary, preview, install baseline; existing update tests change. |
| 05 salary | 0.5 | 0.25 to 0.5 | Salary is its own line. |

Order: 01a, 01b, 02, 03a, 03b, 04, 05. The real-mail dogfood step stays after 03b. Total moves from about 5 days to about 5.5 to 7.5, across seven slices; two exceed one day on the upper estimate. The scope is oversized against the one-day-per-slice rule. If the human wants to trim, slice 05 is the separable one.

## Risks

- R-1: the fuzzy key may merge two distinct adverts with one title (location is identical on all 197 sampled cards). The error is invisible in the Sheet. Check in dogfood by counting company-and-title groups whose salary text differs.
- R-2: the Stripo class names (`es-*`) are builder-generated and may change on a re-theme; uniformity is shown only for the sampled period. The screen turns drift into a refused day, not wrong rows.
- R-3: a persistent quarantine wedges one day and, under DR-0016, the whole morning run.
- R-4: raw HTML at rest holds per-recipient unsubscribe and click tokens; the cache is local and gitignored (DR-0001 accepts this class of data).

## Handoff notes (for DEVOPS and DISTILL)

Paradigm: functional, `@nw-functional-software-crafter`. External integrations: Gmail REST API v1 (existing) now returns an HTML-only payload for this sender: contract tests recommended as fixtures of that payload shape in the existing Gmail fake. The sender's HTML template is a provider-controlled contract with no cooperating provider, so a consumer-driven contract is not possible; the golden synthetic fixture plus the screen-implies-extract property is the substitute. The tracking host is never contacted. Mutation testing stays nightly-delta.
