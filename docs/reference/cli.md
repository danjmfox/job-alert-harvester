# CLI reference

Doc type: Reference

Source of truth: `src/cli/harvest.mjs` and the modules it wires, and the two files in `scripts/`. Checked against commit e7e0dd0. Refusal codes are in [refusals.md](refusals.md).

## Invocation

```text
node src/cli/harvest.mjs <subcommand> [options]
node src/cli/harvest.mjs --in <dir> --out <file.xlsx>
npm run harvest -- <subcommand> [options]
```

Subcommands: `plan-fetch`, `ingest`, `build`, `fetch`, `auth`, `import`, `update`, `install`, `uninstall`, `status`. Any first argument that is not one of these selects the rebuild form (`--in`, `--out`).

## Argument parsing

| Rule | Behaviour |
|---|---|
| Option syntax | `--name value` for options that take a value, `--name` alone for flags. `--name=value` is not supported. |
| Flags | Each subcommand has a fixed table of options. A flag (`--dry-run`, `--complete`, `--load`, `--force`, `--allow-any-branch`) never takes a value. `status` has no options. |
| Unknown options | Refused with `cli.unknown-option`, which lists the valid options and, where one is close, a "did you mean" hint. This includes misspellings (`--dryrun`), short forms (`-n`) and `--name=value`. |
| Positional tokens | Refused with `cli.unexpected-argument`. This includes a misspelled subcommand, which reaches the rebuild form and is refused there. |
| Repeated option | Refused with `cli.duplicate-option`. |
| Option without a value | Refused with `cli.missing-value` when an option that needs a value is last, or is followed by another option (`--merge --dry-run`). A bare `--target` is this case. |
| Working directory | `.cache/` paths resolve against the current directory. |
| Dates | `YYYY-MM-DD`, read as UTC days, and each must be a real calendar day. `--from` and `--to` on `plan-fetch` and `fetch`, and both ends of `ingest --window`, are checked before anything is read or written; anything else (`2026-02-30`, `2026-13-01`, `2026-2-1`, `banana`) is refused as `cli.invalid-date`. |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success, including "already covered", "fully covered", "nothing settled to fetch", an `update` that found nothing new, an `install` or `uninstall` plan or run, `uninstall: nothing to remove`, and a `status` report of any state it can read. |
| 1 | Any refusal or error in a subcommand or the rebuild form. `update`, `install`, `uninstall` and `status` have no other failure status. |
| 2 | No arguments at all (usage text on stderr). |

A named refusal prints on stderr as `<code>: <detail>`, or as `<code>` alone.

## Commands

### Rebuild form

| Field | Value |
|---|---|
| Synopsis | `--in <dir> --out <file.xlsx>` |
| Purpose | Write a new workbook from every message JSON under a directory. |
| Options | `--in` (required): directory, read recursively for `*.json`. `--out` (required): file path; missing parent directories are created. |
| Defaults | None. |
| Required combinations | Both options. |
| Reads | Every `*.json` under `--in`. |
| Writes | `--out`, only when it does not already exist: an existing `--out` is refused before any read or write with `build.out-exists: --out <path> already exists; the rebuild form never overwrites. Choose a new --out, or run build --out <f> --merge <p> to merge into it` (exit 1). Tab order `Sources`, `Companies`, `Jobs`. Human-owned columns are blank. |
| Network | None. |
| Stdout | `harvested <m> messages -> <j> jobs, <c> companies, <s> saved searches`, then `wrote <out>`. |
| Stderr | `usage: harvest.mjs --in <dir> --out <file.xlsx>` and a second line listing the subcommands (exit 2). `harvest: --in <dir> does not exist` (exit 1). `harvest: --in <dir> holds no message JSON — refusing to write an empty workbook` (exit 1). |
| Exit codes | 0, 1, 2. |

### plan-fetch

| Field | Value |
|---|---|
| Synopsis | `plan-fetch [--source <id>] --from <d> --to <d> [--batch <n>]` |
| Purpose | Print the earliest uncovered UTC day in a range. |
| Options | `--source`: default `linkedin`, not validated. `--from`, `--to` (required). `--batch`: optional integer, echoed in the output only. |
| Required combinations | `--from` and `--to` together. Otherwise `harvest plan-fetch: --from <d> and --to <d> are required`. |
| Reads | `.cache/coverage.json` (absent reads as empty). |
| Writes | None. |
| Network | None. |
| Stdout | `harvest plan-fetch: <from>..<to> batch=<n or unspecified>`, or `harvest plan-fetch: <source> <from>..<to> is fully covered`. |
| Stderr | Refusals. |
| Exit codes | 0, 1. |
| Notes | Does not clamp to finished days. |

