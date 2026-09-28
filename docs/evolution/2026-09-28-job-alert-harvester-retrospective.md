# job-alert-harvester — Root Cause Retrospective

**Type**: Explanation (root cause analysis; not a how-to or reference).
**Date**: 2026-09-28
**Analyst**: Rex (nw-troubleshooter)
**Method**: Toyota 5 Whys, multi-causal, `investigation_depth: 5`.
**Reads**: `docs/evolution/2026-09-28-job-alert-harvester.md`, `docs/decisions/DR-0008-card-position-not-a-noise-denylist.md`, `docs/feature/fix-linkedin-header-shift/rca.md`, `docs/feature/fix-reparse-silent-zero/rca.md`, `docs/feature/job-alert-harvester/feature-delta.md`.

## Problem Statement

45 of 146 tracker rows carried shifted fields (a company name where a title belonged) while the suite ran green throughout. That shape — process says pass, output is wrong — recurred four more times across unrelated subsystems: a denylist that kept leaking (3 patches in one afternoon, one of which regressed 9 correct rows), silent-zero successes in three independent layers, fixtures that diverged from the real corpus in two distinct ways, a "measure, then trust" claim that missed a fifth data shape, and verification (guards, a reviewer, a subagent) that passed without ever being shown it could fail. The question is not what broke in each case — each is already fixed and recorded — but why the *pattern* of green-but-wrong recurred across five structurally different subsystems rather than being closed after the first instance.

Scope: this document analyzes the recurring pattern across the cited incidents. It does not re-litigate any individual fix (DR-0008 and the two RCAs already did that at the code level) and changes no code, test, or decision record.

## WHY 1 — Symptom (all branches, evidence)

- **1A** Field-shift defect: 45/146 rows shifted; suite green throughout [`docs/feature/fix-linkedin-header-shift/rca.md` WHY1, Post-Fix Verification table].
- **1A′** Recurrence within the same fix: denylist leaked 3 times in one afternoon (01-02 preamble, 45 rows; 01-03 `alum`/`alumni`, 7 rows; 01-04 salary line, 3 rows), and 01-02 itself regressed 9 previously-correct rows before 01-03/01-04 restored them [DR-0008 Context table; rca.md Post-Fix Verification].
- **1B** Silent zeros in three independent layers: `--in` against the sharded cache reports "harvested 0 messages," writes an empty workbook, exits 0 [`fix-reparse-silent-zero/rca.md` Reproduction]; exit codes read through a pipe returned the pipe's own status twice during verification [task evidence]; vitest collected 193 linter files that failed to load for hours while only the `Tests` summary line, never `Test Files`, was read [task evidence].
- **1C** Fixtures diverging from reality: a synthetic message builder padded to clear a size threshold produced a layout occurring zero times across 70 real messages, and every test using it had been extracting junk titles and passing because none asserted on a title [task evidence]; SheetJS parses any text file as a one-sheet workbook, concealing that two accepted ATs demanded opposite behaviour of the same file kind [task evidence].
- **1D** Measurement mistaken for proof: the positional rule scored 198/198 against the live cache and that agreement was reported as confidence in the rule; it missed a fifth card layout present only in committed fixtures, caught by the walking skeleton, not by the measurement [DR-0008 "The fifth shape" amendment].
- **1E** Verification that verified nothing: guards passed the moment written and would have passed against data-destroying implementations; a reviewer's blocking finding proposed a vacuous fix, its advisory finding would have weakened a test's guarantee; a subagent committed with a red test and diagnosed a defect in correct code when the fault was its own fixture [task evidence; corroborated by `docs/evolution/2026-09-28-job-alert-harvester.md` Lessons Learned — "a test that cannot fail is worse than none," "subagent reports are hypotheses"].

Three mechanistically distinct branches explain 1A–1E. They are taken in turn.

---

## Branch A — Self-referential correctness (1A, 1A′, 1C, 1D)

**WHY 2A**: Why did an unfiltered/misshapen line pass as a valid field, and why did a 198/198 measurement miss a fifth shape? Because the only thing checked was internal consistency with the code's own assumptions — `title`/`company` were asserted *truthy*, never *plausible*, and the 198 "agreements" were agreements with the *current three-patch parser on the corpus at hand*, not with an independent notion of correctness. [Evidence: `rca.md` WHY3 — `if (!title || !company) continue` rejects only empty, never implausible; DR-0008 "The fifth shape" — "the live cache happened to contain only four of the five shapes... corpus breadth is not corpus completeness."]

