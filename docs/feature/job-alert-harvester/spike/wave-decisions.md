# SPIKE Decisions — job-alert-harvester

## Assumption Tested
Can we deterministically extract `{company, title, location, salary?, advert link}` from
LinkedIn `jobalerts-noreply` emails **and** assign a stable dedup key that collapses the
3–6×/day resends into one job?

## Probe Verdict
**WORKS** — 22 raw job rows across 5 real fixtures collapsed to 14 distinct jobs
(1.57×), 0 rows missing a core field, 52 ms. Full detail in `findings.md`.

## Promotion Decision
**PROMOTE** (user, 2026-08-01). The mechanism is validated and the extraction shape is
regular enough to build on. Walking skeleton to write a real Google Sheet.

## Process deviation — Phase 1 provenance (recorded per user decision)

`nw-spike` names **@nw-software-crafter** as the executing agent for both PROBE and
WALKING SKELETON. **Phase 1 (PROBE) was executed inline by the main Claude instance,
not by that agent.**

- **Stated reason at the time:** the probe required fetching live emails through the Gmail
  connector, which is available only to the main instance; a cold subagent could neither
  reach the mailbox nor inherit the recon context.
- **Why that was still a deviation:** CLAUDE.md ("nWave agents are mandatory") states that a
  general session/harness directive against subagents does **not** count as an exclusion, and
  that the correct response is to *say so and ask* — never to resolve it by running the wave
  inline. The main instance flagged the reason but did not ask. Only the user can grant the
  exclusion, and it was not sought.
- **Bearing on the artifact:** the findings are empirical and reproducible from the five
  fixtures committed at `fixtures/linkedin/` — the dedup ratio, the canonical-ID discovery and
  the salary-smearing defect are measurements, not judgement calls. `findings.md` is therefore
  retained rather than re-derived, with provenance recorded here.
- **Corrective action:** Phase 3 (WALKING SKELETON) **is** dispatched to @nw-software-crafter.
  The Gmail justification does not extend to it — the fixtures are on disk and no connector is
  required.

## Lean Pivot — acceptance test format

`nw-spike` specifies a Gherkin `.feature` file. The project's stack default is **Vitest**, and
Cucumber would be a new dependency used by exactly one test (Cognitive Load Tax). A `.feature`
file that nothing executes is documentation drift of precisely the kind the Drift Resistance
section warns about.

**Decision:** one executable Vitest acceptance test at
`tests/acceptance/job-alert-harvester/walking-skeleton.test.mjs`, carrying the
`@walking_skeleton @driving_port` tags in its name and Given/When/Then in its body. No
`.feature` file. Flagged as a deviation from the skill's letter, in service of its intent.

## Design Implications
1. Dedup key is **per-source**: canonical ID where the source exposes one (`linkedin:{jobId}`),
   fuzzy `hash(company+title+location)` only as fallback.
2. Watermark is **message-level** (Gmail message id + date), not job-level — one message yields
   N jobs and resends overlap partially.
3. Salary must carry provenance (`{amount, basis, confidence, sourceField}`); subject-derived
   salary is headline-scoped and lower confidence.
4. Fit scoring stays **derived**, never applied at ingest.
5. LinkedIn alerts are **all digests** — no "single-job" source shape exists.

## Constraints Discovered
- Location granularity is inconsistent (`United Kingdom` / `Greater London` /
  `London Area, United Kingdom` / `Portsmouth`); remote-friendliness is **not** reliably
  derivable from LinkedIn alerts.
- The `Company` field is frequently a recruiter, not the employer — `Source Type` column earns
  its place; matches the `?` rows in the prior 2025 tracker.