### ingest

| Field | Value |
|---|---|
| Synopsis | `ingest --raw <dir> --window <a>..<b> --expect <n> [--complete]` |
| Purpose | Move staged connector message files into the cache. |
| Options | `--raw` (required): directory of files named `mcp-*-get_message-<digits>.txt`; other files are ignored. `--window` (required): `<from>..<to>`. `--expect` (required): integer, must equal the count of matching files. `--complete`: flag, commit coverage for the window. |
| Defaults | Source is always `linkedin`; there is no `--source`. |
| Required combinations | `--raw`, `--window`, `--expect`. Otherwise a plain error such as `harvest ingest: --expect <n> is required`. |
| Reads | The matching files in `--raw`; ids already under `.cache/messages/`; `.cache/coverage.json`. |
| Writes | `.cache/messages/<YYYY-MM>/<id>.json` for each new, non-quarantined message. With `--complete`, `.cache/coverage.json`, recording the message count. |
| Network | None. |
| Stdout | `harvest ingest: cached <n> message(s), skipped <d> duplicate(s)`, followed by `, coverage committed for <a>..<b>` with `--complete`. |
| Stderr | `harvest ingest: quarantined <id> (<reason>)` per quarantined message. Refusals. |
| Exit codes | 0, 1. |
| Notes | Probes the ledger, the cache and the spill directory before any write. |

### fetch

| Field | Value |
|---|---|
| Synopsis | `fetch [--source <id>] --from <d> --to <d>` |
| Purpose | Fetch mail through the Gmail API into the cache, one UTC day at a time. |
| Options | `--source`: default `linkedin`, the only source. `--from`, `--to` (required). |
| Required combinations | `--from` and `--to` together, `--to` not before `--from`. |
| Range handling | `--to` is clamped to the last UTC day that has ended. If `--from` is later, nothing is fetched. |
| Reads | `.cache/coverage.json`; ids under `.cache/messages/`; `~/.config/job-alert-harvester/client.json` and `token.json`. |
| Writes | `.cache/messages/<YYYY-MM>/<id>.json`; `.cache/coverage.json` (one commit per completed day, after every listed message is cached or quarantined); `token.json` only if Google rotates the refresh token. |
| Network | `oauth2.googleapis.com/token`; `gmail.googleapis.com/gmail/v1` (`users/me/profile`, `users/me/messages` list and get, GET only). Query `from:jobalerts-noreply@linkedin.com after:<epoch> before:<epoch>`, 500 per page. Up to 3 attempts per request, 500 ms base backoff doubling with jitter, `Retry-After` honoured. |
| Stdout | `harvest fetch: <day>..<day> — <n> message(s)` per day; `harvest fetch: quarantined <id> (<reason>)`; `harvest fetch: nothing settled to fetch`; `harvest fetch: <source> <from>..<to> is already covered`. |
| Stderr | Refusals. |
| Exit codes | 0, 1. |
| Notes | Probes the ledger, the cache and the source (credential directory, client, token refresh, mailbox match, sender has mail) before the first listing. An already-covered range returns before any credential is read. |

### build (workbook)