**WHY 3A**: Why was there nothing to check plausibility or shape-completeness against? Because the fixture/builder corpus that specified "correct" was authored once, early, from a narrow sample, and treated as sufficient rather than as a sample requiring reconciliation against the growing live cache. [Evidence: `rca.md` WHY4 — all 5 fixtures captured in one session (`c9ba19a`, 2026-08-01), one template, zero occurrences of any of the six later-found noise variants; task evidence — the synthetic builder's padded layout occurs zero times in 70 real messages.]

**WHY 4A**: Why was the fixture/builder corpus never re-validated as real traffic accumulated? Because no design element ties test data or extraction rules to the live corpus — there is no anchor/invariant check, and no process step that revisits fixture coverage as `.cache/` grows past the sample it was built from. This is a process-design gap, not a process-execution one: the RCA finds no step that *existed and was skipped*, only the absence of any such step to skip. [Evidence: `rca.md` WHY4 — "no anchor/invariant check... and no process step that revisits fixture coverage as the live cache grows past the original 5 examples."]

**WHY 5A — Root Cause A**: "Passing" was implicitly defined as agreement with an artifact the project itself authored (a small fixture set, a synthetic builder, a corpus-agreement percentage) rather than with an independent reference the team did not control — so correctness was measured self-referentially, and every self-referential measurement inherited the blind spots of the sample it was drawn from.

---

## Branch B — Success-proxy trust (1B)

**WHY 2B**: Why did three unrelated layers report success on nothing? `--in`'s `readAll` used non-recursive `readdirSync` against a directory whose only content is subdirectories, and printed the resulting `0` inside a success message rather than gating on it; the pipe's exit status was read without `pipefail`, so `$?` reflected the wrong stage; vitest's headline pass count was read (`Tests`) while a distinct, more specific line (`Test Files`) carried the actual failure. [Evidence: `fix-reparse-silent-zero/rca.md` root cause chain items 1 and 4 — "no probe and no emptiness check... the count appears in the success message rather than gating it"; task evidence for the pipe and vitest cases.]

**WHY 3B**: Why did each layer trust its own aggregate signal instead of the more specific state beneath it? Because none of the three had a structural check making "processed nothing" or "a subordinate stage failed" impossible to represent as success — the asymmetry between `readAll` (non-recursive) and `ids()` (recursive) in the same adapter is a design choice its own header comment records as deliberate, not an oversight caught by review. [Evidence: `rca.md` root cause chain item 2 — "the adapter carries two listing strategies with different reaches and its header comment records the split as deliberate."]

**WHY 4B**: Why wasn't the project's own stated principle — "an empty result is not a pass" — enforced at any of the three layers before each instance was found? Because the principle existed as a written maxim (quoted verbatim inside the RCA itself) but had no automated gate translating it into a refusal; each instance was caught by a human/agent noticing after the fact, not by a check that would refuse silently. [Evidence: `fix-reparse-silent-zero/rca.md` § Failure class — quotes the maxim directly, then states "DR-0003 made the same argument for the ingest path... The `--in` rebuild path never got the equivalent guard."]

**WHY 5B — Root Cause B**: The project's exit/success semantics conflate "the step ran to completion" with "the step did the intended thing" at every layer that reports a result (CLI, shell composition, test runner output), and the standing principle guarding against this existed only as prose, applied per-instance after discovery, never as a default, enforced gate applied to a *new* layer before it shipped.

---

## Branch C — Confirmatory-only verification (1E)

**WHY 2C**: Why did guards, a reviewer, and a subagent's diagnosis all pass or conclude wrongly? Because each was validated against the implementation it shipped alongside — does the guard agree with the intended-good code, does the reviewer find nothing wrong with the diff, does the subagent's fixture look right to itself — never against a version deliberately built to be wrong. [Evidence: task evidence — "several guards passed the moment they were written and would have passed against implementations that destroyed user data. They only became trustworthy when run against deliberately wrong implementations."]

**WHY 3C**: Why was falsification-testing not already how every guard and finding was validated? Because it was an extra discipline applied selectively (DISTILL's negative-testing workflow caught four vacuous assertions once, deliberately), not the default acceptance criterion for a new guard, a reviewer's proposed fix, or a subagent's diagnosis. [Evidence: `docs/evolution/2026-09-28-job-alert-harvester.md` Lessons Learned — "DISTILL's negative-testing workflow caught four vacuous... assertions... before they could pass by accident and never catch a regression. One review the reviewer itself proposed was later re-checked directly rather than trusted."]

**WHY 4C**: Why does the default workflow stop at "does this pass on the code we wrote" rather than "can this fail on plausible wrong code"? Because authoring and review both optimize for agreement with the artifact under construction — the diff, the scaffold, the fixture the subagent itself wrote — which is a confirmatory test by construction; nothing in the standard authoring step requires trying to break the check before trusting it.

**WHY 5C — Root Cause C**: Verification artifacts (test guards, reviewer sign-off, a subagent's own diagnosis) were accepted on the strength of agreeing with the work they were meant to police, not on demonstrated ability to disagree with wrong work — falsification against a known-bad implementation was an occasional, hard-won practice, not the default bar for trusting any new check.

---

## Cross-Validation

- **Root Causes A, B, C do not contradict** — they are the same generative shape (verification validated against something internal to the artifact under test: its own fixture sample, its own exit path, its own diff) applied to three different subsystems (extraction correctness, success reporting, review/guard authorship). None requires the others to be false.
- **Backwards check, Root Cause A → symptom**: if correctness is measured against a self-authored sample, then every new LinkedIn digest subtype absent from that sample reproduces a shift with zero code change — consistent with three independent leaks from one three-week corpus and a fourth ("likely") named in the RCA before it happened, and with the fifth shape missed by the 198/198 measurement. Yes, produces the symptom.
- **Backwards check, Root Cause B → symptom**: if success is a proxy no layer double-checks, then every layer that reports an aggregate (CLI, pipe, test runner) can go silent independently of the others — consistent with three unrelated instances (CLI, shell, tooling) rather than one bug propagating. Yes.
- **Backwards check, Root Cause C → symptom**: if checks are validated only by agreement with the work they ship beside, then a guard, a reviewer finding, and a subagent's self-diagnosis can each pass while being wrong, independently of each other — consistent with three distinct actors (a guard author, a reviewer, a subagent) each failing the same way for different artifacts. Yes.
- **Completeness check**: do A, B, C jointly explain 1A–1E without gaps? 1A/1A′/1C/1D → A. 1B → B. 1E → C. No symptom is left unexplained by exactly one branch; none needed to be assigned to more than one to be fully accounted for.
- **Meta-finding (not a fourth branch, a shared shape across A/B/C)**: every instance where the *pattern* actually broke — DR-0008's fifth shape being caught by the walking skeleton rather than by the 198/198 measurement; the field-shift itself being caught by rebuilding the workbook and reading it against raw mail — was caught the moment an independent, external reference was consulted instead of the project's own prior artifact. That is the throughline the "what to repeat" section below is built on.

## Contributing Factors (distinguish from causes)

These made the root causes more likely to bite or harder to catch quickly — they do not by themselves explain why the gap existed:

- **Time pressure compounded Branch A.** Three denylist patches landed same-afternoon, each committed before the next leak was found (DR-0008 Context table) — this explains why patching continued past the point a structural fix was warranted, not why the first gap existed.
- **A tool's leniency masked a real contradiction.** SheetJS parsing any text file as a one-sheet workbook hid that two accepted ATs demanded opposite behaviour of the same file kind — an enabling condition for Branch C's confirmatory review to pass unnoticed, not itself the reason review was confirmatory.
- **An uninvited process change surfaced Branch B, it did not cause it.** A linter installing itself mid-session and being collected by vitest is what exposed the `Tests`-vs-`Test-Files` blind spot; the blind spot (reading the coarser line) pre-dated and does not depend on that trigger.

## What to Repeat

Each of these is what actually closed a gap in this project, evidenced above — not aspiration:

1. **Audit rebuilt output against source data**, not test results. The field-shift was found by rebuilding the workbook and reading it against raw mail, never by a failing test [`rca.md` Problem Statement]. This is Root Cause A's antidote in practice.
2. **Run guards against deliberately wrong implementations** before trusting them. DISTILL's negative-testing workflow caught four vacuous assertions this way [evolution record Lessons Learned]. This is Root Cause C's antidote in practice.
3. **Measure before choosing, rather than reasoning from assumption** — byte-determinism, date-format survival, and SheetJS's leniency were established by direct measurement in this project rather than assumed, the same discipline DR-0008 applied (198/198) even though that specific measurement later proved incomplete. The lesson is not "don't measure" — it's "measure, and still treat the result as evidence about the sample, not proof about the format" (see DR-0008 "The fifth shape").
4. **Record the reasoning where the next reader looks.** DR-0008 is committed beside the code it constrains, with its own open items and later amendments recorded in place rather than in a separate document — this is why the fifth-shape and rule-4 gaps were traceable at all.

## What to Avoid

Each traceable to evidence above, not general advice:

- **Extending a vocabulary/denylist as the default response to a leak.** Three patches in one afternoon before the structural alternative was even scheduled (DR-0008 Option 1, rejected after the fact). Avoid: the first leak in an open-set matching rule (regex, denylist, allowlist of "known" values) is itself the signal to look for a positional/structural invariant, not to add one more pattern.
- **Trusting an aggregate summary line without checking the more specific one beneath it.** Vitest's `Tests` line vs. `Test Files`; a piped `$?`. Avoid reading a rollup number as sufficient evidence when a per-unit breakdown exists and was not consulted.
- **Treating "N/N agreement on a corpus" as proof about the format.** DR-0008's own amendment names this precisely — it is evidence about the corpus measured, not the format in general.
- **Accepting synthetic/builder-generated test data without checking it occurs in the real corpus at least once.** The padded synthetic message occurs zero times in 70 real messages, and no test using it asserted on the field it corrupted.
- **Accepting a reviewer's "no findings" or a guard's first green run as sufficient**, absent at least one deliberate attempt to make it fail.

## Process Changes

Specific and checkable; each states what it would have caught here.

1. **New/changed field-extraction logic for a source must be re-run over the full live cache (not just committed fixtures) before the change is trusted, with a recorded count of distinct card/block shapes observed.** *Would have caught*: the 45-row shift (1A) and DR-0008's fifth shape (1D) — both were live-cache-only findings that fixture-only testing missed.
2. **Any CLI path that can legitimately process zero items when the caller expects more must refuse (non-zero exit, no write) rather than report a count inside a success line.** *Would have caught*: `--in` reporting "harvested 0 messages" and exiting 0 over the sharded cache (1B).
3. **Shell verification steps that check `$?` after a pipeline must set `pipefail` (or capture the specific stage's status directly), and CI/test-runner output must be parsed at its most specific granularity (e.g. `Test Files`, not just `Tests`), never the coarsest line available.** *Would have caught*: the twice-masked pipe status and the 193 silently-uncollected test files (1B).
4. **Every new test guard, and every reviewer finding proposing a fix, must be checked once against a deliberately wrong implementation before being trusted (mutation-style falsification as a default step, not an occasional audit).** *Would have caught*: the vacuous refuses-with-unchanged-state assertions, the reviewer's vacuous blocking-finding fix and guarantee-weakening advisory finding, and the subagent misdiagnosing correct code against its own bad fixture (1E).
5. **Synthetic test-data builders must be diffed against a sample of real corpus records when first authored and re-checked when the source's real-traffic sample materially grows (e.g. at each new source's SPIKE, or after a fixed multiple of new cached messages).** *Would have caught*: the padded synthetic layout occurring zero times in 70 real messages, and the two ATs silently contradicting each other over the same file kind (1C).

## Solution Mapping

| Root Cause | Immediate mitigation (already landed) | Permanent fix (process change) |
|---|---|---|
| A — self-referential correctness | DR-0008 positional rule; assertion refusing on card/link-count mismatch (DR-0008 "Rule 4 resolved") | Process change 1 |
| B — success-proxy trust | `fix-reparse-silent-zero` refusal on empty `--in` reads (per that RCA's proposed fix) | Process changes 2, 3 |
| C — confirmatory-only verification | DISTILL negative-testing workflow's four caught vacuous assertions | Process change 4 |
| Fixture/corpus divergence (contributes to A, C) | n/a — named, not yet fixed at time of these RCAs | Process change 5 |

Every root cause maps to at least one process change above; none is unmapped.

Process changes 1–5 are recommendations of this retrospective, not yet adopted — this document has no authority to mandate a gate. Adoption (and choice of enforcement mechanism — DISTILL checklist item, CI check, or manual review) is a decision for the practitioner, tracked as a follow-up against the seven remaining unbuilt sources.
