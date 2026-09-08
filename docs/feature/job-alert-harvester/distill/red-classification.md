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

## Gate verdict

**PASS.** Handoff to DELIVER is not blocked. All new tests fail for the right reason —
implementation is missing, not test infrastructure. The 8 inherited walking-skeleton
tests remain GREEN and untouched.
