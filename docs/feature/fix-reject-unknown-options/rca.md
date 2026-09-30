# RCA: the command-line parser silently drops unknown options and lets a boolean flag swallow a value

Doc type: Explanation.

**Date**: 2026-09-30
**Analyst**: Rex (nw-troubleshooter)
**Scope**: `parseArguments` in `src/cli/harvest.mjs:261-275` and its callers (every subcommand and the rebuild form). Investigation only; no code or test changed. `scripts/` has its own parsers and is out of scope (`scripts/sheets-live-check.mjs:158` already rejects unknown arguments; `gmail-parity-check.mjs:98` reads one positional).

## Problem Statement

`parseArguments` never checks an option name against anything. A mistyped or misplaced option is dropped, so the run proceeds with the default, which for `build` is the real write. The operator's stated aim: a mistyped `--dry-run` must never run for real. Today it does, exit 0, with output that reads as a normal merge.

## Evidence Base

- `src/cli/harvest.mjs:261-275` (`parseArguments`) read in full:
  - l.265: any token not starting with `--` is skipped (positionals and `-n` vanish).
  - l.267-270: a `--x` followed by nothing or by another `--y` becomes a flag.
  - l.271-272: otherwise the next token becomes its value, whatever it is.
  - There is no set of boolean names, no set of legal names, no duplicate check. The result is a bag: `options[name]` and `options.flags`.
- Boolean consumers read by name: `options.flags.has('complete')` (l.78), `'dry-run'` (l.482, l.505), `'target'` bare (l.154). Value consumers read `options.raw|window|expect|source|from|to|batch|out|merge|report|target|in` (l.73-125, l.166-169, l.247, l.403-456, l.499-517).
- Absence is indistinguishable from never typed. `runBuild` (l.500-518): `--dry-run` is the only gate; the fall-through is create or merge.
- Callers: `SUBCOMMANDS.includes(argv[0])` then `parseArguments(argv.slice(1))` (l.535-537); otherwise `parseArguments(argv)` for the rebuild form (l.543), outside any `try`.
- All reproductions below ran offline, 2026-09-30, in `/private/tmp/claude-502/.../scratchpad`, with `HOME` pointed at an empty directory (no operator credential read, no network). Workspace: `.cache/messages/2026-07/1.json` from `aMessage({})` plus a second message `2.json` (job 999) so a real merge visibly changes `t.xlsx` (seeded by `build --out t.xlsx`), and writes `.cache/receipts/*.json`.

## Reproduction

"Real" means `t.xlsx` bytes changed and a receipt was written (`build ... --merge`), or a file was created. Baseline: `build --out t.xlsx --merge t.xlsx --dry-run` (last) leaves `t.xlsx` unchanged, no receipt, exit 0.

### (a) Where the dry run is lost

| Command (after `build`) | Expected | Observed |
|---|---|---|
| `--out t.xlsx --merge t.xlsx --dryrun` | refuse unknown option | REAL merge, exit 0, `t.xlsx` changed, receipt written |
| `--out t.xlsx --merge t.xlsx --dry_run` | refuse | REAL merge |
| `--out t.xlsx --merge t.xlsx -n` | refuse | REAL merge (single-dash token skipped, l.265) |
| `--out t.xlsx --merge t.xlsx --dry-run=true` | refuse (or accept) | REAL merge (`dry-run=true` is an unread flag name) |
| `--out t.xlsx --merge t.xlsx --dry-run t.xlsx` | refuse stray value | REAL merge (`--dry-run` swallows `t.xlsx` into `options['dry-run']`, so `flags.has` is false) |
| `--dry-run t.xlsx --out t.xlsx --merge t.xlsx` | refuse | REAL merge (same swallow) |
| `--out t.xlsx --merge t.xlsx dry-run` | refuse stray word | REAL merge (positional skipped) |
| `--out t.xlsx --merge t.xlsx extra` | refuse | REAL merge |
| `--out t.xlsx --merge --dry-run` | refuse missing value | dry run, but against an EMPTY tracker: plan reads "rows to append: 2", not the real `t.xlsx` diff (`--merge` became a flag) |
| `--out t.xlsx --merge t.xlsx --dry-run` (last) | dry run | dry run (correct) |
| `--dry-run --out t.xlsx --merge t.xlsx`, `--out t.xlsx --dry-run --merge t.xlsx` | dry run | dry run (correct: next token starts `--`) |
| `--out t.xlsx --merge t.xlsx --report --dry-run` | refuse missing value | dry run, no report written (`--report` became a flag, l.388 `if (!options.report)`) |
| `--out t.xlsx --merge t.xlsx --dry-run --report` (no value) | refuse | dry run, no report written, exit 0 |
| `--out t.xlsx --merge t.xlsx --dry-run --dry-run` | refuse duplicate | dry run |

