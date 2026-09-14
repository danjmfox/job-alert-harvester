# Feature Delta — job-alert-harvester

Narrative record of what each wave decided. Architecture detail lives in
`docs/product/architecture/brief.md`; decisions live in `docs/decisions/DR-NNNN-*.md`.

---

## Wave: DESIGN / [REF] Upstream Consultation

| Artifact | Read | Bearing on this wave |
|---|---|---|
| `docs/feature/job-alert-harvester/spike/findings.md` | ✓ | F1 (all alerts are digests), F2 (canonical job id), F3 (partially-overlapping resends), F4 (search terms derivable), F5 (plaintext is the parse target) |
| `docs/feature/job-alert-harvester/spike/wave-decisions.md` | ✓ | PROMOTE verdict; Vitest-not-Gherkin lean pivot; Phase 1 provenance deviation |
| `docs/decisions/DR-0001-persist-what-cannot-be-rederived.md` | ✓ | Cache policy; the watermark contradiction resolved in DR-0002 |
| `tests/acceptance/job-alert-harvester/walking-skeleton.test.mjs` | ✓ | Current truth — 8/8 green; no design here breaks it |
| `src/core/*.mjs`, `src/adapters/*.mjs`, `src/cli/harvest.mjs` | ✓ | Basis of the Reuse Analysis below |
| DISCUSS artifacts (user stories, AC, DoR) | ⊘ | None exist — feature went spike-first by explicit user decision |
| `docs/product/outcomes/registry.yaml` | ⊘ | Does not exist; Outcome Collision Check not run |
| `docs/product/architecture/brief.md` (prior sections) | ⊘ | Greenfield — this wave bootstraps the file |

---

## Wave: DESIGN / [REF] Design Decisions

| ID | Decision | Verdict | Rationale | Record |
|---|---|---|---|---|
| D-01 | Coverage intervals persist; processed ids derive from the cache | LOCKED | Coverage is what was *searched*; content is what is *held*. Batching makes `max(date)` unsound. | DR-0002 |
| D-02 | Cache is month-sharded, and its record shape is identical to the committed fixtures | LOCKED | Bounded directories, retention by `rm -rf`, and any fixture is droppable into the cache to reproduce a bug. | DR-0002 |
| D-03 | The agent couriers file paths and control values; never a record | LOCKED | Two corruptions on 2026-08-01, one of them silent (a comma shifted a salary a column). | DR-0003 |
| D-04 | Agent-supplied message ids are fetch hints, never data keys | LOCKED | Records are keyed by the id inside their own payload, so a mistyped id fails loudly instead of misfiling. | DR-0003 |
| D-05 | Every agent-supplied control value is verified against the ingested data | LOCKED | Window bounds, counts and the exhausted flag all fail closed. | DR-0003 |
| D-06 | Every agent-mediated port ships with its named API successor | LOCKED | A port with no named successor is a silent decision to depend on an agent forever. | DR-0003 |
| D-07 | Every column has exactly one owner | LOCKED | Fill-if-empty needs provenance the sheet does not carry; a provenance side-store goes stale on the first manual edit. | DR-0004 |
| D-08 | `Min/Max Salary (annual)` are harvester-owned; no derived-sibling columns | LOCKED (user, review) | Settled during review — parser fixes must reach salary history. | DR-0004 |
| D-09 | Never delete a row; never match a blank `Dedup Key`; never reorder columns | LOCKED | The harvest is window-bounded, so absence never means "gone". | DR-0004 |
| D-10 | Report derived-cell changes between runs | LOCKED | The payoff DR-0001 bought with the cache is invisible without it. | DR-0004 |
| D-11 | `TargetSheet` exposes `read()` / `apply(plan)` / `probe()` | LOCKED | One merge policy, two adapters, each executing in its natural mode. | DR-0005 |
| D-12 | Merge is pure and returns a `WritePlan`; only `apply` writes | LOCKED | "The preview modified the tracker" becomes unrepresentable, not merely tested. | DR-0005 |
| D-13 | Each run writes a merge receipt with input/output digests | LOCKED | Converts the unverifiable manual upload from a silent loss into a warning. Partial mitigation only. | DR-0005 |
| D-14 | Source descriptors are plain data; `extract` always returns an array | LOCKED | Encodes F1 structurally — a "single-job" source is just an array of one, so no shape field can exist. | DR-0006 |
| D-15 | Messages matching no descriptor are captured in an `Unmatched` bucket | LOCKED | Capture-everything applies to messages, not only to jobs. | DR-0006 |
| D-16 | Dedup keys are namespaced by source id | LOCKED | Same role advertised by agency and employer is genuinely two adverts. | DR-0006 |
| D-17 | Pure Core / Imperative Shell, functional paradigm | CONFIRMED | Already true of the skeleton; not re-litigated. | brief §4 |
| D-18 | Read and write are separate ports on the cache and the target | LOCKED | A component that only reads cannot be handed an object with a write method. | brief §4 |
| D-19 | Composition root wires, probes, then uses; failed probe refuses to start | LOCKED | Earned Trust — no dependency is assumed honest. | brief §5 |
| D-20 | `dependency-cruiser` enforces core purity in CI | LOCKED | Architecture rules without enforcement erode. | brief §9 |

