# install-subcommand — Evolution Record

**Type**: Explanation. **Finalized**: 2026-10-06. **Workspace**: `docs/feature/install-subcommand/` (kept as delivery history; `deliver/roadmap.json` and `deliver/execution-log.json` sit in it).

Assumed background: `harvest update` fetches LinkedIn alert mail and rebuilds the tracker in one command and fails closed (DR-0016, update owns the sequence). Before this feature the operator wrote a macOS launchd LaunchAgent plist and a shell wrapper by hand from a how-to, and ran `launchctl` themselves.

## What shipped

`harvest install [--at HH:MM] [--dry-run] [--load] [--force] [--allow-any-branch]`, `harvest uninstall [--dry-run] [--force]` and `harvest status` manage the scheduled `update` job on macOS.

- **install**: writes a wrapper script at `<checkout>/.cache/launchd/update.sh` and a LaunchAgent plist (label `local.job-alert-harvester.update`) for the checkout it runs from. It never calls `launchctl` unless `--load` is given. It refuses off `main` unless `--allow-any-branch`. It replaces its own plist and refuses a hand-made one without `--force`.
- **Wrapper**: runs `update`, exits with the failing command's status and shows one macOS notification carrying the last stderr line as an `osascript` argument, placed after `--`.
- **uninstall**: boots the job out, then removes the plist and the generated wrapper.
- **status**: read-only. It reports installed, schedule, drift, node, wrapper, loaded, state, runs, last exit code and pid, and exits 0 whenever it can report.
- **Pure core**: `src/core/launch-agent.mjs`, `install-plan.mjs`, `install-refusal.mjs` and `launchd-print.mjs`.
- **Shell**: `src/cli/install.mjs`.
- **Adapters**: `src/adapters/launchctl.mjs` (closed over one label), `git-checkout.mjs` (read-only) and `launch-agent-files.mjs` (reader and writer, with a probe).
- **Enforcement**: a dependency-cruiser rule confines `child_process` to the two spawning adapters.
- **Docs**: `docs/reference/cli.md`, `docs/reference/refusals.md` (the ten `install.*` refusals), the how-to `docs/how-to/run-update-on-a-schedule.md` rewritten as the install flow, DR-0018, brief section 17 and the README.

Full suite at close: 92 files, 1,584 tests passed, 0 skipped (81 files and 1,307 tests on main before the feature; the 277 added are 246 acceptance scenarios and 31 infrastructure tests, and `npx vitest list` gives 1,584). `npm run check:arch`: no violations across 62 modules. 21/21 steps traced by `des-verify-integrity` ("All 21 steps have complete DES traces"). The branch changes 42 files against main.

## Decisions and where they live

- DR-0018 (install generates the scheduler files), status **`accepted`**, 2026-10-06: `docs/decisions/DR-0018-install-subcommand-generates-the-scheduler-files.md`. It reverses in part DR-0016's "no harvester code" for logging and notification, and the brief's statement that nothing darwin-specific enters `src/`.
- The 14 DESIGN open questions were ratified as recommended on 2026-10-06, with `uninstall` also removing the wrapper. The 14 DISTILL pinned decisions were ratified the same day. Both lists are in `feature-delta.md`.
- One ruling after DISTILL: when `--load` fails after the files are written, the plan stays on stdout and the failure goes to stderr.
- Two existing tests were edited by approval: `tests/regression/job-alert-harvester/unknown-options-refused.test.mjs:275` (the exact option-table list gained `install`, `status` and `uninstall`) and `tests/architecture/layering.test.mjs` (a fixture for the `child_process` rule). Nothing else existing was edited.
- Product-level summary: `docs/product/architecture/brief.md` section 17.

## Process facts worth keeping

- The human ran the manual slice 0 on a real Mac during DISTILL, not before, by their choice. It fed back real evidence: a real `launchctl print` sample (sanitised into the one fixture), exit 113 for a job that is not loaded, a silent `bootstrap`, a mixed-case label accepted, appended logs, and plist placeholders such as `<label>` breaking `plutil -lint` when hand-edited. A missing node showed as runs incremented and a last exit code of 127. A notification launchd did deliver was hidden in Notification Centre, so the how-to recommends the Persistent alert style.
- The orchestrator verified on the real machine that `osascript` consumes `--`, and that without it a leading-dash message is read as an option ("no such component"). The fake `osascript` did not emulate this: deleting `--` from the wrapper turned no scenario red until step 04-02 made the shim faithful, after which the leading-dash scenario fails.
- A mutation of the wrapper's exit status turned 21 of 26 wrapper scenarios red.
- Many scenarios passed the moment they were enabled, because earlier steps had delivered the behaviour. Steps 03-03, 04-01, 04-02 and 07-02 made no production change. A mutation of an earlier step's gate showed these passes are not vacuous.
- The crafter of steps 03-05 and 02-02 worked round an import cycle (`launch-agent` imported `InstallRefusal` from `install-plan`) by rendering texts in the shell. The refactor pass moved `InstallRefusal` to its own module, so the pure planner renders its own paths and texts.
- The refactor pass also dropped the stale `next:` line from `--load` runs and an unused writer from the preview path.
- Host load was very high (load average often above 100, with antivirus, iCloud and Finder busy). A couple of full runs exited 1 on vitest worker timeouts in two older tests, a Sheets import scenario and an update support-builders test. Every test passed when rerun alone, and the final run exited 0.
- The adversarial reviewer (Haiku) approved with no blockers. The orchestrator verified its claims independently: only the two approved test edits changed, `update.mjs` and `update-plan.mjs` are unchanged, and a rename over a symlinked plist replaces the link and leaves the target.
- The roadmap declared 22 steps but held 21. It was corrected at source after `des-roadmap` flagged it.
- Mutation testing skipped per the project's `nightly-delta` strategy.

## Real-use evidence

The manual how-to flow (slice 0) ran on the operator's real Mac with a scratch label: `bootstrap`, `kickstart`, a successful scheduled-style run, a deliberately failed run (exit 127) with a delivered failure notification, then `bootout`. The `install`, `uninstall` and `status` commands themselves have not been run on a real machine. No real `launchctl` was invoked by any test or agent, and acceptance used fakes only. No figure here comes from a real run of those commands.

## Not done

- **Persistent-alert reminder as installer output.** Unratified. It is only recommended in the how-to.
- **Protected folders.** Desktop and Downloads are not warned about, only Documents.
- **Unborn `main`.** A git checkout whose `main` has no commit is refused as "not a git checkout", which is a misleading message.
- **Unspecified cases.** `uninstall` from another checkout, and whether `.cache/launchd/` is left behind.
- **Unconfirmed on real macOS.** `bootstrap` of an already-loaded label (install boots out first), the text of the running `state` and the `pid` line (status tolerates unknowns).
- **Log rotation.** Log files grow without limit.
- **CI**: unchanged project-level open item.
- **Mutation testing** was skipped, as above.
