---
id: DR-0018
status: accepted
dateCreated: 2026-10-06
domain: job-alert-harvester
relatedTo: [DR-0012, DR-0013, DR-0016]
changelog:
  - date: 2026-10-06
    version: 1.0.0
    note: Accepted by the human together with the fourteen DESIGN open questions of install-subcommand, taken as recommended, on 2026-10-06. A manual run of the hand-written job on macOS (slice 0), made during DISTILL, then confirmed the launchd facts this record relies on
---

# `harvest install`, `uninstall` and `status` generate and manage the scheduler files

## Context

The harvester keeps a local cache of LinkedIn job-alert mail and brings a Google Sheet up to date with `harvest update`. To run `update` every morning on macOS, the operator needs two files: a LaunchAgent plist that tells launchd when to start the job, and a short shell wrapper that runs `update`, keeps its stderr and shows a notification when the run fails. `harvest update` owns the sequence of fetch then build and fails closed (DR-0016, update owns the sequence).

DR-0016 left both files to the operator. Its decisions on logging and notification said "no harvester code", and a how-to listed the plist and the wrapper to copy by hand. The architecture brief said nothing darwin-specific enters `src/`. Three values in those files are easy to get wrong by hand: the absolute path of `node`, the checkout directory the job must run in (the ledger and cache resolve against the working directory), and the escaping of paths in both files. A wrong value fails quietly at 05:30 and shows up as a missed run.

The operator wants one command that writes the files for the checkout in front of them, and commands to remove the job and to see whether it is healthy. That means harvester code that knows launchd file formats and calls `launchctl` and `git`. `src/core` must stay pure and free of `node:` builtins (DR-0013, layering enforced by dependency-cruiser), so the file text and the decisions are pure and the spawning is confined to adapters.

## Options Considered

### Option A: Generate the files for the checkout the command runs from (chosen, ratified 2026-10-06)

- **What:** `install` renders the plist and the wrapper from `src/core` for the current checkout and writes them. `uninstall` removes them. `status` reports on them.
- **Advantage:** the three error-prone values are generated and tested. The files are not copied from a document that can drift from the code. One checkout, one job, no second copy of the code to keep current.
- **Disadvantage:** the job runs whatever the checkout holds when it fires, so switching the checkout to a feature branch changes what runs at 05:30. A guard and a warning mitigate this. They do not remove it.

### Option B: A pinned, dedicated clone

- **What:** `install` clones the repository to a fixed location and schedules that copy, so the operator's working checkout never affects the job.
- **Advantage:** removes the branch-switch risk.
- **Disadvantage:** a second copy of the code that must be updated on purpose, a second place for `.cache/`, the ledger and credentials to resolve, and a clone and update procedure to build and test. Rejected for now.

### Option C: A bundled app

- **What:** package the job as a macOS application that carries its own node.
- **Advantage:** no dependence on the operator's node path.
- **Disadvantage:** a build and signing pipeline for a one-operator tool, and a second artefact to version. Rejected.

### Option D: Keep the how-to only

- **What:** keep the hand-written plist and wrapper in the how-to and add nothing to the CLI.
- **Advantage:** no new code and no reversal of DR-0016.
- **Disadvantage:** the how-to stays untested text, and the three error-prone values stay manual. Rejected.

## Decision

**`install`, `uninstall` and `status` generate and manage the launchd files and the wrapper from `src/core`, for the checkout they run from (Option A).** This reverses, in part, DR-0016's decisions on logging and notification ("no harvester code") and the brief's statement that nothing darwin-specific enters `src/`. `update` itself still has no scheduler or notification code.

1. **Label.** The label is the constant `local.job-alert-harvester.update`. A second checkout meets `install.other-checkout`, which `--force` overrides.
2. **Files by default.** `install` writes the wrapper and the plist and calls no `launchctl`. `--load` is the only way `install` calls `launchctl`.
3. **Preview.** `--dry-run` prints the plan and the text of both files and writes and calls nothing.
4. **Time.** `--at HH:MM` sets the daily time. The default is 05:30, the quiet hour chosen against the Sheets write window (DR-0012, Sheets write window risk).
5. **Branch guard.** `install` refuses a checkout that is not on `main` unless `--allow-any-branch` is given. The job runs whatever the checkout holds when it fires, and `install` prints that.
6. **Replacement.** `install` replaces a plist it generated, which it recognises by a marker comment. It refuses a hand-made plist without `--force`.
7. **Removal.** `uninstall` boots the job out if it is loaded, then removes the plist and the generated wrapper. It leaves the logs, the ledger and the credentials.
8. **Status.** `status` is read-only. It exits 0 whenever it can print a report, including for a job that is not installed or not loaded.
9. **Exit codes.** `install`, `uninstall` and `status` exit 0 or 1 only, as `update` does.
10. **Notification text.** The wrapper passes the failure text to `osascript` as an argument after `--`, to an `on run` handler, so the text is never parsed as script.
11. **Process spawning.** `child_process` is imported only by the `launchctl` and `git-checkout` adapters. A dependency-cruiser rule enforces this and a fixture in the layering test proves the rule reports when broken.
12. **Persistent alerts.** The how-to recommends setting Script Editor's alert style to Persistent. The installer does not change the setting.

## Exceptions

Revisit if:

- **A missed notification costs a morning's run.** The how-to's recommendation to set Script Editor's alert style to Persistent could become installer output. The human has not ratified that option.
- **The branch-switch risk bites.** A job that ran a feature branch would justify a pinned dedicated clone (Option B).
- **The job fails on a protected folder.** `install` warns for a checkout under `Documents`. A checkout under `Desktop` or `Downloads` may be unreadable to a launchd job in the same way, and a warning for those folders is not yet written.
- **A checkout whose `main` has no commit is installed from.** The message for an unborn `main` is not specified.
- **A scheduled job needs a state check beyond `status`.** A persistent check that records and compares runs over time is not built.
