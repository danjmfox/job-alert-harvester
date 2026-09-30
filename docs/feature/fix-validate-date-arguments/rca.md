# RCA: date arguments are never checked for being real calendar days

Doc type: Explanation.

**Date**: 2026-09-30
**Analyst**: Rex (nw-troubleshooter)
**Scope**: every command-line value that is a date: `plan-fetch --from/--to`, `fetch --from/--to`, `ingest --window`. Investigation only; no code or test changed. Reproductions ran offline in the session scratchpad with an empty `HOME` (no credential read, no network, no Gmail call). The real `.cache/coverage.json` was read for counts only.

## Problem Statement

`--from` and `--to` accept any string. `validateInterval` (`src/core/coverage.mjs:34-38`) checks only `toEpochDay(to) < toEpochDay(from)`, and `toEpochDay` (`:14-17`) splits on `-`, coerces with `Number`, and calls `Date.UTC`, which never rejects. Nothing in the path asks "is this a real `YYYY-MM-DD`?". Bad input then does one of three things: it is silently repaired into a different day, it makes every comparison false (reported as "fully covered"), or it is written to the ledger verbatim.

## Evidence Base

- `src/core/coverage.mjs:14-17` `toEpochDay`: `Number('012')` is 12, `Number('2')` is 2, `Date.UTC(2026, 1, 30)` rolls to 2 March, month 13 rolls into next year, a missing part gives `NaN`. No shape check.
- `src/core/coverage.mjs:34-38` `validateInterval`: `NaN < NaN` is false, so a non-date passes as "not inverted".
- `src/core/cli-options.mjs:1-90`: the parser knows option names and value presence only. `--from` and `--to` are `VALUE` entries (`:15,:18`) and `CliRefusal` (`:3-8`) has no date code. It was written for the previous fix (unknown options) and never owned value semantics.
- `src/cli/harvest.mjs:127-128` (`plan-fetch`) and `:166-167` (`fetch`) call `validateInterval` straight after the presence check. `runIngest` (`:76`, `parseWindow` `:65-71`) splits on `..` and checks only that both halves are non-empty.
- `src/core/gmail-query.mjs:8-17` has a guard (`^\d{4}-\d{2}-\d{2}$` plus `Number.isFinite(Date.parse(...))`). It is not enough: V8 parses `2026-02-30T00:00:00Z` as 2 March (checked: `Date.parse('2026-02-30T00:00:00Z')` = 1772409600000) and only month 13 or 00 gives `NaN`. It is also the last step of `fetch`, after the ledger and clamp logic have already used the raw strings.
- History: `git log -S validateInterval` gives `df11809` (interval algebra), `8ca12ce` (ledger adapter), `8d4bb55` ("plan-fetch offers one UTC day and refuses inverted ranges"), `5e62d48` (fetch reuses it). Every step added the inverted-range rule; none added a well-formedness rule.

## Date-bearing entry points

| Entry point | Reads | Validation today | Writes on bad input |
|---|---|---|---|
| `plan-fetch --from --to` (`harvest.mjs:122-142`) | ledger | `validateInterval` (inversion only) | none (read-only, wrong output) |
| `fetch --from --to` (`harvest.mjs:163-201`) | ledger, Gmail (after probe) | `validateInterval`, then `clampToSettledDays`; `gmailWindowQuery` re-checks shape per window | cache messages and ledger, with wrong days (see below) |
| `ingest --window a..b` (`harvest.mjs:73-120`) | raw spill dir | none beyond "two non-empty halves" | `--complete` commits the raw window strings to the ledger |
| `build`, `auth`, `import`, rebuild form | no dates | not applicable | not applicable |

`ingest --window` is the entry point the report did not list. It is the worst one (see WHY 1C).

## Reproduction

Pure calls from `coverage.mjs` and `gmail-query.mjs` (now = 2026-09-30) and the real CLI in a scratch workspace.

| `from`..`to` | Result |
|---|---|
| `2026-02-30`..`2026-03-02` | window planned as `2026-03-02` (the invalid `from` rolled to 2 March) |
| `2026-01-01`..`2026-02-31` | plans `2026-01-01`; the `to` is really 3 March |
| `banana`..`2026-03-02` | `nextUncoveredDay` null, so `plan-fetch` says "fully covered" and `fetch` says "already covered" |
| `2026-01-01`..`banana` | `clampToSettledDays` treats `NaN <= lastSettled` as false and replaces `to` with the last settled day: range becomes `2026-01-01`..`2026-09-29` |
| `2026-2-1`..`2026-2-3`, `2025-012-01` | accepted; normalised to `2026-02-01`, `2025-12-01` |
| `2026-05`..`2026-06` | `from` is `NaN`: "covered" |
| `2026-13-01`..`2026-13-02` | plan-fetch plans `2027-01-01`; fetch says "nothing settled" (2027 is in the future) |
| `ingest --raw raw --window banana..banana --expect 0 --complete` | exit 0, `coverage committed for banana..banana`; ledger now holds `{"from":"banana","to":"banana"}` |
| `ingest ... --window 2026-13-01..2026-13-02 --expect 0 --complete` | exit 0, ledger holds `2026-13-01..2026-13-02` |
| `ingest ... --window 2026-02-31..2026-02-30 --complete` | refused `ledger.interval.inverted` (by string-to-day comparison; not for being invalid) |

