# Run update on a schedule

Doc type: How-To

Goal: make a macOS launchd job run `harvest update` every morning, write its output to log files, and show a notification when a run fails, using `harvest install`.

`install` generates the LaunchAgent and the wrapper script for the checkout you run it from. What those files contain is in the [CLI reference](../reference/cli.md#what-the-generated-files-contain), and the options of `install`, `uninstall` and `status` are in the same reference.

## Before you start

- You are on macOS, in the repository root, with the checkout on `main`. The job runs whatever the checkout holds when it fires, so `install` refuses any other branch unless you pass `--allow-any-branch`.
- `auth` and `auth --target sheets` have succeeded, and `import` has recorded your Sheet: [Use a Google Sheet as the tracker](use-a-google-sheet-as-the-tracker.md).
- The ledger holds at least one fetched day. If it does not, run `node src/cli/harvest.mjs fetch --source linkedin --from <first-day> --to <last-ended-day>` once: [Fetch new mail](fetch-new-mail.md).
- A run by hand has worked. `node src/cli/harvest.mjs update --dry-run` prints the range it would fetch and the build preview, and `node src/cli/harvest.mjs update` runs it for real.
- `node` is on your `PATH` at a path that stays the same across upgrades.

> **Why a stable node path.** The wrapper pins the absolute path of `node`, because launchd runs with a minimal `PATH`. Under a version manager such as mise or nvm that path can hold a version number and stop existing when node is upgraded. `install` warns when the path holds a version number.

## Install the job

1. Preview what `install` would write:

   ```bash
   node src/cli/harvest.mjs install --dry-run
   ```

   The preview prints the checkout, the commit and branch, one `create`, `replace` or `unchanged` line per file, and the full text of the wrapper and the LaunchAgent. It writes nothing and calls no `launchctl`.

2. Write the files and load the job into your login session:

   ```bash
   node src/cli/harvest.mjs install --load
   ```

   `install` ends with the line `harvest install: loaded gui/<uid>/local.job-alert-harvester.update`. Without `--load`, it writes the files and prints the `launchctl bootstrap` command to run yourself.

   > **Why `--load` is optional.** `--load` is the only way `install` calls `launchctl`. `launchctl bootstrap` prints nothing when it succeeds, so `install` reads the job back and prints the line above as its confirmation.

3. Check the job:

   ```bash
   node src/cli/harvest.mjs status
   ```

   A healthy job reports `installed: yes`, `drift: none`, `node: ok`, `wrapper: ok` and `loaded: yes`.

4. Run it once now as a smoke test:

   ```bash
   launchctl kickstart -k gui/$(id -u)/local.job-alert-harvester.update
   ```

5. Read the logs after it finishes:

   ```bash
   tail -n 20 .cache/logs/update.out.log .cache/logs/update.err.log
   ```

   A good run ends the output log with `harvest update: complete, fetched <n> day(s), built the Sheet`. A run with no new mail also prints `harvest update: nothing new from Gmail` before it. A failed run ends the error log with an `update.stage-failed` line, and the notification shows the same line.

6. Run `status` again. After a good run, `last exit code` is `0` and `last output line` is the completion line.

> **Why 05:30.** A Sheets build writes to your Sheet, and a sort, insert or delete you make during that write can send a harvester-written column to the wrong row. 05:30 is a quiet time away from the hours you work in the Sheet. See DR-0012 (Sheets write window risk).

## Choose another time

1. Run `install` again with `--at` and `--load`:

   ```bash
   node src/cli/harvest.mjs install --at 06:45 --load
   ```

   `install` replaces its own plist, boots the loaded job out, and bootstraps the new one. `status` judges drift against the plist's own schedule, so a time other than 05:30 is not drift.

## Pick up a moved node

1. Run `install --load` again after node is upgraded or moved. It writes the new node path into the wrapper and reloads the job.

## Make failure notifications persistent

1. Open System Settings, Notifications, and select Script Editor.
2. Set its alert style to Persistent.

> **Why.** The wrapper posts the failure notification through `osascript`, which macOS attributes to Script Editor. A banner disappears after a few seconds and can end up in Notification Centre unseen. A persistent alert stays until you dismiss it. This is a setting on your Mac. `install` does not change it.

## Remove the job

1. Run:

   ```bash
   node src/cli/harvest.mjs uninstall
   ```

   `uninstall` boots the job out if it is loaded, then removes the plist and the generated wrapper. It leaves the logs, the ledger and the credentials. Add `--dry-run` to preview.

2. Delete the files under `.cache/logs/` when you no longer want them.

## Why

**Overlapping runs.** `update` takes `.cache/update.lock` for the whole run. A second run that starts while the first is alive stops with `update.already-running`. A run that was killed leaves a lock whose process is dead, and the next run replaces it. `kickstart -k` kills a running job first, so it can leave such a lock.

**Fail closed.** A failed fetch stops the run before the build, so the Sheet is never built from a cache known to have a gap. Days the fetch already committed stay committed, and the next run resumes. See DR-0016 (update owns the sequence).

**Logs grow.** launchd appends to both log files and never rotates them. Trim or delete them when they get large.

**Label case.** launchd accepted a mixed-case label when this was first run by hand. `install` always writes the constant label `local.job-alert-harvester.update`.

**A failed run is visible in `status`.** `launchctl print` reports `runs` and `last exit code`, and `status` shows both. A wrapper that cannot find node exits 127, so `last exit code: 127` means the node path is gone.

## If it goes wrong

| You see | Do this |
|---|---|
| `install` warns `update.no-baseline` | The ledger covers no day, so the daily update would refuse. Run `fetch` once, as in [Before you start](#before-you-start). |
| `update.no-baseline` in the error log | The ledger is empty or `.cache/` was removed. Run `fetch` once. |
| `update.already-running` | Another update is running. Wait for it, or check for a stuck process. |
| `update.stage-failed: fetch stopped at gmail.reauth-required` | Run `node src/cli/harvest.mjs auth`, then `launchctl kickstart -k gui/$(id -u)/local.job-alert-harvester.update`. |
| `update.stage-failed: fetch stopped at gmail.sender-matches-nothing` | The mailbox has never held an alert from the sender, so the fetch stops. Check you consented as the mailbox that receives the alerts. |
| `update.stage-failed: build stopped at ...` | The fetch is kept. Fix the build's code (listed in the [refusals reference](../reference/refusals.md)), then run the job again. |
| `update.stage-failed: lock stopped at ...` | `.cache/update.lock` is unreadable or `.cache/` is not writable. See `lock.*` in the [refusals reference](../reference/refusals.md). |
| `status` shows `drift: plist`, `wrapper` or `plist and wrapper` | A file differs from what `install` would write. Run `install --load` again. |
| `status` shows `loaded: no` | Run `install --load`. |
| `status` shows `node: missing <path>`, `last exit code: 127`, or the notification says `node is not executable: run harvest install again` | The node path in the wrapper no longer exists. Run `install --load` again. |
| `install.not-on-main` | Switch the checkout to `main`, or pass `--allow-any-branch` and accept that the job runs that branch. |
| `install.foreign-plist` | A plist you wrote by hand is in the way. Back it up, then pass `--force`. |
| `install.other-checkout` | The job runs a different checkout. Pass `--force` to move it to this one. |
| `install.launchctl-failed` | The files are written, but the job did not load. Read the detail, then run `status`. |
| No log file appears | Run `status`, then check `.cache/logs/` exists and `launchctl print gui/$(id -u)/local.job-alert-harvester.update`. |
| No notification appears | The banner may sit in Notification Centre. Set Script Editor's alert style to Persistent, as above. |

Every `install.*` code is listed in the [refusals reference](../reference/refusals.md#install-install).