| Field | Value |
|---|---|
| Synopsis | `build --out <file> [--merge <file>] [--dry-run] [--report <file>]` |
| Purpose | Create or merge into a three-tab `.xlsx` from the whole cache. |
| Options | `--out`: workbook path (required unless `--dry-run`). `--merge`: existing workbook. `--dry-run`: flag, plan only. `--report`: path of a change report; parent directories are created; the file is empty when nothing changed. |
| Modes | `--out` alone: create. `--out` and `--merge` naming one path: merge. `--dry-run` (with or without `--merge`): preview. |
| Required combinations | `--merge` and `--out` must resolve to the same path. Create refuses an existing `--out` with `build.out-exists`. Create and merge refuse an empty cache. `--dry-run` does not. `--target` other than `sheets` is refused. |
| Reads | The whole of `.cache/messages/` (absent reads as empty); the `--merge` file; `.cache/receipts/*.json` (with `--merge`, including `--dry-run`). |
| Writes | Create: `--out`. Merge: `--out`, replaced atomically through a `<file>.tmp-<pid>-<ms>` sibling, then `.cache/receipts/<epoch-ms>-<uuid>.json`. Preview: the report only. |
| Network | None. |
| Stdout, create | `harvest build: created a new workbook`, `  rows appended: <n>`, `  cells written: <n>`. |
| Stdout, merge | `harvest build: merged`; per tab `  <tab>: rows updated: <n>, rows appended: <n>, columns appended: <n>, cell changes: <n>`; `  cells written: <n>`. |
| Stdout, preview | Per tab: `harvest build --dry-run: plan for tab "<tab>"` then `columns to append`, `rows to update`, `rows to append`, `cell changes`. |
| Stderr | `harvest build: <n> derived correction(s):` then one `<tab>\t<key>\t<column>: <before> -> <after>` line each, or `harvest build: no derived corrections (<n> sighting bookkeeping change(s))`. After the change summary, a merge build, a Sheets build and `--dry-run` (with or without `--merge`) also print the role-family view when at least one advert is `other`: `harvest build: role families: <family> <n>, ...`, then `harvest build: <n> of <total> advert(s) classified other; most frequent:` and up to 15 lines of `  <count>  <normalised title>`. It is stderr only: it never appears on stdout or in the `--report` file, and a create build or `--in` rebuild does not print it. Straight after it, the same sites print the search-yield view (DR-0015): `harvest build: search yield, all cached alerts (distinct adverts per saved search)` and, unless the whole cache fits inside the 28 dates, `harvest build: search yield, last 28 days to <date>`, each followed by a table with one row per saved search (`found`, `other` as `n (p%)`, `on-target`, `unique`), a `(no search term)` row for alerts that name none, and an `all searches` row counting distinct adverts. `unique` is the on-target adverts that only that search found. Searches are listed most adverts first, up to 20 (then `... and <n> more search(es) not shown`), and labels over 40 characters are cut. A block is omitted when it has fewer than two named searches. The last-28-days window ends at the latest advert date in the cache, not at today. Like the role-family view, it is stderr only, never in `--report`, and derived from the whole cache on every build. The stale warning: `harvest build: <file> still matches what we last wrote -- this looks like a stale download, so edits made in the sheet since may be lost`. Refusals. |
| Exit codes | 0, 1. The stale warning does not change the exit code. |
| Notes | `Role Family` is a harvester-owned `Jobs` column: one of `agile coach`, `scrum master`, `AI transformation`, `transformation/change`, `engineering/delivery manager`, `product/product ops` or `other`, chosen from the title alone by an ordered pattern table in `src/core/role-families.mjs` (DR-0014). A tracker that predates it gets the column appended at the far right on the first merge, and that first population is not listed as a derived correction; later changes to a row's family are. Sighting bookkeeping columns: `First Seen`, `Last Seen`, `Times Seen`, `Jobs Seen`, `Messages`, `Jobs Found`. The report lists every changed cell; the stderr summary lists corrections only. A missing `--merge` file raises a raw `ENOENT`. |

### build --target sheets

| Field | Value |
|---|---|
| Synopsis | `build --target sheets [--dry-run] [--report <file>]` |
| Purpose | Merge the cache into the Sheet recorded by `import`. |
| Options | `--target sheets` (required). `--dry-run`: flag, read capability only. `--report`: as above. |
| Required combinations | `--out` and `--merge` are refused in any form (`build.target-conflict`). A bare `--target` is refused as an empty target. Real builds refuse an empty cache. `--dry-run` does not. |
| Reads | The whole cache; `~/.config/job-alert-harvester/client.json`, `sheets-token.json`, `sheets-target.json`; the Sheet. |
| Writes | The Sheet, through one `spreadsheets.batchUpdate` using only `updateCells`, `appendCells`, `appendDimension` and `addSheet`. Existing rows: harvester-owned non-key columns only. New rows: key and harvester-owned columns. Missing tabs and columns are created. The report. `sheets-token.json` only if Google rotates the refresh token. No receipt. |
| Write limits | Body larger than 9 MiB: `sheets.plan-too-large`. Rows and columns are re-read before each attempt. Unchanged cells and keys already present are skipped. Up to 3 attempts; the write is never replayed after an unknown outcome. |
| Network | `oauth2.googleapis.com/token`; `sheets.googleapis.com/v4` (spreadsheet and values reads, `:batchUpdate`); `www.googleapis.com/drive/v3` (file read, `trashed` field). |
| Stdout | As merge above; preview prints the plan lines. |
| Stderr | Correction summary as above. Refusals. |
| Exit codes | 0, 1. |

### update