## WHY chains

### Branch A: plan-fetch and fetch report success on nonsense (the reported symptom)

- **WHY 1A**: exit 0 and "fully covered" or a rolled-over plan for non-dates. [Evidence: reproduction rows 1-7.]
- **WHY 2A**: the only guard is `validateInterval`, whose only test is `to < from`; `NaN` comparisons are false, and `Date.UTC` repairs out-of-range parts instead of failing. [Evidence: `coverage.mjs:14-17,34-38`.]
- **WHY 3A**: the string-to-day conversion is private to the interval algebra and is total by design (it assumes its input is already a clean `YYYY-MM-DD`). Callers therefore have nowhere to ask "is this text a day?". [Evidence: `toEpochDay` not exported; `coverage.mjs:10-25`.]
- **WHY 4A**: the ledger and interval algebra were built for dates that came from the program itself (`completedAt`, `fromEpochDay` output). Command-line text was added later (`8d4bb55`, `5e62d48`) and reused the same internal function, so trusted-input assumptions crossed the boundary. [Evidence: git history above; `harvest.mjs:128,167` pass `options.from/to` unchanged.]
- **WHY 5A (root cause)**: no boundary layer owns "value semantics of an option". The parser (`cli-options.mjs`) stops at syntax, the domain assumes clean input, and each `run*` function checks presence only. The one check that exists (inversion) was added as a domain rule, not as input validation, so the well-formedness gap was never named. [Evidence: `CliRefusal` has no value codes; `harvest.mjs:127,166,76`.]

### Branch B: `fetch` writes state for the wrong days

- **WHY 1B**: `fetch --from 2026-01-01 --to banana` fetches 2026-01-01 through 2026-09-29 (the clamp substitutes yesterday). `--from 2026-02-30` fetches 2 March. Both write real cache files and valid-looking ledger intervals for days the operator did not ask for. [Evidence: reproduction rows 1, 4.]
- **WHY 2B**: `fetch` derives every window from `nextUncoveredDay`, which emits `fromEpochDay(...)` output, so what reaches Gmail and the ledger is always a well-formed day, even when it is the wrong day. [Evidence: `coverage.mjs:19-25,98-101`; `fetch-loop.mjs:36-73`.]
- **WHY 3B**: because the repair happens inside the algebra, the write path has no failing signal. `gmailWindowQuery`'s own guard (`gmail-query.mjs:8-17`) sees only already-normalised windows, and its `Date.parse` check does not reject `02-30` anyway (above).
- **WHY 4B**: the guards were placed at the last adapter (the query builder) as a safety net rather than at the first place the text enters. [Evidence: `gmail-query.mjs` header comment; no equivalent in `harvest.mjs`.]
- **WHY 5B (root cause)**: same as 5A, with a consequence: a fail-closed system (DR-0003 principle) has validation at the far end and repair in the middle, so bad input is converted into good-looking wrong state. Which days were written is not recoverable from the ledger, because a repaired day looks like a requested one.

Write-path summary for `fetch` (read from code, not run): Gmail query strings are always built from normalised days (`gmailWindowQuery` is called with `nextUncoveredDay` output), `.cache/messages/<YYYY-MM>/` paths come from each message's own date (`message-cache`), not from `--from/--to`. So no malformed string reaches a path or a query. The state written is valid but for the wrong days (Branch B). A `NaN` `from` never reaches Gmail because `nextUncoveredDay` returns null first.

### Branch C: `ingest --window --complete` writes raw text to the ledger (not in the report)

- **WHY 1C**: `banana..banana` and `2026-13-01..2026-13-02` are committed to `.cache/coverage.json`. [Evidence: reproduction; ledger file content in scratch.]
- **WHY 2C**: `runIngest` does not call `validateInterval`; `ledgerStore.commit` does (`ledger-store.mjs:51-57`) but that is the inversion test only, so `NaN` passes. [Evidence: `harvest.mjs:76`, `ledger-store.mjs:53`.]
- **WHY 3C**: `--window` is a fused `a..b` string parsed by a private helper (`parseWindow`, `harvest.mjs:65-71`) that predates the coverage algebra (`ingest` is the oldest date-bearing command), so it was never routed through the shared check.
- **WHY 4C**: the ledger adapter trusts its caller. Its probe protects against a corrupt file (`ledger-store.mjs:4-7`) but not against a corrupt interval being written.
- **WHY 5C (root cause)**: the ledger, whose whole purpose is "never read as everything covered" (DR-0002), has no write-time well-formedness invariant. The same absent boundary owner as 5A, plus a missing invariant at the store. Effect of a junk row: it never covers a real day (comparisons are false) and `mergeIntervals` keeps it separate (checked: `[2026-01-01..05, banana..banana]` merges to both intervals; `subtractCoverage` still returns the right gap). So it is dead weight now, but any later sort or arithmetic change makes it a silent hazard.

