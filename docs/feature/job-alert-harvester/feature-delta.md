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
