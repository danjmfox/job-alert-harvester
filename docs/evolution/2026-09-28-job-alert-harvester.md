# job-alert-harvester — Evolution Record

**Finalized**: 2026-09-28
**Feature workspace**: `docs/feature/job-alert-harvester/` (preserved as delivery history, not deleted by this document)

## Pre-dispatch gate caveat

`nw-finalize`'s gate asks to "check every step has status `DONE`." This project's DES log
(`docs/feature/job-alert-harvester/deliver/execution-log.json`) uses `schema_version` /
`feature_id` / `events` — a per-phase event stream (RED/GREEN/COMMIT per step), not a
step-status field. There is no `DONE` value anywhere in the schema. The gate is satisfied
*in substance*: all 12 roadmap steps (`01-01` … `01-12`) show a terminal `COMMIT: EXECUTED,
PASS` event (`01-02` reached it after an initial `GREEN`/`COMMIT` pair logged
`BLOCKED_BY_DEPENDENCY` — see Issues Encountered). No `DONE` status exists to point to; this
paragraph is the substitute evidence.

## Feature Summary

`job-alert-harvester` builds the ingest half of a deterministic, incremental, scripted
pipeline over Gmail job-alert mail: source registry → dedup → coverage-tracked cache →
(future) merge into a tracker workbook. This delivery covers LinkedIn only, end to end from
a Gmail spill file to a cached, deduplicated, coverage-committed message — CLI subcommands
`plan-fetch` and `ingest`, plus a Claude Code skill that loops them against live Gmail. The
write path (`build`, merge, target-sheet) was explicitly out of scope for this roadmap and
was picked up by eleven follow-on feature workspaces (see below).

## Business Context

The original goal, stated in the dispatch: a list of companies that have advertised jobs the
user could plausibly apply for, built by a deterministic, incremental, scripted process over
a year of Gmail job alerts — replacing ad hoc manual tracking with something repeatable and
auditable. `job-alert-harvester` is the first of eight planned sources (LinkedIn); the other
seven remain unbuilt.

## Key Decisions

Extracted from `spike/wave-decisions.md` and the ten decision records in `docs/decisions/`.
Every DR carries a 2-5 word summary inline per citation convention.

**From SPIKE** (`spike/wave-decisions.md`):
- **PROMOTE verdict**: the probe validated deterministic extraction + stable dedup from 5 real LinkedIn fixtures (22 rows → 14 jobs, 0 missing core fields) — promoted to walking skeleton.
- **Vitest, not Gherkin, lean pivot**: a `.feature` file with nothing executing it is documentation drift; one executable Vitest acceptance test with `@walking_skeleton @driving_port` tags replaces it.
- **Phase 1 provenance deviation** (self-flagged): SPIKE's PROBE phase ran inline on the main instance rather than dispatched to `@nw-software-crafter`, because it needed live Gmail access unavailable to a cold subagent. CLAUDE.md requires *asking* for such an exclusion rather than resolving it unilaterally — the main instance flagged the reason but did not ask. Findings are retained as reproducible measurements from committed fixtures, with this deviation recorded rather than hidden.