## Ledger check (read-only, counts only)

`.cache/coverage.json`: top level is an array, 2 intervals, both `source: linkedin`, 0 with non-string `from`/`to`, **0 whose `from` or `to` is not a real `YYYY-MM-DD`** (regex plus `Date` round trip). The real ledger is clean; the defect has not yet damaged stored state. Caveat: this says nothing about earlier ledgers on other machines.

## Validation

- Backward chain A: no boundary validation plus a total `Date.UTC` conversion yields rollover and `NaN` "covered". Yes, every reproduced row.
- Backward chain B: repair inside the algebra plus `nextUncoveredDay` emitting normalised days yields clamp-to-yesterday and rolled days written cleanly. Yes.
- Backward chain C: `parseWindow` presence-only plus an inversion-only commit check yields junk rows. Yes.
- Cross-check: A, B and C share one missing owner (5A/5B/5C) and do not contradict. All symptoms in the report, plus the `ingest` hole, are explained.
- Not verified: `fetch` end to end with a bad date (forbidden here); Branch B is proved from the pure functions (`clampToSettledDays`, `nextUncoveredDay`, `gmailWindowQuery`) that `fetch` composes at `harvest.mjs:170-180` and `fetch-loop.mjs:36-44`.

## Existing conventions to follow

- Tests: `tests/regression/job-alert-harvester/unknown-options-refused.test.mjs` runs the real CLI via `spawnSync` with an empty `HOME` (`runCli`), a `Refusal` enum mirroring the codes, `it.each` rows of `[label, args, code, offendingToken]`, and `expectRefusedAndUntouched` (exit 1, stderr has code and token, `fileDigests` unchanged, no `.cache/receipts`). Workspace helpers come from `tests/acceptance/job-alert-harvester/support/domain-types.mjs`.
- Refusals: `src/core/cli-options.mjs:26` `refusal(code, detail)` builds `Error("<code>: <detail>")` with `.code`; `harvest.mjs:511-512` `refusalLine` prints it; exit 1 (`:521`). `docs/reference/refusals.md:126-135` has the `## Command line: cli.*` table; `docs/reference/cli.md:28` currently says "Other formats are unsupported."
- Layering (DR-0013): `src/core/**` imports no `node:` builtin and nothing from adapters or CLI; core-to-core imports are allowed.

## Proposed minimal fix

Refuse anything that is not a real `YYYY-MM-DD` with `cli.invalid-date`, before any read or write. Exit 1 through the existing `catch`.

1. **One pure predicate in `src/core/coverage.mjs`**: `isCalendarDay(text)`: matches `^\d{4}-\d{2}-\d{2}$` and `fromEpochDay(toEpochDay(text)) === text` (round trip rejects `02-30`, month 13, `0000`-style rollovers). Home: `coverage.mjs` already owns `toEpochDay`/`fromEpochDay`, so the definition of "a day" stays next to the arithmetic and is not duplicated in the CLI layer (the second definition in `gmail-query.mjs:8` is weaker; leave it as a backstop, or later reuse the predicate).
2. **`src/core/cli-options.mjs` owns the refusal**: add `INVALID_DATE: 'cli.invalid-date'` to `CliRefusal` and a small table `DATE_OPTIONS = { 'plan-fetch': ['from','to'], fetch: ['from','to'] }` plus `ingest`'s `window` (split on `..`, each half checked). After `parseTokens` succeeds and before returning, refuse the first invalid value: `cli.invalid-date: --from "2026-02-30" is not a real calendar day; write YYYY-MM-DD`. Layering: `cli-options.mjs` imports `isCalendarDay` from `coverage.mjs` (core to core, allowed by DR-0013). Why here and not `coverage.mjs` throwing `cli.*`: `cli.*` names the parser (previous RCA, code-family decision), it already sits before every `run*`, it already has the offending option name for the message, and `refuse()` in `harvest.mjs` would only cover the two `validateInterval` call sites, not `ingest`.
3. **Defence in depth at the ledger** (`ledger-store.mjs` commit, via `validateInterval` calling `isCalendarDay`): refuse with `ledger.interval.invalid-date`, mirroring `ledger.interval.inverted` (`ledger-store.mjs:12-16,53-56`). This closes Branch C for any future caller, not just this parser. Optional for the minimal fix but recommended: it is one guard and one enum entry, and it protects the invariant "the ledger holds only real days".

