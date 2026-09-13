# RED Classification — job-alert-harvester DISTILL

Per `nw-distill` § Pre-DELIVER fail-for-the-right-reason gate. Run: `npx vitest run
tests/acceptance/job-alert-harvester/` on 2026-09-08, against the RED scaffolds inherited
from the prior DISTILL session (no production code written this session).

## Result

- **69 tests total**: 8 pre-existing walking-skeleton tests (GREEN, untouched) + 61 new.
- **New tests: 59 FAIL, 1 PASS (static-data sanity check), 1 SKIP (`@property`, explicitly deferred — no fast-check installed).**
- **59/59 failing tests classify `MISSING_FUNCTIONALITY`.** Zero `IMPORT_ERROR` / `FIXTURE_BROKEN` / `SETUP_FAILURE`. Zero `WRONG_ASSERTION` / `OBSERVABLE_NOT_AT_PORT`.

Every failure traces to one of two shapes, both correct RED:

1. **Direct scaffold throw** — the test calls a pure core function or adapter method
   directly (`mergeIntervals`, `planMerge`, `slim`, `selectSource`, `linkedin.extract`,
   `linkedin.matches`, `linkedin.dedupKey`, `extractAll`, `validateInterval`,
   `subtractCoverage`, `nextUncoveredWindow`, `store.read`/`commit`/`probe`,
   `sheet.probe`) and the scaffold's `notImplemented()` throws `Error: <fn>: Not yet
   implemented — RED scaffold`. Vitest reports this as a failed assertion inside the
   test body (`expect(...)` never reached, or the thrown value fails an
   `expect(fn).not.toThrow()` / `refusalOf(...)` comparison). No import ever fails —
   every scaffold module resolves and exports the expected symbols.
2. **CLI-level mismatch** — the test invokes the real CLI subprocess (`runHarvest`) and
   asserts a *specific* outcome (a named refusal reason in stderr, an exit code of 0 on
   a success path, cache/ledger state growing by exactly one entry). The CLI's
   composition root currently refuses **unconditionally** with a single generic message
   (`harvest <subcommand>: Not yet implemented — RED scaffold`, exit 1) regardless of
   input, so any assertion more specific than "refuses" properly fails.

## A note on a defect caught and fixed during this session

The first draft of `ingest-fail-closed.test.mjs` and `dry-run.test.mjs` had four tests
that asserted only "refuses with unchanged state" or "creates no file" — both trivially
true of the CLI's *current* unconditional-refusal behaviour, independent of whether the
declared business rule (window bounds, count check, `--complete` gating) was ever
implemented. That is the vacuous-property trap (Hebert ch.6, negative-testing workflow):
the assertion would still pass once real logic landed **only by accident**, and would
never have caught a regression in between. Fixed by tightening each to assert a fact the
generic refusal message and the current no-op cannot satisfy — a named reason in stderr
(`window`, `count`/`expect`), or an exit code of 0 (success), or cache growth by exactly
one. Re-run confirmed all four now fail for `MISSING_FUNCTIONALITY`, not vacuously pass.

## By file

| File | Tests | RED reason |
|---|---|---|
| `coverage.test.mjs` | 13 fail, 1 skip (`@property`) | direct scaffold throw (`mergeIntervals`/`subtractCoverage`/`nextUncoveredWindow`/`validateInterval`) |
| `ingest-fail-closed.test.mjs` | 7 fail | CLI-level mismatch against the unconditional-refusal scaffold |
| `merge-plan.test.mjs` | 9 fail | direct scaffold throw (`planMerge`) |
| `probe-contracts.test.mjs` | 8 fail | direct scaffold throw (`createLedgerStore`/`createTargetSheet` methods) |
| `source-registry.test.mjs` | 8 fail, 1 pass | direct scaffold throw (`selectSource`/`extractAll`/`linkedin.*`); 1 pass is a static-data assertion on the frozen `REGISTRY` array itself, not a behaviour call |
| `slim.test.mjs` | 7 fail | direct scaffold throw (`slim`) |
| `dry-run.test.mjs` | 3 fail | CLI-level mismatch against the unconditional-refusal scaffold |

## Gate verdict (2026-09-08 session)

**PASS.** Handoff to DELIVER is not blocked. All new tests fail for the right reason —
implementation is missing, not test infrastructure. The 8 inherited walking-skeleton
tests remain GREEN and untouched.

---

## 2026-09-13 session — DR-0007 spill contract back-propagation

DELIVER had since implemented `raw-spill-source.mjs`, `slim.mjs`, `ledger-store.mjs` and
`message-cache.mjs` for real (no longer scaffolds — see intervening commits `namespaced
dedup key strategies` and `slim spill payloads`). During that work a defect was found on
the live harness: the acceptance suite's `aSpillPayload()` invented a `{ result: <message>
}`-wrapped `*.json` shape that does not exist. The real harness writes flat JSON (no
wrapper) to `mcp-<connector-id>-get_message-<epoch-ms>.txt`, in a directory shared with
unrelated tool output, selected by that filename pattern rather than by extension (DR-0007,
`docs/decisions/DR-0007-spill-contract-is-what-the-harness-writes.md`).

This session replaced the invented model with one copied from a real captured message
(`fixtures/spill/mcp-62a90b7b-7d1b-4f3b-b3b7-8a73582688a6-get_message-1789314619969.txt`)
and updated the test-side spill builders accordingly. `src/` was not touched. Run:
`npx vitest run` on 2026-09-13.

### Before / after

| | Before | After |
|---|---|---|
| Test files | 11 | 12 (+`spill-contract.test.mjs`) |
| Total tests | 80 | 85 (+5: 4 new CLI-level DR-0007 scenarios, 1 new `slim` unit scenario) |
| Passed | 63 | 48 |
| Failed | 16 | 36 |
| Skipped | 1 (`@property`) | 1 (`@property`, unchanged) |

The 16 pre-existing failures (`merge-plan.test.mjs` 9, `probe-contracts.test.mjs` 4,
`dry-run.test.mjs` 3) are untouched by this session — still the same RED scaffolds, same
reasons, confirmed by re-run. The 20 newly-red tests are all attributable to the spill
contract correction.

### Newly RED — classification

All 20 classify **`MISSING_FUNCTIONALITY`**. Zero `IMPORT_ERROR` / `FIXTURE_BROKEN` /
`SETUP_FAILURE`. The adapter (`src/adapters/raw-spill-source.mjs`) still filters spill
entries by `.json` extension and still unwraps a `{ result: ... }` envelope that the real
harness never writes; `src/core/slim.mjs` still reads `rawPayload.result` directly. Every
failure below traces to one of those two unimplemented pieces of DR-0007:

| Test | File | Failure shape | Root cause |
|---|---|---|---|
| `@error refuses when an ingested message falls outside the declared window` | `ingest-fail-closed.test.mjs` | assertion: stderr lacks `window` | probe() filters by `.json`; `.txt` harness file never selected → refuses `count-mismatch` before the window check ever runs |
| `@error refuses on a non-JSON spill file, naming the file rather than skipping it` | `ingest-fail-closed.test.mjs` | assertion: stderr lacks filename | same — `.txt` file never selected |
| `@error refuses on a spill file whose envelope has no plaintextBody key at all, naming the file` | `ingest-fail-closed.test.mjs` | assertion: stderr lacks filename | same |
| `a duplicate id already cached is skipped silently and counts as satisfied` | `ingest-fail-closed.test.mjs` | assertion: exit code 1, not 0 | same |
| `coverage does NOT commit when the count check passes but --complete is absent` | `ingest-fail-closed.test.mjs` | assertion: exit code 1, not 0 | same |
| `slims a well-formed digest payload with no quarantine` | `slim.test.mjs` | uncaught `TypeError` reading `.plaintextBody` of undefined | `slim()` reads `rawPayload.result`; flat payload has no `.result` |
| `the slimmed record shape matches the cache/fixture record shape exactly` | `slim.test.mjs` | same | same |
| `slim drops the harness's extra keys — a real-shape payload slims to exactly the six cache keys` (new) | `slim.test.mjs` | same | same |
| `@error quarantines a digest body shorter than the minimum length, as truncated` | `slim.test.mjs` | same | same |
| `@error quarantines a digest body with no /jobs/view/ advert link, even when long enough` | `slim.test.mjs` | same | same |
| `one character below the minimum length is quarantined` (parametrized) | `slim.test.mjs` | same | same |
| `exactly the minimum length, with a link, is not quarantined` (parametrized) | `slim.test.mjs` | same | same |
| `a quarantined record carries the message id, for correlation with a human review queue` | `slim.test.mjs` | same | same |
| `the real spill fixture ingests` (new) | `spill-contract.test.mjs` | assertion: exit code 1, not 0 | selection-by-pattern not implemented; real fixture's `.txt` name never picked up |
| `unrelated tool-result files in the same directory are ignored...` (new) | `spill-contract.test.mjs` | assertion: exit code 1, not 0 | same |
| `@error a JSON spill file without the message envelope refuses not-a-message, naming the file` (new) | `spill-contract.test.mjs` | assertion: stderr lacks filename/`not-a-message` | same — never reaches the envelope check; refuses `count-mismatch` first |
| `@error a message with an empty plaintextBody refuses missing-plaintext-body` (new) | `spill-contract.test.mjs` | assertion: stderr lacks filename/`missing-plaintext-body` | same |
| `refuses a spilled message whose date falls outside the declared window` | `tests/integration/job-alert-harvester/raw-spill-source.test.mjs` | assertion: refusal code is `missing-plaintext-body`, not `outside-window` | integration test still builds its fixture via the shared `aSpillPayload()` and now receives DR-0007-shaped (flat) payloads against the unchanged adapter |
| `does not refuse or drop a file whose id duplicates one already cached...` | `tests/integration/job-alert-harvester/raw-spill-source.test.mjs` | uncaught `Error: spill.missing-plaintext-body` | same |
| `reads back the full raw payload for a given id...` | `tests/integration/job-alert-harvester/raw-spill-source.test.mjs` | uncaught `Error: spill.missing-plaintext-body`, and the surviving assertions read `payload.result.id` | same, compounded by the test's own assertions still expecting the `{ result }` wrapper |