`--target sheets`, empty cache, `HOME` empty. Real and dry take different first paths: dry reaches the credential probe (`sheets.credential-missing`); real stops at the empty-cache refusal (l.484). With a credential and a non-empty cache, the real path would write the Sheet.

| Command | Observed path |
|---|---|
| `build --target sheets --dry-run`, `build --dry-run --target sheets`, `build --target sheets --report --dry-run` | dry path |
| `build --target sheets --dryrun` | REAL path |
| `build --target sheets --dry-run x`, `build --dry-run x --target sheets` | REAL path (`x` swallowed) |
| `build --target=sheets` | `target` never set: offline `build`, which in a non-empty cache dies with raw `ERR_INVALID_ARG_TYPE` (no `--out`); with `--out` it creates a local file instead of writing the Sheet |
| `build --dry-run sheets` | offline build, `target.not-writable` (swallowed `sheets`, no `--target`) |
| `build --dry-run sheets --target` | refused `build.unknown-target: ""` (safe by luck: bare `--target`) |

So the argument-order dependence of `build --target sheets --dry-run` is real, but it is the swallow, not order as such: `--dry-run` is safe only when the next token is absent or starts with `--`.

### (b) Stray positionals and typo'd subcommand

| Command | Observed |
|---|---|
| `--in .cache/messages --out z.xlsx stray` | ignored, workbook written |
| `bild --in .cache/messages --out z.xlsx` (typo of `build`) | not a subcommand, so the rebuild form runs; `bild` ignored; workbook written, exit 0 |
| `--in .cache/messages --out z.xlsx --overwrite` | `--overwrite` ignored, written |
| `--in .cache/messages --ot z.xlsx` (typo) | usage text, exit 2 (safe: required option missing) |
| `--in d --out=z.xlsx` | usage, exit 2 (safe by the same mechanism) |

### (c) Options given twice

| Command | Observed |
|---|---|
| `--in nothing --in .cache/messages --out z.xlsx` | last wins, silently (`options[k] = next`) |
| `--in .cache/messages --out a.xlsx --out b.xlsx` | `b.xlsx` written, `a.xlsx` not, exit 0 |
| `build --out t.xlsx --merge other.xlsx --merge t.xlsx` | last wins, REAL merge into `t.xlsx` |
| `build --out other.xlsx --out t.xlsx --merge t.xlsx --dry-run` | last wins, dry run |

### (d) A value option with no value

| Command | Observed |
|---|---|
| `build --out` | flag; `target.not-writable` (`createTargetSheet(undefined)` path) |
| `build --out --dry-run` | dry run against an empty tracker, exit 0 |
| `build --out --merge t.xlsx` | raw `ERR_INVALID_ARG_TYPE: The "paths[0]" argument must be of type string`, exit 1 |
| `build --merge t.xlsx` (no `--out`) | same raw error |
| `build --out --report r.txt --merge t.xlsx` | same raw error (`--out` a flag, `--report` and `--merge` intact) |
| `--in .cache/messages --out` | usage, exit 2 |

### Other subcommands (same defect, lower stakes)

| Command | Observed |
|---|---|
| `ingest --raw raw --window d..d --expect 1 --complete` | cached, coverage committed |
| `ingest ... --complete x`, `--complet`, `--complete=true` | cached, coverage NOT committed, exit 0, no warning (silent under-commit; the message line just lacks "coverage committed") |
| `plan-fetch --form d --from d --to d --batch 5` | `--form` ignored, plan printed |
| `plan-fetch ... --batch=5` | `batch=unspecified`, exit 0 |
| `fetch --sorce glassdoor ...` | `--sorce` ignored; default source `linkedin` used (reached credential probe) |
| `auth --targt sheets` | `--targt` ignored; Gmail consent flow chosen instead of Sheets (reached `gmail.credential-missing`) |