Label: permanent fix (1 and 2 close the report; 3 is the ledger invariant). Immediate mitigation for the operator: type dates carefully and read the `plan-fetch` output line back (`2026-03-02..2026-03-02` when `2026-02-30` was typed is the tell); do not use `ingest --complete` with a hand-typed window until fixed.

Decision for the human: whether item 3 ships in this fix or as a follow-up (it adds one ledger refusal code and touches an adapter). Decision for the human: whether to also reject years outside a sane range (a valid `0001-01-01` would make `fetch` walk 2,000 years of days; not a validity defect, so not proposed here).

## Files affected

- `src/core/coverage.mjs`: add `isCalendarDay`; `validateInterval` uses it if item 3 ships.
- `src/core/cli-options.mjs`: `CliRefusal.INVALID_DATE`, `DATE_OPTIONS`, the post-parse check.
- `src/cli/harvest.mjs`: none needed for items 1-2 (`parseCommandLine` already runs first in both dispatch branches, `:518,:525`). `parseWindow` becomes redundant for validity but keeps its shape message.
- `src/adapters/ledger-store.mjs`: item 3 only.
- Tests: new `tests/regression/job-alert-harvester/invalid-dates-refused.test.mjs` in the style above; one pure unit test for `isCalendarDay`.
- Docs: `docs/reference/cli.md:28` (dates row), `docs/reference/refusals.md` (`cli.invalid-date` row; `ledger.interval.invalid-date` if item 3), `docs/how-to/fetch-new-mail.md` troubleshooting row.

## Regression tests (RED first: every row exits 0 today)

Rows use `expectRefusedAndUntouched` (exit 1, code, offending token, digests unchanged) with a pre-seeded ledger digest so `ingest --complete` leaves `coverage.json` untouched.

| Command | Expected |
|---|---|
| `plan-fetch --source linkedin --from 2025-012-01 --to 2025-12-02 --batch 1` | `cli.invalid-date`, token `2025-012-01` |
| `plan-fetch ... --from 2026-2-1 --to 2026-02-03` | `cli.invalid-date` |
| `plan-fetch ... --to 2026-02-31`; `--from 2026-02-30`; `--from banana`; `--from 2026-05` | `cli.invalid-date` |
| `plan-fetch ... --from 2026-13-01 --to 2026-13-02` | `cli.invalid-date` (not a 2027 plan) |
| `fetch --from 2026-01-01 --to banana` (empty `HOME`) | `cli.invalid-date`, no `credential` in stderr |
| `ingest --raw <d> --window banana..banana --expect 0 --complete` | `cli.invalid-date`, `coverage.json` absent or unchanged |
| `ingest ... --window 2026-13-01..2026-13-02 --complete`; `--window 2026-01-01` (no `..`) | `cli.invalid-date`; shape error stays as is for the latter if preferred |

Over-refusal guards (must still succeed): `--from 2026-02-28 --to 2026-03-01`, a leap day `2028-02-29`, `--from 2026-01-01 --to 2026-01-01`, the existing inverted-range refusal `coverage.interval.inverted` still reported for real but inverted days. Unit test: `isCalendarDay` property, every date produced by `fromEpochDay` for a range of epoch days is accepted, and a mutation of one digit to an impossible month or day is refused.

## Risk assessment

- **Existing tests refused**: not checked exhaustively. Existing `plan-fetch`/`fetch`/`ingest` tests (`plan-fetch.test.mjs`, `fetch-cli.test.mjs`, `ingest-fail-closed.test.mjs`, `spill-contract.test.mjs`) use well-formed ISO days from what was read, but a grep of every `--from`/`--window` value should be part of the RED step, since any fixture using a short or fake date would now be refused.
- **Documented usage refused**: `cli.md:28` already says other formats are unsupported, so this is enforcement of a documented rule, not a change.
- **Behaviour change on purpose**: `2026-2-1` and `2025-012-01` were accepted (leniently repaired); they are refused. An operator script using short dates breaks loudly.
- **Ledger item 3**: an existing ledger with a junk row is not repaired; the row stays until removed by hand. The real ledger has none (0 of 2).
- **Low risk** overall: refusal happens before any read or write, exit code and format follow the existing pattern, and the new code is one enum entry and one table.

## Not fixed here

- The weaker date guard in `gmail-query.mjs:8-17` (accepts `02-30` via `Date.parse`).
- Year range limits (see decision above).
- Repair of junk ledger rows on other machines.
- `--batch` is unvalidated and echoed only (`harvest.mjs:126,141`); unrelated to dates.
