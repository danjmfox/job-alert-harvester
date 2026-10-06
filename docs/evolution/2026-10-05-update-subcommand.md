# update-subcommand — Evolution Record

**Type**: Explanation. **Finalized**: 2026-10-05. **Workspace**: `docs/feature/update-subcommand/` (kept as delivery history; `deliver/roadmap.json` and `deliver/execution-log.json` sit in it).

Assumed background: `fetch` copies LinkedIn alert mail from Gmail into a local cache and records the covered UTC days in a coverage ledger. `build --target sheets` derives the tracker from the whole cache and writes it to the operator's Google Sheet (DR-0009, build derives from the whole cache). Before this feature the operator ran the two commands by hand and worked out the start day.

## What shipped

`harvest update [--from <d>] [--dry-run]` runs plan, fetch, decide, build and summarise as one command, so a person and a scheduler run the same thing. It fails closed: the build runs only after a successful fetch. After a good fetch it always builds, even when nothing new arrived, so a build that failed on an earlier run heals on the next. It exits 0 or 1 and nothing else.

- **Refusals**: `update.stage-failed` (the message names the stage `lock`, `plan`, `fetch` or `build`, plus the inner code), `update.no-baseline` and `update.already-running`.
- **Run lock**: `src/adapters/run-lock.mjs` (imports `node:fs` only) holds `.cache/update.lock` with the holder's process id.
- **Preview**: `--dry-run` holds no fetch capability, takes no lock and writes nothing.
- **Pure core**: `src/core/update-plan.mjs` holds `planUpdateRange`, `previewUpdateRange`, `decideAfterFetch`, `newsAboutFetch`, `summariseUpdate` and `dryRunLine`.
- **Shell**: `src/cli/update.mjs` receives the fetch and build stages as injected functions, because `harvest.mjs` dispatches at top level and cannot be imported.
- **Existing code touched**: `runFetch` now returns `{ windowsCommitted }`, and the option table gained `update: { from, dry-run }`.
- **Test support**: a composed loopback origin (`tests/acceptance/sheets-api-target/support/google-front.mjs`) lets one subprocess reach both the Gmail and Sheets fakes.
- **Docs**: `docs/reference/cli.md`, `docs/reference/refusals.md`, a new how-to `docs/how-to/run-update-on-a-schedule.md` (a launchd LaunchAgent and a wrapper that calls `osascript`), brief section 16, the README and two how-to pointers.

Full suite at close: 81 files, 1,307 tests passed, 0 skipped (73 files and 1,169 tests on main before the feature; the 138 added are 108 acceptance scenarios, 8 preview scenarios and 22 builder tests, and `npx vitest list` gives 1,307). `npm run check:arch`: no violations across 52 modules. 10/10 steps traced by `des-verify-integrity` ("All 10 steps have complete DES traces"). The branch changes 31 files against main.

## Decisions and where they live

- DR-0016 (`harvest update` owns the fetch-then-build sequence and fails closed), status **`accepted`**, version 1.2.0 on 2026-10-05: `docs/decisions/DR-0016-update-subcommand-owns-the-fetch-then-build-sequence.md`.
- The eleven DESIGN questions (Q-a to Q-k) were ratified as recommended on 2026-10-05, and so were the 15 DISTILL pinned decisions the same day. Both lists are in `feature-delta.md`.
- Four rulings on cases DESIGN left open (version 1.1.0): an override rescues an empty ledger; a preview ignores the lock; an unreadable lock, ledger or `.cache/` is a stage failure; and the nothing-new line stays before a failing build. The last of these reversed an earlier ruling the same day, because the line precedes the build's output (pinned decision 4).
- The stage word for an unreadable ledger is `fetch` for a real run and `plan` for a preview. The human chose this after the adversarial review (version 1.2.0).
- The stale-lock race is accepted and recorded in the Exceptions of DR-0016.
- One existing test was edited by approval: `tests/regression/job-alert-harvester/unknown-options-refused.test.mjs:275` gained `'update'` in the expected option-table list.
- Product-level summary: `docs/product/architecture/brief.md` section 16.

## Process facts worth keeping

- The architect's DESIGN claims and each reviewer's claims were checked against the code by the orchestrator. The DISTILL reviewer pair approved.
- The roadmap needed a step added after the rulings, 05-02, so it holds 10 steps, not 9.
- Many scenarios passed the moment they were enabled, because earlier steps had delivered the behaviour. Steps 03-01, 03-02 and 04-01 made no production change. A mutation of the fail-closed gate turned the five fetch-failure scenarios red, so they are not empty passes.
- Several crafters wrote code before observing RED in some slices (01-01 and 04-02) and said so.
- One crafter staged the execution log by hand once.
- The nothing-new line's position forced `update.mjs` to call `summariseUpdate` twice, until the refactor pass added `newsAboutFetch`.
- The adversarial reviewer (Haiku) returned "rejected". It raised one real defect: a preview on an unreadable ledger printed a raw refusal, fixed after the human chose the `plan` stage word. It made one false claim: it said no test pins that a preview ignores a held lock, but `update-rulings.test.mjs` does. It gave one unsupported probability figure for the lock race. It could not read the how-to.
- A DES hook once rejected a dispatch that lacked an outcome-recording section.
- The git-guard hook once blocked a commit on the feature branch, and the commit was made with `git -C <dir>`.
- The DISTILL addendum could not build a scenario where the fetch stage throws a plain `Error`, because every fetch fault carries a code. That case is pinned at the build stage only.
- Mutation testing skipped per the project's `nightly-delta` strategy.

## Real-use evidence

None. No real Gmail or Sheets run was made: the credentials are the operator's, and acceptance used loopback fakes only. No figure here comes from a real mailbox or Sheet.

## Not done

- **The schedule was never run.** The wrapper script, the launchd plist and the `launchctl` steps in the how-to were not executed. That `kickstart -k` leaves a stale lock claim is reasoning, not an observed run.
- **Lock limits accepted.** A stale-lock takeover race, an empty lock file read mid-write as `lock.unreadable`, and a recycled process id are known. DR-0016 (update owns the sequence) names the fix for the first two: an atomic-rename takeover that writes the pid before the lock becomes visible. No fix is planned for the third.
- **Deferred options.** There are no per-stage exit codes, no harvester-owned log file and no `--notify` flag. Each is a revisit trigger in the Exceptions of DR-0016.
- **First run on a mailbox with no alert from the sender** stops with `gmail.sender-matches-nothing`, reported as `update.stage-failed` at the `fetch` stage.
- **Mutation testing** was skipped, as above.
- **CI**: unchanged project-level open item.