## WHY chain

- **WHY 1**: A mistyped or misplaced safety option changes behaviour without a word (tables above). [Evidence: reproduction.]
- **WHY 2**: `parseArguments` accepts any token shape and stores whatever it sees under whatever name; consumers then read the names they know. A name nobody reads is never seen by anything. [Evidence: `harvest.mjs:265-272`; consumers l.78, 482, 505.]
- **WHY 3**: The parser cannot tell a boolean from a value option, so it guesses from the next token's shape (l.267). `--dry-run` followed by a non-`--` token is reclassified as a value option. There is no boolean set (`grep` for one: none; `flags` is filled only by that guess). [Evidence: l.267-272; `--dry-run t.xlsx` row.]
- **WHY 4**: The default path is the destructive one. `runBuild` tests only `flags.has('dry-run')` (l.505) and otherwise falls through to merge or create (l.510-517), so a lost `--dry-run` selects the write with no confirmation step. Together with WHY 3 there is no place where "the legal options of this subcommand" is stated: the usage header (l.3-10), `docs/reference/cli.md` and each `run*` function each restate it independently. [Evidence: l.500-518; usage header vs `options.*` reads.]
- **WHY 5 (root cause)**: One generic parser, written for a two-option command, was reused unchanged as six subcommands and a form were added, and no step of any of those additions declared the option set. History: fixed-stride `--in`/`--out` reader in the walking skeleton (`7c1e810`, 2026-08-01, where "ignore what you do not read" was harmless because the form's only reads were those two); rewritten into the flag/value guesser in the DISTILL scaffold (`55c8763`, 2026-09-08) without a boolean list; `--source/--from/--to/--batch/--raw/--window/--expect/--complete` added by reading `options.x` (`6555e96`, 2026-09-13); `--dry-run` added by `flags.has('dry-run')` (`d40f4a8`, 2026-09-17); `--report` (`93d191c`, 2026-09-18); `--target`, `import --from` (`8e685d9`, 2026-09-30). Safety semantics ("this flag must never be lost") were added on top of a parser whose contract was "best effort". [Evidence: `git log -S` results above.]

Backward check: a parser that admits any name and infers boolean-ness from the next token must, for `--dry-run <non-flag>` and for any unread name, produce exactly the observed silent real runs. Yes.

## Why no test caught it

Every existing test places `--dry-run` last or immediately before `--report <path>` (`dry-run.test.mjs:24,48,60`; `stale-upload-warning.test.mjs:177`; `changes-report.test.mjs:135`; `sheets-cli.test.mjs:136`). No test passes an unknown option, a stray positional, a repeated option or a bare value option, and none expects one to be ignored. `docs/reference/cli.md:22-24` documents the behaviour ("Ignored without error", "must therefore be last"), so it looked intended (same pattern as the documented overwrite in `docs/feature/fix-rebuild-overwrites-output/rca.md`).

## Contributing factors

- **Documented as designed**: `cli.md:22-24`.
- **Safe-by-accident cases hide the class**: rebuild-form typos usually hit the exit-2 usage path because the required option goes missing, and bare `--target` is refused as an empty target. The dangerous cases (optional flags, `build`) have no such backstop.
- **Two dispatch modes**: a non-subcommand first token silently selects the rebuild form, so a typo'd subcommand (`bild`) runs a different command.
- **Refusals never guarded the parser**: named refusals exist for values (`build.unknown-target`, `auth.unknown-target`) but not for the option names that carry them.
- **Parse outside `try` in the rebuild branch** (l.543): a parser that starts throwing needs that call moved (see fix).

## Files affected

- `src/cli/harvest.mjs`: `parseArguments` replaced; call sites l.537 and l.543; the bare-`--target` special cases `targetOf` (l.154) and `isGiven` (l.155) simplify.
- New `src/core/cli-options.mjs` (pure, no `node:`): option tables, the parser, the refusal enum.
- `src/core/sheets-refusals.mjs`: unchanged (see code family below).
- Tests: new regression file and one small pure unit test. No existing test changes (see Risk).
- Docs: below.

## Fix options

| Option | Behaviour | Trade-off |
|---|---|---|
| **A** strict per-subcommand tables | Each subcommand (and the rebuild form) declares `{ name: 'flag' \| 'value' }`. Unknown name refused with the valid list; flags never consume a token; value options need a next token not starting `--`; stray positional refused; duplicate refused; single-dash tokens are unknown options. | Closes every row above. Costs one table (7 entries) and a small pure parser. Changes documented behaviour (`cli.md:22-24`). |
| B refuse unknown `--flags` only | Leaves positionals and single-dash tokens. | Still runs for real on `-n`, `dry-run`, `extra`, and needs the boolean set anyway to stop `--dry-run t.xlsx`. Fails the stated aim in three reproduced rows. Reject. |
| C schema/parser library | `node:util.parseArgs` or a package. | New dependency or new semantics to learn: Cognitive Load Tax. Note `node:util` is a builtin and may not be imported in `src/core/` (project rule), and `strict` mode would still need per-subcommand tables. The tables are the work either way. Reject. |

Recommendation: A.

## Proposed minimal fix (option A, permanent)

New pure module `src/core/cli-options.mjs`: `OPTIONS` (tables) and `parseOptions(subcommandOrForm, argv)`. Returns the same shape callers already read (`{ flags: Set, ...values }`), so `run*` functions change only where noted. Throws an `Error` carrying `code`, the same shape `refuse` produces.

Tables (from the usage header `harvest.mjs:3-10`, the `run*` reads, and `cli.md`, verified 2026-09-30):

| Subcommand or form | Value options | Flags |
|---|---|---|
| rebuild form | `in`, `out` | none |
| `plan-fetch` | `source`, `from`, `to`, `batch` | none |
| `ingest` | `raw`, `window`, `expect` | `complete` |
| `build` | `out`, `merge`, `report`, `target` | `dry-run` |
| `fetch` | `source`, `from`, `to` | none |
| `auth` | `target` | none |
| `import` | `from` | none |

Notes on the table:

- One table per subcommand, not per mode. `build --out x --target sheets` must still reach `build.target-conflict` (`sheets-cli.test.mjs:150-160` relies on it).
- Refusal detail names the subcommand, the offending token and the valid options, for example `cli.unknown-option: --dryrun is not an option of build; valid: --out, --merge, --report, --target, --dry-run`. `--name=value` gets the same code; the detail adds "write `--name value`".
- Order of checks per token: unknown name, then duplicate, then value presence (value option needs a next token not starting `--`), then flag never consumes. Any non-option token in option position is `cli.unexpected-argument`.
- `runRebuild` branch (l.543): move `parseOptions` inside the `try`; its `catch` prints `error.message` (l.556), which already leads with the code.
- Parse runs before any `run*`, so nothing is read or written for a refused command.
- Exit code 1 through the existing `catch`; the exit-2 usage path (`harvest.mjs` with no or incomplete `--in/--out`) stays as is. A different exit for usage errors is a separate decision.

Refusal code family. Recommendation: `cli.*`, one enum `CliRefusal` in the new core module:

| Code | Raised for |
|---|---|
| `cli.unknown-option` | unknown name, single-dash token, `--name=value` form |
| `cli.unexpected-argument` | stray positional, including a typo'd subcommand in the rebuild form |
| `cli.duplicate-option` | option given twice |
| `cli.missing-value` | value option with no value |

Why `cli.` over `usage.`: existing namespaces name the refusing component (`auth`, `build`, `fetch`, `import`, `ledger`, `spill`); `cli` names the parser. `usage` already means the uncoded `usage:` text and exit 2 in the rebuild form, so `usage.unknown-option` would sit beside an unrelated exit-2 path. Collision check: `grep` for `'cli.`, `'usage.`, `unknown-option` across `src`, `tests`, `docs`, `scripts` found none. Existing namespaces enumerated from `src`: auth, build, cache, coverage, drive, fetch, gmail, import, ledger, sheets, slim, spill, target.

Decision for the human (bare `--target`): today a bare `--target` is refused as `build.unknown-target: ""` / `auth.unknown-target` (`harvest.mjs:154`, `cli.md:132,147`, `refusals.md:42,124`; no test covers it). Under A it becomes `cli.missing-value`. Recommend accepting that (deletes `targetOf`'s flag special case) and updating the three doc rows; the alternative is a third option kind that keeps the old code, which adds a mechanism for one untested case.

Label: permanent fix. Immediate mitigation for the operator now: put `--dry-run` last and check the first stdout line reads `harvest build --dry-run: plan`; a `harvest build: merged` line means it was real.

## Risk assessment

Every existing invocation checked against the tables. Test call sites: `grep runHarvest` in `tests/`, plus multi-line calls read, plus `runHarvestWith` and `runHarvestAsync` callers, `execFileSync` in the walking skeleton, the skill and the how-tos.

- **Tests that would be refused: none.** Option tokens used, by subcommand:
  - rebuild `--in`, `--out`: `walking-skeleton.test.mjs:22`, `reparse-refuses-empty.test.mjs:48,67,84,110`, `whole-cache-derivation.test.mjs:88`, `rebuild-refuses-existing-out.test.mjs:38,42,59,69,73`.
  - `build --out [--merge] [--dry-run] [--report <p>]`: `build-writes-tracker.test.mjs:107-315`, `changes-report.test.mjs:77-162`, `stale-upload-warning.test.mjs:64-177`, `dry-run.test.mjs:24,48,60`, `rebuild-refuses-existing-out.test.mjs:92`, `sheets-cli.test.mjs:290`.
  - `build --target sheets` plus `--report <p>` or `--dry-run` (`sheets-cli.test.mjs:65,102,136,379`), `--out <p>` / `--merge <p>` for the conflict case (`:152`), `--target drive` (`:166`, must still yield `build.unknown-target`, and does: `--target` takes a value).
  - `ingest --raw --window --expect [--complete]`: `ingest-fail-closed.test.mjs:41-176`, `spill-contract.test.mjs:44-112`.
  - `plan-fetch --source --from --to --batch`: `plan-fetch.test.mjs:43-157`.
  - `fetch --source --from --to` (`fetch-cli.test.mjs:43,117`); `auth`, `auth --target sheets|drive` (`fetch-cli.test.mjs:69`, `sheets-cli.test.mjs:69,455`); `import --from` (`sheets-cli.test.mjs:65`).
  - No test passes a stray positional, repeats an option, or omits a value.
- **Documented usage that would be refused: none.** All command lines in `README.md:28-33`, `docs/how-to/build-the-tracker-workbook.md:26,47,61,69,81`, `fetch-new-mail.md:28,50,51`, `use-a-google-sheet-as-the-tracker.md:19,25,35,41`, `set-up-google-cloud.md:57,69` and `.claude/skills/harvest/SKILL.md:21,52` use only table options with values. `harvest-skill.test.mjs` asserts on the skill text, not on parsing.
- **Behaviour changes on purpose**: `--name=value` (already unsupported per `cli.md:21`), single-dash tokens, and bare `--target` (decision above).
- **Not verified**: private operator scripts or aliases (for example one that appends a stray token or `--flag=value`). Their failure becomes loud and immediate, which is the intent.
- **Table drift**: a new option added to a `run*` function but not the table is now refused at once. That is the failure mode wanted, and the regression test for "every table option is accepted" keeps the table honest against `cli.md`.
- **Reasons to reconsider A**: (1) it changes a documented rule (`cli.md:22-24`), so the docs change is part of the fix, not an afterthought; (2) bare `--target` code changes; (3) it adds a second place (the table) to keep in step with the usage header, unless the header is generated or checked from it (not proposed here); (4) exit code stays 1, not the conventional 2 for usage errors. None defeats the aim. B is the only cheaper option and it fails three reproduced cases.

## Regression tests

Where: `tests/regression/job-alert-harvester/cli-rejects-unknown-options.test.mjs`, in the style of `rebuild-refuses-existing-out.test.mjs` (`aWorkspace`, `writeJson`, `aMessage`, `fileDigests`, `runHarvest` with `cwd`; each test in its own workspace). Fixture: `.cache/messages/2026-07/1.json` from `aMessage({})`, then `build --out t.xlsx`, then a second message so a real merge would change `t.xlsx`. Common assertions for every refused case: exit 1, stderr contains the code and the offending token, `t.xlsx` digest unchanged, `.cache/receipts` absent, no new files. RED first: today every case exits 0 and writes.

| Input (after `build --out t.xlsx --merge t.xlsx` unless stated) | Expected |
|---|---|
| `--dryrun`, `--dry_run`, `-n`, `--dry-run=true` | `cli.unknown-option`, stderr lists `--dry-run` among valid options |
| `--dry-run t.xlsx` | `cli.unexpected-argument` |
| `extra` | `cli.unexpected-argument` |
| `--dry-run --dry-run`, `--merge x --merge t.xlsx` | `cli.duplicate-option` |
| `--report --dry-run`; `build --out --dry-run`; `build --out` | `cli.missing-value` |
| rebuild: `bild --in <cache> --out z.xlsx` | `cli.unexpected-argument`; `z.xlsx` not created |
| rebuild: `--in <cache> --out z.xlsx --overwrite`, `--out=z.xlsx` | `cli.unknown-option`; not created |
| rebuild: `--in <cache> --out a.xlsx --out b.xlsx` | `cli.duplicate-option`; neither created |
| `ingest --raw <d> --window w --expect 1 --complet` | `cli.unknown-option`; cache and `coverage.json` untouched |
| `plan-fetch --form d --from d --to d`; `fetch --sorce x --from d --to d` (empty `HOME`); `auth --targt sheets` | `cli.unknown-option`, before any credential read (stderr has no `credential-`) |
| `build --target sheets --dryrun` and `build --dry-run x --target sheets` in an empty-cache workspace, empty `HOME` | `cli.unknown-option` / `cli.unexpected-argument`, not the empty-cache error or `sheets.credential-missing` |
| `build --target=sheets` | `cli.unknown-option` |
| `build --target` | `cli.missing-value` (if the bare-`--target` decision stands) |

Over-refusal guards (must still succeed, exit 0, dry runs change nothing): `--dry-run` last, first, middle; `--dry-run --report r.txt`; `--report r.txt --dry-run`; `ingest ... --complete` last and mid-line; `build --out t.xlsx --target sheets` still `build.target-conflict`; `build --target drive` still `build.unknown-target`.

One pure unit test beside it (or under `tests/acceptance/`, no I/O): every option in every table appears in `docs/reference/cli.md`'s synopsis line for that subcommand, so the table and the reference cannot drift.

## Docs that must change

- `docs/reference/cli.md:21-24`: replace the four parsing rows: syntax `--name value` or `--name` per the subcommand's table; flags never take a value; unknown option, stray positional, repeated option, missing value each refused with a `cli.*` code, exit 1, before any read or write. Remove "must therefore be last".
- `docs/reference/cli.md:33-34,53`: exit-code table and rebuild `Stderr` row note the `cli.*` refusals (exit 1); usage exit 2 unchanged.
- `docs/reference/cli.md:132,147`: bare `--target` row, if the decision above stands.
- `docs/reference/refusals.md:5`: add the new source file to the list; new section `## Command line: cli.*` with the four codes, meaning, usual cause, what to do; `:42,:124`: "or has no value" if the decision stands; `:11` add that argument errors are now coded.
- `docs/how-to/build-the-tracker-workbook.md:~103`: one troubleshooting row for `cli.unknown-option` (check spelling, `--dry-run` not `--dryrun`).
- `README.md`: no statement about unknown options exists (checked); no change required. Optionally one sentence beside the existing note at `README.md:33`.
- Per the wave-boundary staleness rule: `docs/feature/job-alert-harvester/feature-delta.md` line stating the CLI ignores unknown options, if any, gets a dated correction, not a rewrite (not located in this pass).

## Not fixed here

- A dry-run-by-default or `--yes` confirm for real merges: the human's aim is met by refusing lost options; changing the default is a behaviour decision.
- `runBuild` still lets a missing `--out` on the merge path surface as a raw `ERR_INVALID_ARG_TYPE` when `--out` is omitted but `--merge` is given; strict parsing turns the bare-option variants into `cli.missing-value` but not the fully omitted case (`build --merge t.xlsx`). A named required-option refusal is separate.
- Exit code 2 for usage errors.
- `scripts/` parsers.