---

## Wave: DESIGN / [REF] Component Decomposition

| Component | Path | Layer | Change |
|---|---|---|---|
| Source registry | `src/core/sources/registry.mjs` | core | new |
| LinkedIn descriptor | `src/core/sources/linkedin.mjs` | core | new (wraps existing parser unchanged) |
| LinkedIn parser | `src/core/parse-linkedin.mjs` | core | unchanged; moves behind the descriptor |
| Dedup key strategies | `src/core/dedup.mjs` | core | new (`canonicalKey`, `fuzzyKey`) |
| Corpus assembly | `src/core/harvest.mjs` | core | modified — `const SOURCE` (`harvest.mjs:9`) becomes descriptor-driven |
| Source-type classifier | `src/core/classify.mjs` | core | unchanged |
| Fit scorer | `src/core/fit.mjs` | core | unchanged (known defect carried forward) |
| Raw payload slimmer | `src/core/slim.mjs` | core | new |
| Merge planner | `src/core/merge.mjs` | core | new |
| Coverage interval algebra | `src/core/coverage.mjs` | core | new |
| Cache/fixture reader | `src/adapters/json-message-reader.mjs` | shell | modified — rename from `fixture-message-reader.mjs`, generalise the directory |
| Cache writer | `src/adapters/message-cache.mjs` | shell | new |
| Raw spill source | `src/adapters/raw-spill-source.mjs` | shell | new |
| Ledger store | `src/adapters/ledger-store.mjs` | shell | new |
| Target sheet adapter | `src/adapters/xlsx-target-sheet.mjs` | shell | modified — absorbs `xlsx-workbook-writer.mjs` as its create-new branch |
| Composition root | `src/cli/harvest.mjs` | shell | modified — gains subcommands and the probe gate |
| Harvest skill | `.claude/skills/harvest/SKILL.md` | agent | new — no `.claude/` directory exists in this project yet |

`src/core/**` imports no `node:` builtin, no adapter, and no SDK.

---

## Wave: DESIGN / [REF] Driving Ports

| Surface | Signature | Effect |
|---|---|---|
| `harvest plan-fetch --source <id> --from <d> --to <d> --batch <n>` | reads coverage + cache, prints the next uncovered window | reads only |
| `harvest ingest --raw <dir> --window <a>..<b> --expect <n> [--complete]` | slims spill files into the cache; commits coverage only on `--complete` + count match | writes cache, ledger |
| `harvest build --out <file> [--merge <file>] [--dry-run] [--report <file>]` | reparses the cache, merges, applies the plan | writes target (unless `--dry-run`) |
| `harvest --in <dir> --out <file>` | existing walking-skeleton invocation | preserved; test stays green |
| Harvest skill (Claude Code) | loops: `plan-fetch` → connector fetch → `ingest`, until covered | holds no parsing or domain knowledge |

---

## Wave: DESIGN / [REF] Driven Ports and Adapters

| Port | Operations | Interim adapter | Named successor | Change universe |
|---|---|---|---|---|
| `MessageSource` | `list(window)`, `read(id)`, `probe()` | `raw-spill-source` — agent in the data path | `gmail-api-source` (service account) | read-only |
| `MessageCacheReader` | `ids()`, `read(id)`, `probe()` | `json-message-reader` | same | read-only |
| `MessageCacheWriter` | `put(record)`, `probe()` | `message-cache` | same | `.cache/messages/**` |
| `CoverageLedger` | `read()`, `commit(interval)`, `probe()` | `ledger-store` | same | `.cache/coverage.json` |
| `TargetSheet` | `read()`, `apply(plan) → Receipt`, `probe()` | `xlsx-target-sheet` | `sheets-api-target` | target path + sibling temp file |

Every driven port carries `probe()`. Fault-injection scenarios per adapter are specified in
DR-0002 (ledger), DR-0003 (spill source) and DR-0005 (target sheet). The dangerous one:
`TargetSheet.probe()` must refuse when the `Jobs` tab has no `Dedup Key` column — merging without a
key appends every job as new and doubles the sheet.