**From the ten decision records** (`docs/decisions/DR-0001` … `DR-0010`):
- **DR-0001 — persist what cannot be re-derived**: the cache stores slimmed connector output because Gmail history is not re-fetchable on demand; refined by DR-0002, DR-0004, DR-0009.
- **DR-0002 — coverage intervals, not a watermark**: coverage is what was *searched* (intervals), not `max(date)` — a single watermark is unsound once batching and resends are in play. Amended 2026-09-13 (window sizing: `plan-fetch` returns at most one UTC day; `ingest --window` must be exactly that window, never the requested range) after the harvest skill was found capable of over-claiming coverage.
- **DR-0003 — agent couriers paths, not records**: the agent moves file paths and control values only, never record content, after two 2026-08-01 data corruptions (one silent — a comma shifted a salary a column). Refined by DR-0007.
- **DR-0004 — one owner per column**: every tracker column has exactly one writer (harvester or human), because fill-if-empty needs provenance the sheet doesn't carry. Refined by DR-0010.
- **DR-0005 — TargetSheet is a plan-executing port**: `read()`/`apply(plan)`/`probe()`, merge is pure and returns a `WritePlan`, only `apply` writes — makes "the preview modified the tracker" unrepresentable. Refined by DR-0010.
- **DR-0006 — source registry descriptors are data**: every source extractor always returns an array (no "single-job" shape), encoding SPIKE finding F1 structurally; unmatched messages are captured in an `Unmatched` bucket, never dropped.
- **DR-0007 — spill contract is what the harness writes**: replaces an invented `{result}`-wrapped `.json` spill shape with the real one, discovered on a live harness probe — flat JSON in `mcp-*-get_message-*.txt`, selected by filename pattern in a directory shared with unrelated tool output. Refines DR-0003.
- **DR-0008 — card position, not a noise denylist**: replaces a hand-authored `TRAILING_NOISE_LINE` denylist (which leaked three times in one afternoon) with a positional rule keyed to the job-link's line-adjacency; deletes nine noise patterns. Verified 198/198 against the live corpus, then amended twice more (a fifth block shape found only in fixtures; an assertion added so a malformed card refuses loudly instead of silently dropping).
- **DR-0009 — build derives from the whole cache**: the `build` subcommand always reparses every cached message, never a coverage window — windowing is a fetch-time concept only. Refines DR-0001.
- **DR-0010 — every derived tab merges by its own key**: extends DR-0004's one-owner-per-column rule from Jobs to Companies and Sources, and widens DR-0005's single-tab plan to one plan per derived tab, applied atomically. Refines DR-0004 and DR-0005.

## Work Completed

Source: `docs/feature/job-alert-harvester/deliver/execution-log.json` and `roadmap.json`.
All 12 roadmap steps (`01-01` through `01-12`) reached a terminal `COMMIT: EXECUTED, PASS`
event:

