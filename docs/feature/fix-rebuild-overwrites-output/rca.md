# RCA: the rebuild form silently overwrites an existing `--out` file

Doc type: Explanation.

**Date**: 2026-09-30
**Analyst**: Rex (nw-troubleshooter)
**Scope**: `src/cli/harvest.mjs` (`runRebuild`, `runCreateBuild`), `src/adapters/xlsx-workbook-writer.mjs`, `src/adapters/xlsx-target-sheet.mjs`. Investigation only; no code or test changed.

## Problem Statement

`node src/cli/harvest.mjs --in <dir> --out <file.xlsx>` (the rebuild form) replaces an
existing `--out` file without reading it, warning or failing (exit 0). Anything a
human typed into it is lost. `build --out <file>` refuses in the same situation. The
project promise is that re-running never writes a human-typed column (DR-0004, one
owner per column; DR-0005, target sheet is a plan-executing port).

## Evidence Base

- Reproduced offline in the scratchpad, 2026-09-30: rebuilt `fixtures/linkedin` to
  `o.xlsx`, wrote `"Applied"` into the first data cell of the `Status` column with
  `xlsx`, rebuilt onto the same path. Second run printed `wrote o.xlsx`, exit 0;
  `Status` of row 0 read back as `undefined`.
- `src/cli/harvest.mjs:283-300` (`runRebuild`) read in full. Calls, in order:
  `probeInputDirectory` (l.285), `createMessageReader(input).readAll()` (l.286), empty-input
  refusal (l.287-289), `harvest(messages)` (l.291), `mkdirSync(dirname(output))`
  (l.292), `writeWorkbook(output, model)` (l.293). No `existsSync(output)`, no read of `output`.
- `src/adapters/xlsx-workbook-writer.mjs:12-18`: `writeWorkbook` builds a fresh book and
  calls `XLSX.writeFile(book, outputPath, ...)`. Direct write to the target path. No temp
  file, no rename, no read, no probe.
- The refusal lives in `runCreateBuild`, `src/cli/harvest.mjs:452-455`:
  `harvest build: --out ${options.out} already exists — pass --merge ${options.out} to merge into it`.
  It is a plain `Error` with no `code`; `refusalLine` (l.523-524) prints `error.message` as is.
  `docs/reference/refusals.md:11` confirms "an existing `--out`" has no code.
  `BuildRefusal` (`src/core/sheets-refusals.mjs:56-60`) holds only `TARGET_CONFLICT` and `UNKNOWN_TARGET`.
- `createXlsxTargetSheet` is exported as `createTargetSheet` (`xlsx-target-sheet.mjs`).
  Its `probe` (l.68-74) treats an absent target as valid create-new
  (`if (!existsSync(targetPath)) return`) and refuses only a non-workbook or a `Jobs` tab
  with no `Dedup Key`. So the port's probe does not refuse an existing file; the refusal
  is a CLI check in front of it. The rebuild form never touches the port at all
  (`harvest.mjs:28` imports it; `runRebuild` does not use it).