---

## Wave: DESIGN / [REF] Technology Choices

| Choice | Version | License | Status |
|---|---|---|---|
| Node | 22 LTS | — | existing |
| ESM `.mjs`, no build step | — | — | existing |
| SheetJS `xlsx` | ^0.18.5 | Apache-2.0 | existing |
| Vitest | ^3.0.0 | MIT | existing (dev) |
| dependency-cruiser | ^16 | MIT | **added** (dev only) |
| googleapis | ^140 | Apache-2.0 | deferred — only with the Gmail/Sheets API adapters |

No new runtime dependency. No proprietary dependency.

---

## Wave: DESIGN / [REF] Reuse Analysis

**Hard gate.** Default is EXTEND. Every CREATE NEW is challenged against what already exists.

| Capability | Existing code | Verdict | Evidence |
|---|---|---|---|
| Parse a LinkedIn digest | `src/core/parse-linkedin.mjs` | **EXTEND** | Wrapped by a descriptor with zero logic change. Salary-smearing fix, noise filter and canonical-link reconstruction all stay as tested. |
| Collapse resends into one job | `src/core/harvest.mjs:64-86` | **EXTEND** | `upsertByDedupKey` already collapses on `row.dedupKey` (`harvest.mjs:68`) supplied by the extractor (`parse-linkedin.mjs:75`). The registry supplies the same field — the collapse loop is untouched. |
| Classify advertiser type | `src/core/classify.mjs` | **EXTEND** | Stays global rather than per-source: recruiters appear across every source and one list beats eight. No change this iteration. |
| Score fit | `src/core/fit.mjs` | **EXTEND** | No change this iteration; known defect carried forward. |
| Assemble Jobs/Companies/Sources tabs | `src/core/harvest.mjs:88-190` | **EXTEND** | Only `const SOURCE = 'LinkedIn'` (`harvest.mjs:9`) becomes descriptor-driven. Row shaping, grouping and sorting unchanged. |
| Read message records off disk | `src/adapters/fixture-message-reader.mjs` | **EXTEND** | The cache record shape is *deliberately identical* to the fixture shape, so the reader works over either directory. Renamed to `json-message-reader.mjs`; body unchanged. |
| Write a workbook | `src/adapters/xlsx-workbook-writer.mjs` | **EXTEND** | Retained verbatim as the create-new branch inside `xlsx-target-sheet.mjs`. The walking-skeleton path keeps working. |
| CLI entry point | `src/cli/harvest.mjs` | **EXTEND** | Gains subcommands and the probe gate; the existing `--in/--out` invocation is preserved so the acceptance test stays green. |
| Merge into a human-edited sheet | none | **CREATE NEW** — `src/core/merge.mjs` | Challenged against `upsertByDedupKey`: that collapses rows *within a corpus* and returns rows. Merge reconciles *corpus against external human-edited state*, applies per-column ownership, and returns a `WritePlan`. Overloading upsert would put sheet-state knowledge into corpus assembly. |
| Record harvested windows | none | **CREATE NEW** — `src/core/coverage.mjs` + `src/adapters/ledger-store.mjs` | DR-0001 named a watermark; nothing implements it. Interval merge/subtract/gap is pure logic with no existing home. |
| Write slimmed records to the cache | none | **CREATE NEW** — `src/adapters/message-cache.mjs` | Challenged against extending the reader: rejected. That would make a read-only adapter also a writer, defeating the read/write port split (D-18). |
| Slim a raw connector payload | none | **CREATE NEW** — `src/core/slim.mjs` | Small, but pure and load-bearing: it is where connector schema drift is detected (DR-0003). Keeping it out of the impure cache writer is the point. |
| Ingest connector spill files | none | **CREATE NEW** — `src/adapters/raw-spill-source.mjs` | No existing adapter reads the spill directory or enforces the window/count checks. |
| Select a parser for a message | none | **CREATE NEW** — `src/core/sources/registry.mjs` | Challenged as speculative while there is one source: overruled by the explicit seam constraint, and by the value of encoding F1 while the reason is fresh. ~15 lines. |
| Namespaced / fuzzy dedup keys | none (inline in parser) | **CREATE NEW** — `src/core/dedup.mjs` | The canonical-id key is currently a template literal in `parse-linkedin.mjs:75`. Extracting it gives the seven queued sources the fuzzy fallback for free. |

**8 EXTEND, 7 CREATE NEW.** No existing module is discarded.

---

## Wave: DESIGN / [REF] Deferred to DISTILL / DELIVER