| Step | Scope | Note |
|---|---|---|
| 01-01 | Namespaced dedup key strategies (`core/dedup.mjs`) | `canonicalKey`/`fuzzyKey` per DR-0006 rule 3 |
| 01-02 | Slim raw payloads, quarantine schema drift (`core/slim.mjs`) | Initial `GREEN`/`COMMIT` logged `BLOCKED_BY_DEPENDENCY` (AT fixture contradiction), resolved same day |
| 01-03 | Source registry + LinkedIn descriptor | Wraps existing `parse-linkedin.mjs` unchanged |
| 01-04 | Coverage interval algebra (`core/coverage.mjs`) | `validateInterval`/`mergeIntervals`/`subtractCoverage`/`nextUncoveredWindow` |
| 01-05 | Coverage ledger adapter, fail-closed probe | `ledger-store.mjs` |
| 01-06 | Month-sharded message cache writer | `message-cache.mjs` |
| 01-07 | Raw spill directory adapter, window/count checks | `raw-spill-source.mjs` |
| 01-08 | CLI `ingest`/`plan-fetch` composition root | Wires, probes, then uses; existing `--in/--out` path preserved |
| 01-10 | Adapter reads the real harness spill contract (DR-0007) | Replaces invented `.json`/`{result}` shape |
| 01-09 | Harvest Claude Code skill — thin courier | Loops `plan-fetch`/`ingest`, no record content, per DR-0003/DR-0007 |
| 01-11 | One-day `plan-fetch` windows, `ingest`'s window (DR-0002 amendment) | Closes gap G1; fixes an over-claim-coverage risk found reading the skill against a real 90-day run |
| 01-12 | Merged coverage intervals sum message counts | Fixes a live Phase 3.5 gate defect (merge dropped one side's count) |

77 commits total. 12 feature workspaces exist under `docs/feature/`; this document finalizes
one of them. Suite at finalization: 23 test files, 166 passed / 1 skipped (the `@property`
PBT placeholder in `coverage.test.mjs`, deliberately deferred — `fast-check` not installed).

### Follow-on feature workspaces (not finalized by this document)

Eleven further feature workspaces built on this ingest foundation. Each remains its own
delivery history under `docs/feature/{name}/` and is out of scope for this finalization:

- `fix-linkedin-header-shift` — root-caused the denylist leaks that led to DR-0008.
- `fix-reparse-silent-zero` — closed a rebuild path that reported success over an empty workbook.
- `fix-noise-denylist-structurally` — implemented DR-0008's positional extraction rule.
- `merge-plan` — pure merge planner producing a `WritePlan` (DR-0005).
- `target-sheet-probe-and-dry-run` — `TargetSheet.probe()` and `--dry-run` preview.
- `target-sheet-apply` — writes the merge plan to the real tracker workbook.
- `merge-every-derived-tab` — extends merge to Companies and Sources tabs (DR-0010).
- `build-idempotence-and-path-guard` — idempotent rebuild with a path safety guard.
- `pin-whole-cache-invariant` — pins DR-0009 (build derives from the whole cache).
- `stale-upload-warning` — warns when the tracker upload is older than the cache.
- `changes-report` — reports derived-cell changes between merge runs (DR-0004 D-10).

## Lessons Learned

- **Every real defect was found by auditing output, never by a test passing.** The suite was
  green while 45 of 146 rows carried shifted fields (DR-0008's step 01-02 leak). Passing
  tests confirmed the code did what it was written to do, not that the output was correct.
- **A denylist of "lines to ignore" leaked three times in one afternoon** (steps 01-02/
  01-03/01-04 of `fix-linkedin-header-shift`, per DR-0008) before being replaced by a
  positional rule (DR-0008, card position not a noise denylist), which deleted nine patterns
  and closed the class structurally rather than one vocabulary entry at a time.
- **A test that cannot fail is worse than none.** DISTILL's negative-testing workflow caught
  four vacuous "refuses with unchanged state" assertions — trivially true of the CLI's
  pre-implementation unconditional-refusal scaffold — before they could pass by accident and
  never catch a regression. One review the reviewer itself proposed was later re-checked
  directly rather than trusted (see below).
- **"N/N agreement on the corpus" is evidence about the corpus, not proof about the format.**
  DR-0008's 198/198 measurement against the live corpus missed a fifth card layout — present
  only in the committed fixtures — caught by the walking-skeleton acceptance test, not by
  analysis.
- **Two corpora exist and neither subsumes the other** — the live `.cache/` and the committed
  `fixtures/`, plus a third, the synthetic acceptance-test builder (`aSpillPayload()`/
  `aDigestBody()`), which was found generating shapes LinkedIn never sends (an invented
  `{result}`-wrapped spill envelope, DR-0007; a sub-1KB digest body contradicting the pinned
  1024-char quarantine threshold, step 01-02) — every test using those builders had been
  reading synthetic, not real, data until corrected.
- **Silent-zero failures recurred in three distinct places**: the rebuild path reporting
  success over an empty workbook (`fix-reparse-silent-zero`), a `PIPESTATUS`-masked exit
  code, and a test suite showing a clean count at the test-file level while a wider run
  showed 193 failing files. The pattern repeats regardless of layer — CLI exit codes, shell
  pipelines, and test runners all offer a "silent zero" failure mode.
- **Subagent reports are hypotheses.** DELIVER's code review (`@nw-software-crafter-reviewer`,
  0 findings across 2,596 inserted lines) misstated the suite composition and described a
  same-day defect fix (the summed `messageCount`) as original DR-0002 intent; the
  fail-closed ordering it approved was independently re-checked by the orchestrator rather
  than accepted on the reviewer's word alone (`feature-delta.md` § DELIVER Quality Gates).

## Issues Encountered

- **Step 01-02 AT/fixture contradiction**: `slim.test.mjs`'s happy-path fixtures produced a
  151-character digest body while the pinned `MINIMUM_DIGEST_BODY_LENGTH` was 1024 — no
  threshold could satisfy both the "not quarantined" and "quarantined" sibling assertions.
  Logged `BLOCKED_BY_DEPENDENCY` in the execution log, routed to `nw-acceptance-designer`,
  resolved by making the builder's default body realistic.
- **Invented spill contract**: DISTILL's `aSpillPayload()` builder assumed a `{result}`-
  wrapped `.json` shape the real Gmail harness never writes. A live harness probe
  (2026-09-13) surfaced the actual contract — flat JSON in `mcp-*-get_message-*.txt` — and
  DR-0007 replaced the assumption; 20 tests went newly RED as a direct, expected consequence.
- **Coverage over-claim risk**: reading the committed harvest skill against a real 90-day run
  exposed `plan-fetch` returning the whole uncovered gap instead of one day, with `ingest`'s
  `--window` echoing the *requested* range rather than the window actually fetched — a path
  to committing coverage for days never fetched. Fixed in step 01-11 (DR-0002 amendment).
- **Merged interval message-count defect**: the live Phase 3.5 gate harvested two adjacent
  days and found the merged coverage interval reporting only one side's message count.
  Coverage correctness was unaffected (decisions read only `from`/`to`), but the ledger's own
  audit figure was wrong. Fixed in step 01-12.

## Not Done

- Seven of eight planned sources are unbuilt — LinkedIn only.
- The Gmail connector currently fails to connect (`ENOTFOUND`), so no new mail can be
  harvested until that is resolved.
- Every tracker fixture is written by SheetJS rather than exported from Google Sheets — no
  fixture has been validated against a real Google Sheets export.
- One coverage-algebra property test (`@property`, `coverage.test.mjs`) stays `it.skip`:
  `fast-check` is deliberately absent from the project.
- Carried-forward, unpinned by any test (per `feature-delta.md` § DELIVER Quality Gates): the
  fit scorer under-rates "Agile Delivery, Scrum and Coaching" (Capgemini Invent); salary-range
  parsing (`£55K–£70K`) has no fixture; `dedup.fuzzyKey` normalisation is untested; a chained
  merge of three or more coverage intervals is unpinned; `plan-fetch --batch` is printed but
  sizes nothing.

## Corpus at Finalization

59 cached LinkedIn alert messages spanning 2026-09-01 → 2026-09-14, yielding 146 jobs, 102
companies (95 employers, 7 recruiters), 7 saved searches; 14 jobs score 4+ on fit; 10 carry a
salary.

## Links to Artifacts

- Delivery history (preserved, not deleted): `docs/feature/job-alert-harvester/`
  - Roadmap: `docs/feature/job-alert-harvester/deliver/roadmap.json`
  - Execution log: `docs/feature/job-alert-harvester/deliver/execution-log.json`
  - SPIKE findings (cited by DR-0001 and DR-0006 — retained here, no permanent-directory row
    exists for it): `docs/feature/job-alert-harvester/spike/findings.md`
  - SPIKE wave decisions: `docs/feature/job-alert-harvester/spike/wave-decisions.md`
  - RED classification: `docs/feature/job-alert-harvester/distill/red-classification.md`
  - Feature delta (full wave-by-wave narrative): `docs/feature/job-alert-harvester/feature-delta.md`
- Decision records: `docs/decisions/DR-0001-persist-what-cannot-be-rederived.md` through
  `docs/decisions/DR-0010-every-derived-tab-merges-by-its-own-key.md`
- Architecture policy (already in a permanent location, not migrated by this document):
  `docs/architecture/atdd-infrastructure-policy.md`