- History: the rebuild form and `writeWorkbook` arrive in the walking skeleton
  (`7c1e810`, 2026-08-01: `writeWorkbook(output, model)` at l.26, no `existsSync`).
  The refusal arrives with `runCreateBuild` in `8d6642a` (2026-09-17, "write the merge
  plan into the tracker"; `git log -S'already exists'` finds only that commit). The
  rebuild form predates the guard by 47 days and was never revisited.
  `8013971` (2026-09-17) added the empty-input refusal to the rebuild form, touching the
  same function without adding an output guard.

## WHY chain

- **WHY 1**: Human-typed cells vanish after a rebuild onto an existing file, exit 0.
  [Evidence: reproduction above.]
- **WHY 2**: `runRebuild` calls `writeWorkbook`, which unconditionally overwrites the
  path with a workbook built from the cache alone. [Evidence: `harvest.mjs:293`;
  `xlsx-workbook-writer.mjs:17`.]
- **WHY 3**: The rebuild form never asks whether `--out` exists. Neither the CLI branch
  nor the writer checks. [Evidence: no `existsSync(output)` in l.283-300; writer has no
  read.] The `build` guard is inside `runCreateBuild` (l.453), a different function.
- **WHY 4**: The guard was added to the new form only. The DR-0005 work (`8d6642a`)
  introduced the port and `build` and kept `--in/--out` "preserved so the acceptance test
  stays green" (`docs/feature/job-alert-harvester/feature-delta.md:133`), treating the
  old form as frozen. The port's "bounded change universe" is a property of `apply`/`create`
  (`xlsx-target-sheet.mjs:3`); the legacy writer sits outside it.
  [Evidence: feature-delta l.133; import graph above.]
- **WHY 5 (root cause)**: Two write paths to the same kind of file exist, and the
  one-owner-per-column safety property is enforced in only one of them, at the call site
  rather than in the writer both would share. No test states the promise at the level
  of "any command that writes `--out`", so the unguarded path was invisible.
  [Evidence: `writeWorkbook` is called only from `runRebuild`; `runCreateBuild` guards
  before `createTargetSheet(...).create`; tests below assert on the `build` form only.]

Backward check: an unguarded direct write to a path that may hold a human-edited file
must destroy edits, with exit 0 because `writeFile` succeeds. That is the observed symptom.

## Why no test caught it

- `tests/acceptance/job-alert-harvester/walking-skeleton.test.mjs:17-22` builds into a
  fresh `mkdtemp` directory after `rmSync(out, { force: true })`: it never has a
  pre-existing output.
- `whole-cache-derivation.test.mjs:66-88` (`captureResentRow(out)` short-circuits when
  `out` is absent, l.46-48): output absent before the run.
- `reparse-refuses-empty.test.mjs:36-71` does create a pre-existing `--out`, but only to
  show the empty-input refusal leaves it byte-identical. It pins refusal paths, never a
  successful rebuild onto an existing file. Its test at l.57-72 uses a sentinel file and
  an empty `--in`, so it passes either way.
- `build-writes-tracker.test.mjs:120-136` asserts the refusal for `build --out <existing>`
  only. No test names the rebuild form with an existing `--out` as expected behaviour
  or as a defect.
- The docs described the overwrite as a feature ("the repair path"; `cli.md:49`
  "overwritten if it exists and never read"; how-to l.80-82), so the behaviour looked
  intentional and was documented rather than questioned.

## Does anything depend on the overwrite?

Checked every caller of the rebuild form (`grep -e "--in "` over the repo excluding
`node_modules`, `.git`, `.cache`; `package.json` script `harvest` only aliases the CLI).

| Caller | Location | Pre-existing `--out`? | Breaks under refusal? |
|---|---|---|---|
| walking skeleton | `walking-skeleton.test.mjs:22` | No: fresh `mkdtemp`, `rmSync` first | No |
| whole-cache derivation | `whole-cache-derivation.test.mjs:88` | No: fresh workspace, `captureResentRow` shows absent | No |
| month-sharded cache | `reparse-refuses-empty.test.mjs:110` | No: fresh workspace | No |
| empty `--in` refusal | `reparse-refuses-empty.test.mjs:48` | No (absent file) | No |
| empty `--in`, existing sentinel | `reparse-refuses-empty.test.mjs:67` | Yes, expects non-zero and byte-identical | No: still passes; may refuse for a different reason (see Risk) |
| missing `--in` | `reparse-refuses-empty.test.mjs:84` | No | No |
| how-to steps | `docs/how-to/build-the-tracker-workbook.md:26,81` | First-run `first-run.xlsx`, `rebuilt.xlsx`: new paths; l.81-83 already says "Use a path that does not exist" | No, but a rerun of l.26 in the same directory would now refuse |

No test runs the rebuild form twice onto one path, and no documented workflow relies on
overwrite. `docs/feature/*/deliver/*.json` and `feature-delta.md:400` mention the form
historically (demo into a scratch path); they are point-in-time records, not workflows.
Not verified: private operator habits (a shell alias or cron that re-runs the form
onto `job-alerts.xlsx`). None exists in the repo.

## Contributing factors

- **Documented as designed**: README, how-to and `cli.md` presented the overwrite as the
  "repair path", so review saw description matching behaviour.
- **Asymmetric guard**: `build` refuses; the one-word difference between the forms
  (`build` prefix) is easy to miss; the README warning box (l.33) is the only mitigation.
- **No named code**: because the existing refusal is a plain `Error`, no shared
  constant existed to make the rebuild form "use the same refusal".
- **Legacy form frozen**: the walking-skeleton contract was preserved verbatim, and the
  later empty-input fix (`8013971`) touched `runRebuild` without revisiting its output.

## Files affected

- `src/cli/harvest.mjs`, `runRebuild` (l.283-300): add the existence check.
- Tests: one new regression file. No existing test changes.
- Docs: below. `xlsx-workbook-writer.mjs` unchanged.

## Fix options

| Option | Behaviour | Trade-off |
|---|---|---|
| **A** refuse when `--out` exists | `existsSync(output)` before any read or write | Smallest change, same posture as `build`, no new flag. Check-then-write has a tiny race window. |
| B refuse unless `--overwrite` | Adds a flag | Keeps a deliberate regenerate path, but adds a flag whose only use is the destructive act, and a habit-forming `--overwrite` alias reintroduces the loss. Rebuild output is derivable from the cache, so the case for a flag is weak. |
| C temp file, rename only if absent | Write next to target, then `link`/`rename` without clobbering | Closes the race and makes the write atomic, but more code for a form with no legitimate overwrite use; `renameSync` clobbers by default, so it needs `linkSync` or an exclusive `wx` create to actually refuse. |

Operator route to regenerate a file they do want replaced (A): delete it first, or
run the rebuild to a new name. Human-owned columns are not derivable from the cache
(DR-0001, persist what cannot be rederived), so a deliberate delete is the right friction.

## Proposed minimal fix (option A, permanent)

In `runRebuild`, immediately after `probeInputDirectory(input)`, before reading messages
(so nothing is done for a run that will be refused):

```js
if (existsSync(output)) throw new Error(`harvest: --out ${output} already exists — the rebuild form never overwrites; choose a new path, or use build --merge ${output} to update it`);
```

Do not paste the `build` message verbatim: `... pass --merge <out> to merge into it` is
wrong advice for the rebuild form, which has no `--merge` (the operator would need to
switch to `build --out <f> --merge <f>`). Wording above names the correct command.
Refusal code: none exists. The `build` refusal is an uncoded `Error` (`harvest.mjs:454`),
so the rebuild form matches it by staying uncoded, exit 1 via the existing `catch`
(l.546-549). If the human wants a named code, add `BuildRefusal.OUT_EXISTS: 'build.out-exists'`
to `src/core/sheets-refusals.mjs:56` and use it in both forms, plus a `refusals.md` row and a
change to the `build` test (`build-writes-tracker.test.mjs:120-136` matches only `/--merge/`, so it
survives). That is a separate decision; not required for this fix.

Label: permanent fix. Immediate mitigation already exists (README warning box, l.33).

## Risk assessment

- **Existing tests**: none depends on the overwrite (table above). The sentinel test at
  `reparse-refuses-empty.test.mjs:57-72` still passes but now refuses at the existence check
  instead of the empty-input check, so it no longer exercises the empty guard. Its
  first test (absent `--out`, l.36-52) still does, and the new regression makes the
  overlap explicit. Placing the check after the empty-input check keeps that test on its
  original path; the trade is doing the cache read before refusing. Recommend
  check-first (cheaper, no read of a cache that will not be used) and accept the overlap.
- **Race**: `existsSync` then `XLSX.writeFile` is not atomic. Single-operator CLI, so
  accepted; if closed later, use an exclusive-create write (option C variant).
- **Symlinks / directories**: `existsSync` follows symlinks; a dangling symlink at
  `--out` reads as absent and is then written through. Same as `build`; out of scope.
- **Scripts in the wild**: any private script re-running the form onto a stable path
  will now exit 1. Intended, and visible.
- **Reason to reconsider A**: only the wording, above. A is otherwise consistent with
  DR-0005 (never write a file the run did not read) and does not conflict with DR-0004.
  B is worth reviving only if the operator has a routine "regenerate the derived-only
  workbook" job onto a fixed path; none is documented.

## Regression test

Where: `tests/regression/job-alert-harvester/rebuild-refuses-existing-out.test.mjs`
(style of `linkedin-block-anchor.test.mjs`; may reuse `runHarvest`, `aWorkspace`,
`fileDigests` from `tests/acceptance/job-alert-harvester/support/domain-types.mjs` and
`writeTracker`-style helpers, rather than shelling out ad hoc).

Input: a scratch workspace; run the rebuild form over `fixtures/linkedin` to
`<ws>/tracker.xlsx`; with `xlsx` type `"Applied"` into `Status` on the first `Jobs`
row and write the file back; record `sha256` of the file; run the rebuild form again
onto the same path.

Expected (observable): exit status 1; stderr contains `already exists`; stderr names
the path; `sha256` of the file unchanged; the typed `Status` value still reads back.
RED first: today status is 0 and the value is gone.

Optional second `it`: rebuild onto an absent path in an existing directory still exits
0 and writes the three tabs (guards against over-refusing).

## Docs that must change

- `README.md:33`: replace the warning box with one sentence: the rebuild form refuses
  an existing `--out`; regenerate by deleting the file or choosing a new name.
- `docs/how-to/build-the-tracker-workbook.md:80-82`: step 2 becomes "The run refuses
  if `--out` exists; delete the file or use a new path." Note l.26 (`first-run.xlsx`)
  now fails on a second run in the same directory; add "delete `first-run.xlsx` to repeat".
  Line 110 troubleshooting table: add the new refusal row.
- `docs/reference/cli.md:49` (Writes: "overwritten if it exists and never read") ->
  "refused if it exists"; l.53 Stderr: add the new message, exit 1.
- `docs/reference/refusals.md:11`: the uncoded-errors sentence already lists "an existing
  `--out`"; extend to say it applies to both forms. Add a coded row only if the human
  chooses the named code.
- Per the wave-boundary staleness rule, re-check `docs/feature/job-alert-harvester/feature-delta.md:133`
  ("existing `--in/--out` invocation is preserved") for a dated correction, not a rewrite.

## Not fixed here

- Named refusal code for an existing `--out` (uncoded in both forms today).
- Non-atomic write in `writeWorkbook` (a crash mid-write leaves a truncated file); the
  port's `writeAtomically` (`xlsx-target-sheet.mjs:95-122`) would fix it. Separate from the
  overwrite question once refusal is in place.