| # | Question | Owner wave |
|---|---|---|
| Q1 | **Known defect, carried forward**: the fit scorer under-rates *"Agile Delivery, Scrum and Coaching — Consultant/Senior Consultant"* (Capgemini Invent), scoring 1 because "Coaching" does not match `/agile coach/` (`src/core/fit.mjs:6`). Not fixed here. | DELIVER |
| Q2 | **Known defect, carried forward**: salary-range parsing (`£55K–£70K`) is implemented (`parse-linkedin.mjs:39-50`) but exercised by no fixture. Needs a real range fixture before it can be trusted. | DISTILL |
| Q3 | First merge against the real 2025 tracker will surface header and schema differences. Reconciliation needs the actual file in hand — not a design-time guess. | DISTILL |
| Q4 | Batch size `n` for the fetch loop. Depends on observed per-call context cost in a real session; start at 25 and measure. | DELIVER |
| Q5 | Truncated-but-parsable spill payloads are the one drift mode DR-0003 does not fully close. Proposed slim-time sanity check (body < ~1 KB or no `/jobs/view/` link → quarantine) needs an acceptance scenario. | DISTILL |
| Q6 | Location normalisation (`United Kingdom` / `Greater London` / `London Area, United Kingdom` / `Portsmouth`) is a real task deferred by SPIKE and still deferred. | later iteration |
| Q7 | `docs/product/outcomes/registry.yaml` does not exist; no Outcome Collision Check was performed. | DELIVER |

---

## Wave: DESIGN / [REF] Expansion Catalog

Tier-2 sections available on request. **Not rendered** — lean density.

| ID | Expansion |
|---|---|
| X-01 | C4 Level 3 component diagram for the harvest CLI |
| X-02 | Coverage interval algebra — worked merge / subtract / gap cases |
| X-03 | `WritePlan` schema reference with a worked example |
| X-04 | Full probe fault-injection matrix across all five driven ports |
| X-05 | Column-ownership mapping against the real 2025 tracker header row |
| X-06 | Source-descriptor authoring guide for the seven queued sources |
| X-07 | ATAM-style quality attribute scenarios with measurable responses |
| X-08 | Gmail + Sheets API migration plan: credentials, scopes, rollout order |
| X-09 | Threat model for the local personal-data cache (~7.5 MB/yr, unencrypted) |
| X-10 | Harvest skill prompt specification: batch loop, refusal handling, stop conditions |

---

## Wave: DISTILL / [REF] Upstream Consultation

| Artifact | Read | Bearing on this wave |
|---|---|---|
| `docs/decisions/DR-0002` … `DR-0006` | ✓ | Probe contracts, merge ownership rules, coverage algebra, quarantine thresholds — source of every acceptance scenario below |
| `docs/feature/job-alert-harvester/feature-delta.md` (DESIGN sections) | ✓ | Driving/driven ports, component decomposition, deferred questions Q2/Q3/Q5 |
| `tests/acceptance/job-alert-harvester/walking-skeleton.test.mjs` | ✓ | Inherited GREEN — not modified, not duplicated |
| `src/core/*.mjs`, `src/adapters/*.mjs`, `src/cli/harvest.mjs` (RED scaffolds) | ✓ | Signatures are the contract this wave tests against; two scaffold signatures needed no change |
| DISCUSS artifacts | ⊘ | None exist — spike-first feature, degradation noted per Graceful Degradation Matrix; acceptance criteria derived from DR-0002…DR-0006 instead of user stories |

**Language**: JavaScript / Node 22 / ESM / Vitest, per explicit project override (no Cucumber — recorded lean pivot in `spike/wave-decisions.md`). Tags carried inside `describe()`/`it()` name strings rather than a `.feature` file.

## Wave: DISTILL / [REF] Scenario List

61 new tests across 7 files (plus the 8 inherited, untouched walking-skeleton tests). One `@property` PBT case is explicitly skipped (fast-check not installed, per task constraint) rather than silently omitted.

| File | Tags present | Scenarios | Error/edge share |
|---|---|---|---|
| `coverage.test.mjs` | `@error`, `@property` (1, skipped) | interval merge/collapse, subtract, next-gap, inverted-interval refusal | 5/14 ≈ 36% |
| `ingest-fail-closed.test.mjs` | `@driving_port`, `@error` | window-bound refusal, count-mismatch refusal, non-JSON/missing-body refusal (naming the file), duplicate-id resumability, `--complete`-gated commit | 5/7 ≈ 71% |
| `merge-plan.test.mjs` | `@error` | harvester-overwrite, human-never-rewritten, unknown-column preservation, no-delete, no-blank-key-match, no-reorder, new-row append, change reporting, purity | 2/9 ≈ 22% |
| `probe-contracts.test.mjs` | `@error` | ledger absent/corrupt/inverted/unwritable, target absent/non-workbook/no-key-column/unwritable | 6/8 = 75% |
| `source-registry.test.mjs` | `@error` | matches/no-match, select/no-select, extract-always-array, single-job-is-array-of-one, unmatched capture, namespaced dedup keys | 3/9 ≈ 33% |
| `slim.test.mjs` | `@error` | happy-path slim, record shape, body-too-short quarantine, no-link quarantine, boundary table, quarantine-carries-id | 2/7 ≈ 29% |
| `dry-run.test.mjs` | `@driving_port` | no-file create-new no-op, existing-file byte-identical, plan printed to operator | 0/3 — pure-preservation cluster, no negative branch needed |