### `tests/integration/` still encoding the invented shape (not modified — DELIVER crafter's file)

`tests/integration/job-alert-harvester/raw-spill-source.test.mjs` imports the shared
`aSpillPayload()` builder from `tests/acceptance/job-alert-harvester/support/domain-types.mjs`
and, in 3 of its 7 tests, calls `source.list()` / `source.read()` and asserts against the
old wrapped shape (one test literally asserts `payload.result.id`). Changing the shared
builder to the DR-0007 flat shape was unavoidable — the builder is the single source of
truth for "what a spill payload looks like" — and it breaks these 3 tests as a direct
consequence. Per this session's scope boundary, the file was left untouched; DELIVER owns
updating it alongside the adapter implementation. The other 4 tests in the file (not-JSON,
missing-body via an inline literal, count-mismatch via `probe()`, absent-directory) build
their own fixtures independently of `aSpillPayload()` and are unaffected.

### Gate verdict (2026-09-13 session)

**PASS.** Handoff to DELIVER is not blocked. All 20 newly-red tests fail for the right
reason — DR-0007 file-selection and payload-unwrapping are not yet implemented, not a
test-infrastructure defect. The 8 walking-skeleton tests remain GREEN and untouched. The
16 pre-existing scaffold failures are unaffected. The 3 newly-red `tests/integration/`
tests are flagged above for DELIVER, not fixed here (out of this session's scope).