| Field | Value |
|---|---|
| Synopsis | `update [--from <d>] [--dry-run]` |
| Purpose | Bring the Sheet up to date in one command: fetch the days since the last fetched day, then run `build --target sheets`. |
| Options | `--from`: a day, `YYYY-MM-DD`, validated as for `fetch` (`cli.invalid-date`). `--dry-run`: flag, preview. There is no `--to`, `--source` or `--report`; the source is `linkedin`. |
| Defaults | `--from` is the earliest day the ledger covers for `linkedin`. The end of the range is today's UTC day, which the fetch moves back to the last UTC day that has ended. |
| Sequence | 1. Take the run lock. 2. Read the ledger and plan the range. 3. Fetch it, as `fetch --source linkedin --from <from> --to <today>` does. 4. If the fetch succeeded, run `build --target sheets`, even when the fetch committed no day. 5. Print the summary line and release the lock. A failed stage stops the sequence, and the build never runs after a failed fetch. |
| `--from` | Overrides the start day. It also replaces the ledger as the source of the start day, so it rescues an empty or missing ledger. A gap before the earliest covered day is not noticed by the default; `--from` covers it. A start day after the last ended UTC day fetches nothing, and the build still runs. |
| `--dry-run` | Prints the range a run would fetch and counts its uncovered days from the ledger, then runs `build --target sheets --dry-run`. It makes no Gmail request and no write. It never takes the run lock and is not refused when another update holds it. |
| Required combinations | None. A real run needs a recorded Sheet and the Gmail and Sheets credentials, as `fetch` and `build --target sheets` do. An empty ledger needs `--from`, otherwise `update.no-baseline`. |
| Reads | `.cache/coverage.json`; with a real run, `.cache/update.lock`; everything `fetch` and `build --target sheets` read. A preview reads what `build --target sheets --dry-run` reads and no Gmail credential. |
| Writes | A real run: `.cache/update.lock` (created, then removed); `.cache/update.lock.probe` (created and removed by the lock's start-up check); everything `fetch` and `build --target sheets` write. A preview writes nothing. |
| Network | As `fetch` and `build --target sheets`. A preview makes only the Sheets and Drive reads. |
| Stdout | In order: the `fetch` stage's own lines; `harvest update: nothing new from Gmail` when the fetch committed no day (this line stays when the build then fails); the build's own stdout; `harvest update: complete, fetched <n> day(s), built the Sheet`. A preview prints `harvest update --dry-run: would fetch <from>..<to>, <n> uncovered day(s)`, then the build preview's plan lines. When nothing has settled since `<from>`, the preview prints `0 uncovered day(s)`. |
| Stderr | The build's correction summary, role-family view and search-yield view, as `build --target sheets` prints them. A failure prints one last line, `update.stage-failed: <stage> stopped at <code>: <detail>` (the stage is `lock`, `plan`, `fetch` or `build`; ` at <code>` is absent when the error carries no code). A build failure adds `; the fetch is kept, run update again`. Refusals `update.no-baseline` and `update.already-running` print alone. A failed run prints no summary line. |
| Exit codes | 0, 1. |
| Notes | The ledger, the lock file and `.cache/` resolve against the working directory, so run `update` from the repository root. An unreadable ledger stops a run at the fetch (`update.stage-failed: fetch stopped at ledger.unreadable`); an unreadable lock file, or a `.cache/` that cannot take the lock, stops it at the lock (`update.stage-failed: lock stopped at lock.unreadable` or `lock.not-writable`). An unreadable ledger stops a preview at the plan (`update.stage-failed: plan stopped at ledger.unreadable`), since a preview never fetches. A committed day stays committed after a later failure, so the next run resumes. Credentials are read only when a day is left to fetch, so `gmail.reauth-required` appears only on such a run. `install` generates the scheduler files for it; the how-to is [Run update on a schedule](../how-to/run-update-on-a-schedule.md). |

### install

| Field | Value |
|---|---|
| Synopsis | `install [--at <HH:MM>] [--dry-run] [--load] [--force] [--allow-any-branch]` |
| Purpose | Write the wrapper script and the LaunchAgent plist that run `update` every day from this checkout. macOS only. |
| Options | `--at`: the daily time as `HH:MM`, two digits each, hour `00`-`23`, minute `00`-`59`; default `05:30`; any other text is `install.invalid-time`. `--dry-run`: flag, print the plan and the text of both files, write nothing. `--load`: flag, after the files are written, load the job with `launchctl`. `--force`: flag, replace a plist that is foreign (`install.foreign-plist`) or that runs another checkout (`install.other-checkout`). `--allow-any-branch`: flag, skip the `main` check (`install.not-on-main`). |
| Defaults | `--at 05:30`. Without `--load`, `launchctl` is never called. |
| Required combinations | Run from the repository root of the checkout that holds the running script, otherwise `install.wrong-directory`. With `--dry-run`, `--load` is accepted and has no effect: the preview prints the same plan and calls nothing. |
| Order of checks | Option table, platform, `--at`, directory, path safety, branch, existing plist, writability of the three directories, writes, `--load`. The first failing check is the refusal, so `install.unsupported-platform` wins over `install.invalid-time`, and `install.invalid-time` wins over every later check. |
| Reads | The working directory's real path; the home directory; the `node` entries on `PATH`; `git rev-parse HEAD` and `git symbolic-ref --short -q HEAD` run in the checkout; the existing plist and wrapper; `.cache/coverage.json`, only to decide whether to warn. An unreadable or empty ledger is read as no baseline and is a warning, not a refusal. |
| Writes | The wrapper, then the plist, each atomically through a `<file>.tmp` sibling. A file whose text already matches is `unchanged` and is not written. The folders `.cache/launchd/`, `.cache/logs/` and `~/Library/LaunchAgents/` are created if absent. Before any write, each of the three folders is tried with a file that is created, renamed and removed (an absent folder is judged by its nearest existing ancestor and is not created); nothing is written when that fails. |
| `launchctl` calls | Only with `--load`, in this order: `print gui/<uid>`; `print gui/<uid>/<label>`; `bootout gui/<uid>/<label>` if the job was loaded; `bootstrap gui/<uid> <plist>`; `print gui/<uid>/<label>`. `kickstart` is never called. The job is loaded when the last `print` exits 0. |
| Network | None. |
| Stdout | In order: `harvest install: checkout <root> at <commit> on <branch>`, with a 7-character commit, `detached` in place of `on <branch>` for a detached HEAD, or `harvest install: checkout <root> (not a git checkout, or git cannot be run)`; `harvest install: the job runs whatever this checkout holds`; one `harvest install: create|replace|unchanged <path>` line per file, wrapper first, then plist; for a replaced plist, `harvest install: launchctl bootout gui/<uid>/<label>`; `harvest install: next: launchctl bootstrap gui/<uid> <plist>`, printed by a real run without `--load` and by every preview, and not printed by a real run with `--load`, which prints `harvest install: loaded gui/<uid>/<label>` instead. A preview uses the prefix `harvest install --dry-run:` and then prints `<prefix> <path> would hold:` and the exact text of each file. |
| Stderr | One `harvest install: warning: <text>` line per warning, before the files are written (`harvest install --dry-run: warning:` in a preview). Warnings: `update.no-baseline` (the ledger covers no day, so the daily update would refuse until a `fetch`); the pinned node path holds a version number, so upgrading node breaks the job until `install` runs again; the checkout is under `Documents`, which macOS may not let a launchd job read. Refusals. A clean install prints nothing on stderr. |
| Exit codes | 0, 1. A refusal before any write leaves stdout empty and its code leads the last stderr line. A `--load` failure comes after the plan was printed, so the plan and per-file lines stay on stdout, `install.launchctl-failed` goes to stderr, and the written files stay. |
| Notes | The job runs whatever the checkout holds when it fires: install does not pin a commit, and refuses a checkout that is not on `main` for that reason. A detached HEAD and a directory that is not a git checkout are never `main`. The node path is the first `node` on `PATH` whose real path is the running binary, otherwise the running binary's path. The plist label is `local.job-alert-harvester.update`. Behaviour on a git checkout whose `main` has no commit is not specified. Refusals are in [refusals.md](refusals.md). |

### uninstall

| Field | Value |
|---|---|
| Synopsis | `uninstall [--dry-run] [--force]` |
| Purpose | Boot the job out of launchd if it is loaded, then remove the plist and the generated wrapper. macOS only. |
| Options | `--dry-run`: flag, print what would be done. `--force`: flag, remove a plist that is foreign (`install.foreign-plist`). |
| Reads | The plist and the wrapper; `launchctl print gui/<uid>/<label>`, to learn whether the job is loaded. A preview reads the same. |
| Writes | Removes the plist, then the wrapper, each only if it exists. A preview writes nothing. |
| `launchctl` calls | `print gui/<uid>/<label>`, then `bootout gui/<uid>/<label>` if the job is loaded and the run is not a preview. The bootout runs while both files still exist. |
| Leaves | The logs under `.cache/logs/`, `.cache/` content, the ledger and the credentials. Whether `.cache/launchd/` remains after the wrapper is removed is not specified. Behaviour when run from a checkout other than the one the plist runs is not specified. |
| Stdout | `harvest uninstall: launchctl bootout gui/<uid>/<label>` when the job was loaded; one `harvest uninstall: remove <path>` line per file removed; `harvest uninstall: nothing to remove` when the job is not loaded and neither file exists. A preview uses the prefix `harvest uninstall --dry-run:`. |
| Stderr | Refusals. |
| Exit codes | 0, 1. A failed bootout is `install.launchctl-failed` and leaves both files in place. A file that cannot be removed is `install.not-writable`. |

### status

| Field | Value |
|---|---|
| Synopsis | `status` |
| Purpose | Report whether the job is installed, loaded, in step with what `install` would write, and likely to fail tomorrow. macOS only. |
| Options | None. |
| Reads | The plist, the wrapper, the two log files (text and modification time), whether the node path `status` would choose now is executable, and `launchctl print gui/<uid>/<label>`. It writes nothing and calls no other `launchctl` verb. |
| Loaded | The job is loaded when `launchctl print` exits 0, never from its text. Verified on a real machine: `launchctl print` exits 113 for a job that is not loaded. `status` treats any non-zero exit, and a failure to run `launchctl`, as not loaded. |
| Stdout | `harvest status: <field>: <value>`, one line per field, in this order: `installed` (`no`, `yes`, or `yes (foreign plist: not written by harvest install)`); `schedule` (`HH:MM` read from the plist, or `unknown`); `drift` (`none`, `not compared (foreign plist)`, or `plist`, `wrapper` or `plist and wrapper` followed by `differ from what install would write`); `node` (`ok`, or `missing <path>`); `wrapper` (`ok` or `missing`); `loaded` (`yes` or `no`); when loaded, `state`, `runs`, `last exit code` and `pid`, each as `launchctl print` shows it or `unknown`; `output log` and `error log` (modification time as an ISO UTC time, or `none`); `last output line` (the last non-blank line of the output log, or `none`). |
| Stderr | When the job is loaded and `launchctl print` did not show some of `state`, `runs` and `last exit code`: `harvest status: launchctl print gui/<uid>/<label> did not show <fields>; they are reported as unknown`. Refusals. |
| Exit codes | 0 whenever a report can be printed, including a job that is not installed or not loaded. 1 for `install.unsupported-platform`, or for `install.unrecognised-output` (a loaded job whose `launchctl print` text yields none of the four fields), which prints the first 20 lines of that text on stderr and nothing on stdout. |
| Notes | Drift is judged against the plist's own schedule, so an install at `--at 06:45` is not drift. The files `install` would write are rendered with the node path `status` chooses now, so a changed node path shows as drift in the wrapper. A foreign plist is reported, not compared. |

### auth

| Field | Value |
|---|---|
| Synopsis | `auth [--target gmail\|sheets]` |
| Purpose | Record one OAuth consent and store its refresh token. |
| Options | `--target`: default `gmail`. `gmail` requests `gmail.readonly`; `sheets` requests `drive.file`. Any other value, or a bare `--target`, is `auth.unknown-target`. |
| Reads | `client.json`. |
| Writes | `token.json` (`gmail`) or `sheets-token.json` (`sheets`), mode 0600, atomic. Content: `version`, `refreshToken`, `scope`, `obtainedAt`, and for `gmail` also `emailAddress`. The directory is created with mode 0700 if absent. |
| Network | A listener on `127.0.0.1` at a random port, path `/callback`, closed after use, 5-minute limit. `oauth2.googleapis.com/token`. For `gmail`, `users/me/profile`. The browser goes to `accounts.google.com`. |
| Flow | Authorisation code with PKCE (`S256`), a `state` check, offline access, forced consent screen. The granted scope must equal the requested scope exactly. |
| Stdout | The consent URL, then `harvest auth: consent recorded for <email>` or `harvest auth --target sheets: consent recorded for drive.file`. |
| Stderr | Refusals. |
| Exit codes | 0, 1. |

### import

| Field | Value |
|---|---|
| Synopsis | `import --from <file.xlsx>` |
| Purpose | Create the tracker Sheet once from a workbook and record its id. |
| Options | `--from` (required): otherwise `harvest import: --from <file.xlsx> is required`. |
| Reads | The workbook; `sheets-target.json`; `client.json`; `sheets-token.json`. |
| Writes | One native Sheet in Drive, named after the file's base name. `sheets-target.json` (mode 0600, created exclusively, never overwritten; content `version`, `spreadsheetId`, `importedAt`). On failure after creation, deletes that Sheet. `sheets-token.json` only on token rotation. |
| Sequence | Refuse if a Sheet is recorded; read the workbook; check it; create the Sheet; read it back and compare tabs, headers, row counts and key sets; record the id. |
| Network | `oauth2.googleapis.com/token`; `www.googleapis.com/upload/drive/v3/files` (multipart, sent once); `www.googleapis.com/drive/v3/files` (delete of the Sheet it created); `sheets.googleapis.com/v4` (read back). |
| Stdout | `import: created Sheet <spreadsheet-id>`. |
| Stderr | `import: could not delete the created Sheet <id>; remove it manually`. Refusals. |
| Exit codes | 0, 1. |

## Scripts

Both scripts are operator-run, need a credential, call live Google APIs, and are not part of `npm test`.

### scripts/sheets-live-check.mjs

| Field | Value |
|---|---|
| Synopsis | `node scripts/sheets-live-check.mjs [--self-test \| --only <ids>]` |
| Purpose | Probe Google's Sheets and Drive behaviour against a scratch Sheet. |
| Options | `--self-test`: offline, against a loopback fake, no credential. `--only`: comma-separated ids among `A1`-`A19` and `L01`-`L20`, also as `--only=<ids>`. |
| Reads | `client.json`. |
| Writes | `sheets-live-check-token.json` (mode 0600) in the credential directory; `docs/feature/sheets-api-target/deliver/live-fixtures.json` in the repository; a scratch Sheet named `harvester-live-check-<timestamp>`, deleted at the end. |
| Stdout | A `\| id \| verdict \| evidence \|` table, `scratch Sheet deleted: <yes (HTTP 204) or NO or none was created>`, `fixtures written to <path>`. Self-test: `pass`/`FAIL` lines and `self-test: <n> checks passed`. |
| Stderr | `usage: node scripts/sheets-live-check.mjs [--self-test \| --only <A-ids or L-ids, comma-separated>]`; `live-check: failed (<reason>)`. |
| Exit codes | 0 complete and Sheet deleted. 1 setup failure, or Sheet not deleted, or a self-test check failed. 2 usage error or start-up failure. |

### scripts/gmail-parity-check.mjs

| Field | Value |
|---|---|
| Synopsis | `node scripts/gmail-parity-check.mjs [<message-id>]` |
| Purpose | Compare one cached message with the same message fetched through the Gmail API. |
| Options | Message id, default the first cached message. |
| Reads | `.cache/messages/`; `client.json`; `token.json`. |
| Writes | None, except a rotated refresh token in `token.json`. |
| Stdout | `same` or `DIFFERENT` per field (`sender`, `subject`, `date`, `snippet`, `plaintextBody`) and for `extractJobs`; `parity: <id> matches` or `parity: <id> DIFFERS`. `plaintextBody` is informational. |
| Stderr | `parity: no cached message <id> under .cache/messages`; `parity: failed (<code or message>)`. |
| Exit codes | 0 parity. 1 differs. 2 misuse or failure. |

## What the generated files contain

`install` writes two files, and `uninstall` removes them. Both carry a generated marker: the plist holds the one XML comment ``<!-- Generated by `harvest install`. Remove it with `harvest uninstall`. -->``, and the wrapper's second line reads `# Generated by harvest install. Remove it with harvest uninstall.`. A plist without that comment is foreign.

### The plist

Path `~/Library/LaunchAgents/local.job-alert-harvester.update.plist`, mode 0644. Every string is XML-escaped. The keys, in order:

| Key | Value |
|---|---|
| `Label` | `local.job-alert-harvester.update` |
| `ProgramArguments` | An array: `/bin/sh`, then the absolute path of the wrapper. |
| `WorkingDirectory` | The checkout's real path. |
| `StartCalendarInterval` | A dictionary of integers: `Hour`, then `Minute`, from `--at`. |
| `StandardOutPath` | `<checkout>/.cache/logs/update.out.log` |
| `StandardErrorPath` | `<checkout>/.cache/logs/update.err.log` |

`launchd` appends to both logs and never rotates them.

### The wrapper

Path `<checkout>/.cache/launchd/update.sh`, mode 0755, run as `/bin/sh <wrapper>`. Every embedded path is single-quoted. The wrapper:

1. Changes into the checkout. On failure it notifies `cannot enter the checkout` and exits 1.
2. Checks that the pinned node is an executable file. On failure it notifies `node is not executable: run harvest install again` and exits 127.
3. Makes a temporary file under `$TMPDIR` (or `/tmp`) for stderr. On failure it notifies and exits 1. The file is removed on every exit, and `HUP`, `INT` and `TERM` exit 143.
4. Runs `<node> src/cli/harvest.mjs update` with stderr to that file, then replays the file to its own stderr. Stdout goes straight to the output log.
5. On a non-zero status, posts one notification titled `harvest update failed` through `osascript`. The message is a single argument: the last non-blank stderr line with control characters removed and cut to 200 characters, or `exit status <n>` when stderr is empty.
6. Exits with the status of `update`. A missing or failing `osascript` never changes the status.

The wrapper assigns no `PATH`, so the job runs with launchd's default `PATH`, which is why the node path is absolute. The wrapper changes into the checkout itself, and the plist also sets `WorkingDirectory`, so the ledger, the cache and the lock resolve against the checkout.

## Environment variables

| Name | Default | Effect |
|---|---|---|
| `HARVEST_API_BASE_URL` | unset (Google endpoints) | Redirects every Google endpoint to `<origin>/gmail/v1`, `/sheets/v4`, `/drive/v3`, `/upload/drive/v3`, `/token` and `/o/oauth2/v2/auth`. Accepts only an `http` or `https` URL whose host is `127.0.0.1`, `localhost` or `[::1]`, with no user name or password; otherwise `gmail.base-url-not-loopback`. An empty value counts as unset. Read by `fetch`, `auth`, `import`, `build --target sheets`, `update` and both scripts. Intended for tests against a local fake. |

`install`, `uninstall` and `status` also read `PATH`, to find the `node` entries that choose the pinned node path. No other `process.env` variable is read in `src/` or `scripts/`. The credential directory is `os.homedir()/.config/job-alert-harvester`, and the plist directory is `os.homedir()/Library/LaunchAgents`; `XDG_CONFIG_HOME` is not read.

## Files and directories

| Path | Mode | Written by | Read by | Content |
|---|---|---|---|---|
| `.cache/messages/<YYYY-MM>/<id>.json` | default | `fetch`, `ingest`, `update` (through its fetch) (atomic, via `.tmp`) | `build`, `fetch`, `ingest`, `update`, rebuild form, parity script | One message: `date`, `id`, `plaintextBody`, `sender`, `snippet`, `subject`. |
| `.cache/coverage.json` | default | `fetch`, `ingest --complete`, `update` (through its fetch) (atomic, via `.tmp`) | `plan-fetch`, `fetch`, `ingest`, `update`, `install` (for the baseline warning only) | JSON array of covered intervals: `source`, `from`, `to`, `completedAt`, `messageCount`. Adjacent and overlapping intervals merge. |
| `.cache/update.lock` | default | `update` (exclusive create, removed on exit) | `update` (a real run) | The holder's process id as decimal digits, no newline. A lock whose process is dead is stale and is replaced. A file that does not hold digits is `lock.unreadable`. A `--dry-run` neither reads nor writes it. |
| `.cache/update.lock.probe` | default | `update` (a real run, at start-up) | `update` | A transient file the start-up check creates and removes beside the lock. |
| `.cache/receipts/<epoch-ms>-<uuid>.json` | default | `build` merge | `build` with `--merge` | `targetPath`, `inputDigest`, `outputDigest`, `appliedAt`. |
| `~/Library/LaunchAgents/local.job-alert-harvester.update.plist` | 0644 | `install` (atomic, via `.tmp`); removed by `uninstall` | `install`, `uninstall`, `status`, launchd | The LaunchAgent, as in [What the generated files contain](#what-the-generated-files-contain). |
| `.cache/launchd/update.sh` | 0755 | `install` (atomic, via `.tmp`); removed by `uninstall` | `install`, `uninstall`, `status`, launchd (through the plist) | The wrapper script. The folder `.cache/launchd/` is created by `install`; whether `uninstall` leaves it is not specified. |
| `.cache/logs/update.out.log` | set by launchd | launchd (appended, never rotated) | `status` | The stdout of each scheduled `update`. `install` creates the folder `.cache/logs/`; `uninstall` leaves the logs. |
| `.cache/logs/update.err.log` | set by launchd | launchd (appended, never rotated) | `status` | The replayed stderr of each scheduled `update`. |
| `~/.config/job-alert-harvester/` | exactly 0700 | you; must exist before `auth` (which reads `client.json` first) | every credentialed command | The files below. |
| `.../client.json` | no group or other bits (use 0600) | you | `auth`, `fetch`, `import`, `build --target sheets`, `update`, live scripts | Desktop OAuth client, with an `installed` object. Never written by the harvester. |
| `.../token.json` | 0600 | `auth` | `fetch`, `update` (not `--dry-run`), parity script | Gmail refresh token and mailbox address. |
| `.../sheets-token.json` | 0600 | `auth --target sheets` | `import`, `build --target sheets`, `update` | `drive.file` refresh token. |
| `.../sheets-target.json` | 0600 | `import` | `build --target sheets`, `update` | Id of the tracker Sheet. |
| `.../sheets-live-check-token.json` | 0600 | live-check script | live-check script | Throwaway token for the script. |

A credential file that is a symlink, or is unreadable JSON, is refused. `*.xlsx` and `.cache/` are gitignored.

## npm scripts

| Script | Runs |
|---|---|
| `npm run harvest -- <args>` | `node src/cli/harvest.mjs <args>` |
| `npm test` | `vitest run`, after `pretest` |
| `npm run pretest` | `npm run check:arch` |
| `npm run check:arch` | `depcruise src --config .dependency-cruiser.cjs` |
| `npm run test:watch` | `vitest` |