Aggregate error/edge share across new tests: 23/59 ≈ **39%** (excludes the 1 skip and 1 static-sanity pass) — at the 40% target within rounding.

## Wave: DISTILL / [REF] Adapter Coverage Table

| Adapter/module | `@real-io` or equivalent | Covered by |
|---|---|---|
| `core/coverage.mjs` (pure) | n/a — pure, unit layer | `coverage.test.mjs` |
| `core/merge.mjs` (pure) | n/a — pure, unit layer | `merge-plan.test.mjs` |
| `core/slim.mjs` (pure) | n/a — pure, unit layer | `slim.test.mjs` |
| `core/dedup.mjs` (pure) | n/a — pure, unit layer | exercised indirectly via `linkedin.dedupKey` in `source-registry.test.mjs`; no direct `canonicalKey`/`fuzzyKey` unit test written — **gap, flagged below** |
| `core/sources/registry.mjs`, `linkedin.mjs` (pure) | n/a — pure, unit layer | `source-registry.test.mjs` |
| `adapters/ledger-store.mjs` | YES | `probe-contracts.test.mjs` (direct, real fs) + `ingest-fail-closed.test.mjs` (via CLI subprocess) |
| `adapters/message-cache.mjs` | YES | `ingest-fail-closed.test.mjs` (via CLI subprocess, real fs) |
| `adapters/raw-spill-source.mjs` | YES | `ingest-fail-closed.test.mjs` (via CLI subprocess, real fs) |
| `adapters/xlsx-target-sheet.mjs` | YES | `probe-contracts.test.mjs` (direct, real `xlsx` workbook) + `dry-run.test.mjs` (via CLI subprocess) |
| `cli/harvest.mjs` (composition root) | YES | `ingest-fail-closed.test.mjs`, `dry-run.test.mjs` — real subprocess invocation, exit code + stderr + fs state asserted |

**Gap acknowledged**: `core/dedup.mjs`'s `canonicalKey`/`fuzzyKey` have no direct unit test — only indirect coverage through the linkedin descriptor's `dedupKey`. `fuzzyKey`'s normalisation behaviour (case, whitespace, punctuation) is entirely untested. Flagged for DELIVER or a fast-follow DISTILL pass.

## Wave: DISTILL / [REF] Scaffolds

No new scaffolds created this session — all inherited from the prior DISTILL pass, signatures unchanged:

`src/core/coverage.mjs`, `src/core/merge.mjs`, `src/core/slim.mjs`, `src/core/dedup.mjs`, `src/core/sources/registry.mjs`, `src/core/sources/linkedin.mjs`, `src/adapters/ledger-store.mjs`, `src/adapters/message-cache.mjs`, `src/adapters/raw-spill-source.mjs`, `src/adapters/xlsx-target-sheet.mjs`, `src/cli/harvest.mjs`.

All carry `__SCAFFOLD__ = true` and throw `Error(...)` (not a special assertion type — JS convention per the polyglot matrix) on every method. RED classification confirmed in `docs/feature/job-alert-harvester/distill/red-classification.md`: 59/59 new failing tests are `MISSING_FUNCTIONALITY`, zero `IMPORT_ERROR`/`SETUP_FAILURE`.

## Wave: DISTILL / [REF] Test Placement

`tests/acceptance/job-alert-harvester/*.test.mjs` — one file per DR-scoped cluster, matching the file already established by the inherited walking skeleton (`tests/acceptance/job-alert-harvester/walking-skeleton.test.mjs`) and the support fixtures at `tests/acceptance/job-alert-harvester/support/domain-types.mjs`. `tests/common/state-delta.mjs` is the project-wide Mandate 8 port (JS pilot), reused unchanged. No new directories introduced.

## Wave: DISTILL / [REF] Driving Adapter Coverage

