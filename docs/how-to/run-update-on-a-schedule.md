# Run update on a schedule

Doc type: How-To

Goal: make a macOS launchd job run `harvest update` every morning, write its output to log files, and show a notification when a run fails.

`update` fetches the days since the last fetched day, then builds into your Google Sheet. Its options, output and exit codes are in the [CLI reference](../reference/cli.md).

## Before you start

- Run every command from the repository root unless a step says otherwise.
- `auth` and `auth --target sheets` have succeeded, and `import` has recorded your Sheet: [Use a Google Sheet as the tracker](use-a-google-sheet-as-the-tracker.md).
- The ledger holds at least one fetched day. If it does not, run `node src/cli/harvest.mjs fetch --source linkedin --from <first-day> --to <last-ended-day>` once: [Fetch new mail](fetch-new-mail.md).
- A run by hand has worked. `node src/cli/harvest.mjs update --dry-run` prints the range it would fetch and the build preview, and `node src/cli/harvest.mjs update` runs it for real.

## Set it up

1. Find the absolute path to `node`:

   ```bash
   command -v node
   ```

   Write down the path it prints. It is `<absolute-path-to-node>` in the steps below.

   > **Warning.** A path that contains a version number breaks when node is upgraded, and the job then fails every morning. Use a path that stays the same across upgrades.

2. Create the log directory. `.cache/` is gitignored:

   ```bash
   mkdir -p .cache/logs
   ```

3. Write the wrapper script `<wrapper-path>` (a file outside the repository, or one you keep untracked). It runs `update`, copies stderr to the log, and on a non-zero exit shows a notification with the last stderr line:

   ```sh
   #!/bin/sh
   err=$(mktemp)
   <absolute-path-to-node> src/cli/harvest.mjs update 2>"$err"
   status=$?
   cat "$err" >&2
   if [ "$status" -ne 0 ]; then
     message=$(tail -n 1 "$err" | tr -d '"\\')
     osascript -e "display notification \"$message\" with title \"harvest update failed\""
   fi
   rm -f "$err"
   exit "$status"
   ```

4. Make the wrapper executable:

   ```bash
   chmod +x <wrapper-path>
   ```

5. Write the LaunchAgent to `~/Library/LaunchAgents/<label>.plist`. `<label>` is a reverse-domain name you choose. Replace every placeholder with an absolute path; launchd does not expand `~`.

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
     <key>Label</key>
     <string><label></string>
     <key>ProgramArguments</key>
     <array>
       <string>/bin/sh</string>
       <string><wrapper-path></string>
     </array>
     <key>WorkingDirectory</key>
     <string><repository-root></string>
     <key>StartCalendarInterval</key>
     <dict>
       <key>Hour</key>
       <integer>5</integer>
       <key>Minute</key>
       <integer>30</integer>
     </dict>
     <key>StandardOutPath</key>
     <string><repository-root>/.cache/logs/update.out.log</string>
     <key>StandardErrorPath</key>
     <string><repository-root>/.cache/logs/update.err.log</string>
   </dict>
   </plist>
   ```

   `WorkingDirectory` is mandatory. The ledger, the cache and the lock file use paths relative to the working directory, so a job that starts anywhere else reads an empty ledger and refuses with `update.no-baseline`, or writes a cache in the wrong place.

   > **Why 05:30.** A Sheets build writes to your Sheet, and a sort, insert or delete you make during that write can send a harvester-written column to the wrong row. 05:30 is a quiet time away from the hours you work in the Sheet. See DR-0012 (Sheets write window risk). Change `Hour` and `Minute` to suit your own hours.

6. Check the plist is well formed:

   ```bash
   plutil -lint ~/Library/LaunchAgents/<label>.plist
   ```

7. Load the job into your login session:

   ```bash
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/<label>.plist
   ```

8. Run it once now as a smoke test:

   ```bash
   launchctl kickstart -k gui/$(id -u)/<label>
   ```

9. Read the logs after it finishes:

   ```bash
   tail -n 20 .cache/logs/update.out.log .cache/logs/update.err.log
   ```

   A good run ends the output log with `harvest update: complete, fetched <n> day(s), built the Sheet`. A run with no new mail also prints `harvest update: nothing new from Gmail` before it. A failed run ends the error log with an `update.stage-failed` line, and the notification shows the same line.

## Change or remove the job

1. After editing the plist, unload and load it again:

   ```bash
   launchctl bootout gui/$(id -u)/<label>
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/<label>.plist
   ```

2. To remove the job, run the `bootout` command and delete the plist.

## Why

**Overlapping runs.** `update` takes `.cache/update.lock` for the whole run. A second run that starts while the first is alive stops with `update.already-running`. A run that was killed leaves a lock whose process is dead, and the next run replaces it. `kickstart -k` kills a running job first, so it can leave such a lock.

**Fail closed.** A failed fetch stops the run before the build, so the Sheet is never built from a cache known to have a gap. Days the fetch already committed stay committed, and the next run resumes. See DR-0016 (update owns the sequence).

## If it goes wrong

| You see | Do this |
|---|---|
| `update.no-baseline` | The ledger is empty, or the job ran from the wrong directory. Check `WorkingDirectory`, then run `fetch` once. |
| `update.already-running` | Another update is running. Wait for it, or check for a stuck process. |
| `update.stage-failed: fetch stopped at gmail.reauth-required` | Run `node src/cli/harvest.mjs auth`, then `launchctl kickstart -k gui/$(id -u)/<label>`. |
| `update.stage-failed: fetch stopped at gmail.sender-matches-nothing` | The mailbox has never held an alert from the sender, so the fetch stops. Check you consented as the mailbox that receives the alerts. |
| `update.stage-failed: build stopped at ...` | The fetch is kept. Fix the build's code (listed in the [refusals reference](../reference/refusals.md)), then run the job again. |
| `update.stage-failed: lock stopped at ...` | `.cache/update.lock` is unreadable or `.cache/` is not writable. See `lock.*` in the [refusals reference](../reference/refusals.md). |
| No log file appears | Check `plutil -lint`, that `.cache/logs/` exists, and `launchctl print gui/$(id -u)/<label>`. |
| The job fails with `node: command not found` or exits 127 | The path in the wrapper is wrong or no longer exists. Repeat step 1 and edit the wrapper. |