| Entry point (from DESIGN) | Exercised by | Protocol |
|---|---|---|
| `harvest --in <dir> --out <file>` | inherited walking-skeleton (unchanged) | subprocess |
| `harvest ingest --raw <dir> --window <a>..<b> --expect <n> [--complete]` | `ingest-fail-closed.test.mjs` (7 scenarios) | subprocess, real fs |
| `harvest build --out <f> [--merge <f>] [--dry-run] [--report <f>]` | `dry-run.test.mjs` (3 scenarios, `--dry-run` only) | subprocess, real fs |
| `harvest plan-fetch --source <id> --from <d> --to <d> --batch <n>` | **not covered this session** — flagged below | — |
| Harvest skill (Claude Code) | not applicable — skill does not exist yet (DR-0003) | — |

**Gap acknowledged**: `plan-fetch` has zero acceptance coverage. It is pure with respect to the outside world (reads coverage + cache, prints the next uncovered window, writes nothing per DR-0002), so its logic is fully exercised indirectly through `coverage.test.mjs`'s `nextUncoveredWindow` tests — but no test invokes the CLI subcommand itself. Flagged as a priority-8 item for a fast-follow pass (out of the 7-item priority list given for this session).

## Wave: DISTILL / [REF] Mandate Compliance Evidence

- **CM-A** (Mandate 1, hexagonal boundary): every test imports either a `core/*` pure function directly, an adapter factory (`create*`) directly, or invokes the CLI subprocess — never an internal helper. Zero imports of unexported internals.
- **CM-B** (Mandate 2, business language): scenario/`describe`/`it` names use domain terms (window, coverage, quarantine, Dedup Key, human-owned column) — technical terms (`spawnSync`, `xlsx`, file paths) live only in step bodies and the `support/domain-types.mjs` helpers, never in test titles.
- **CM-E/CM-8** (Mandate 8, Universe-bound assertion): every state-mutating test at layers 1-3 (subprocess/FS acceptance for `ingest-fail-closed.test.mjs`, `dry-run.test.mjs`, `probe-contracts.test.mjs`'s writable-directory tests) uses `assertStateDelta(before, after, {universe, expected})` with port-exposed observables (`cache.messageIds`, `ledger.coverage`, `workspace.files` digest) — never internal fields. Pure-function tests (`coverage.test.mjs`, `merge-plan.test.mjs`, `slim.test.mjs`, `source-registry.test.mjs`) assert directly on return values since there is no state to mutate.
- **CM-F/CM-9** (Mandate 9, layer-dependent PBT): no `fast-check` machinery used anywhere (project constraint — not installed, must not be added). One `@property`-tagged test is `it.skip`, named and explained rather than silently omitted, flagging the interval-algebra invariants (merge idempotence, non-overlapping gaps) that would benefit from generative PBT once the dependency question is revisited.
- **CM-H/CM-11** (Mandate 11, layer 3+ sad paths stay example-based): all CLI-subprocess sad paths (`ingest-fail-closed.test.mjs`) are named, explicit examples — no generative machinery.
- **Mandate 7** (RED-ready scaffolding): confirmed via `docs/feature/job-alert-harvester/distill/red-classification.md` — 59/59 new failures are `MISSING_FUNCTIONALITY`.
- **Walking skeleton integrity**: `tests/acceptance/job-alert-harvester/walking-skeleton.test.mjs` unmodified; 8/8 GREEN confirmed both before and after this session's work.

## Wave: DISTILL / [REF] Deferred / Known Gaps

| # | Gap | Disposition |
|---|---|---|
| G1 | `plan-fetch` CLI subcommand has no direct acceptance test | **closed 2026-09-14** — `tests/acceptance/job-alert-harvester/plan-fetch.test.mjs`, see [REF] Window sizing below |
| G2 | `core/dedup.mjs` `canonicalKey`/`fuzzyKey` have no direct unit test, only indirect via `linkedin.dedupKey` | fast-follow — `fuzzyKey` normalisation is entirely unverified |
| G3 (was Q2) | Salary-range parsing (`£55K–£70K`) still has no fixture | not addressed this session — out of the 7-item priority list given |
| G4 (was Q3) | Merge against the real 2025 tracker will surface schema differences | unaddressed — needs the real file, not fabricable from a spec |
| G5 | `--policy=inherit` bootstrap: `docs/architecture/atdd-infrastructure-policy.md` created fresh this session (file was absent) | resolved this session |

## Wave: DELIVER / [WHY] Upstream Issues

| Issue | Origin | Resolution |
|---|---|---|
| Synthetic digest body (156 chars) below the 1024-char quarantine threshold made two slim happy-path scenarios unsatisfiable | DISTILL `aDigestBody()` builder | Builder made realistic — `af9925c` |
| Invented spill contract: `{result}`-wrapped `*.json` versus the harness's flat `mcp-*-get_message-*.txt` in a shared directory | DISTILL `aSpillPayload()`; DR-0003 fragility assessment | DR-0007 (spill contract is what the harness writes); DISTILL re-models from a real spill file |
| Duplicate-skip sits in the CLI, not the spill adapter; `message-cache` gained `messageIds()` | DESIGN component decomposition | Step 01-08, `d5fdeed`; consistent with DR-0002 (listing the cache is the ledger) |
| `ingest` commits coverage as `source: 'linkedin'` with no `--source` flag | DESIGN driving ports | Not pinned by any acceptance test; revisit when a second source lands |
| `plan-fetch` has no CLI-level acceptance test | DISTILL gap G1 (plan-fetch uncovered) | Fast-follow for DISTILL |
| `raw-spill-source.probe(expectedCount)` takes an argument, unlike the zero-argument sibling probes | DR-0003 probe contract | Accepted as implemented in step 01-07, `0886a8d` |
| DESIGN promised a read-only `json-message-reader` (renamed from `fixture-message-reader`) exposing `ids()`, `read(id)` and `probe()`; what shipped kept the old name and put `messageIds()` on the cache writer `message-cache` | Orchestrator scope addition in step 01-08 (CLI ingest), `d5fdeed`, which contradicted DESIGN's separate reader port | Restore the design in DELIVER Phase 3 refactor — rename the reader, give it `ids()`, move cache listing off the writer; user decision 2026-09-13 |

## Wave: DISTILL / [REF] Harvest skill contract

Roadmap step 01-09 ("Harvest Claude Code skill — thin courier, no record content") shipped
with `test_file: null` — DISTILL is the only wave that authors acceptance tests, and none
existed for the skill. This gap-fill session closes it: a structural contract test plus a
RED-ready scaffold, no real skill content (DELIVER writes the prose).

### Rule list (one `it()` per rule in `harvest-skill.test.mjs`)

| # | Rule | Source |
|---|---|---|
| 1 | Frontmatter has `name` and `description` | roadmap step 01-09 |
| 2 | Loops plan-fetch → fetch → ingest → repeat until plan-fetch reports full coverage | roadmap step 01-09 criterion 2 |
| 3 | Only two CLI verbs (`plan-fetch`, `ingest`); no `build`; no `cat`/`jq`/`head`/`grep`/`sed` against spill or cache | DR-0003 Rule 1, roadmap step 01-09 criterion 3 |
| 4 | Flags drawn only from `--source --from --to --batch --raw --window --expect --complete` | DR-0003 Rule 3 |
| 5 | Forbids opening/quoting/summarising a spill file's contents | DR-0003 Rule 1 |
| 6 | Message ids are fetch hints only, never keys or data | DR-0003 Rule 2 |
| 7 | Per-window staging: moves newly spilled `mcp-*-get_message-*.txt` files, by path, into a fresh per-window directory passed as `--raw` | DR-0007 |
| 8 | Gmail queries use `after:`/`before:` Unix-second UTC-midnight bounds, never `YYYY/MM/DD` | verified-facts (2026-09-13 probe) |
| 9 | Messages fetched with `messageFormat: FULL_CONTENT` so they spill | verified-facts (2026-09-13 probe) |
| 10 | Stops the window without `--complete` and reports on an inline (non-path) fetch result | DR-0007 Exceptions |
| 11 | `--complete` only when every page is exhausted and every message fetched; `--expect` equals the fetched count | DR-0003 Rule 3 |
| 12 | No record-field placeholders (`{{subject}}`, `<plaintextBody>`, `${snippet}`); no instruction to extract jobs/companies/salaries/titles; explicitly delegates that logic to the CLI | DR-0003 Consequences |

### Scaffold

`.claude/skills/harvest/SKILL.md` — new file (no `.claude/` directory previously existed).
Minimal RED-ready scaffold: valid frontmatter (`name: harvest`, one-line `description`), a
body stating it is an unimplemented scaffold, and the `<!-- __SCAFFOLD__ -->` marker. Carries
no CLI invocations, no control-value flags, no DR-0003/DR-0007 language — every rule beyond
frontmatter fails against it for the right reason (content missing), confirmed below.

### Test placement

`tests/acceptance/job-alert-harvester/harvest-skill.test.mjs`, alongside the feature's other
acceptance files — no new directory needed since the harness is document-structural (reads
`SKILL.md` via `readFileSync`), not a driving-port invocation, so it does not join
`support/domain-types.mjs`'s CLI-invocation helpers.

### RED confirmation (2026-09-13)

`npx vitest run tests/acceptance/job-alert-harvester/harvest-skill.test.mjs` against the
scaffold: **rule 1 passes** (frontmatter present); **rules 2-12 fail**, each on a clean
`AssertionError` (`expected false to be true` / `expected 0 to be greater than 0`) inside the
test body — zero import errors, zero setup errors. Full-suite re-run: **69 passed / 27 failed
/ 1 skipped** (was 68/16/1) — the 8/8 walking skeleton stayed green and every previously-passing
test still passes; the delta is exactly +1 pass (rule 1) and +11 fails (rules 2-12).

## Wave: DISTILL / [REF] Window sizing

Back-propagation session, 2026-09-14. Reading the committed harvest skill against a real
90-day run exposed a coverage bug that the 12 passing structural `harvest-skill.test.mjs`
rules don't catch: `plan-fetch` returns the whole uncovered gap for the requested range
(observed: `harvest plan-fetch: 2026-06-15..2026-09-13 batch=25` for a 90-day request), so
a ~500-message backfill can't be exhausted in one pass and `--complete` is never
legitimately reachable — coverage never commits. Separately, `.claude/skills/harvest/SKILL.md`
passed `ingest --window <range-from>..<range-to>` — the *requested* range, not the window
`plan-fetch` actually returned — which with `--complete` would commit coverage for days
never fetched: silent, permanent mail loss.

**Decision (user-approved amendment to DR-0002)**: `plan-fetch` returns at most one UTC day
— the earliest uncovered day within `--from..--to`, printed as `<d>..<d>`. A day covered by
a zero-message interval counts as covered and is never re-offered. Coverage stays filtered
by `--source`. When nothing in the range is uncovered, `plan-fetch` reports full coverage.
`plan-fetch` writes nothing. `ingest --window` must be exactly the window `plan-fetch`
printed, never the requested range. Window sizing is domain logic (DR-0003: the agent
couriers paths and control values, never records), so it belongs in the CLI/core, never in
the skill — whether core gains a function or the CLI caps the result is DELIVER's call.

### Scenario list

| Scenario | File | Tag |
|---|---|---|
| Offers only the first uncovered day on an empty ledger | `plan-fetch.test.mjs` | `@driving_port` |
| Offers the next day once the first is covered | `plan-fetch.test.mjs` | `@driving_port` |
| Skips a day covered by a zero-message interval | `plan-fetch.test.mjs` | `@driving_port` |
| Reports full coverage with no window offered | `plan-fetch.test.mjs` | `@driving_port` (already passing — pins existing behaviour) |
| A different `--source`'s coverage does not count | `plan-fetch.test.mjs` | `@driving_port` |
| Writes nothing to the workspace | `plan-fetch.test.mjs` | `@driving_port` (already passing — pins existing behaviour) |
| `@error` refuses an inverted `--from`/`--to` range | `plan-fetch.test.mjs` | `@driving_port @error` |
| Rule 13: `ingest --window` is the window `plan-fetch` returned, never the requested range | `harvest-skill.test.mjs` | structural (SKILL.md contract) |

### Adapter / port coverage

`plan-fetch` is read-only (`ledgerStore.probe()` + `.read()`, no write path) — the CLI-level
scenario above exercises the real `createLedgerStore` adapter with real filesystem fixtures
(coverage JSON written directly per scenario), consistent with `ingest-fail-closed.test.mjs`'s
existing subprocess/FS-acceptance treatment (Mandate 8/11). No new adapter introduced; no
new row needed in `docs/architecture/atdd-infrastructure-policy.md`.

### Test placement

`tests/acceptance/job-alert-harvester/plan-fetch.test.mjs`, alongside the feature's other
CLI-level acceptance files, driven through `runHarvest` from `support/domain-types.mjs`
(Pillar 3 — same composition root as `ingest-fail-closed.test.mjs`). Every scenario asserts
via `assertStateDelta` (Mandate 8) since `plan-fetch` is entirely read-only: the universe-guard
proves the write-nothing invariant on every scenario, not only the one named for it.

### RED confirmation (2026-09-14)

Full detail in `docs/feature/job-alert-harvester/distill/red-classification.md` ("2026-09-14
session"). Summary: baseline 80 passed / 16 failed / 1 skipped (97) → after 82 passed / 22
failed / 1 skipped (105). 6 of 8 new scenarios fail `MISSING_FUNCTIONALITY` (the one-day cap
and the inverted-range refusal are unimplemented); 2 already pass, pinning pre-existing
correct behaviour (full-coverage reporting; write-nothing). Zero previously-passing tests
regressed. Walking skeleton stayed 8/8 GREEN.
