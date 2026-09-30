# CLI reference

Doc type: Reference

Source of truth: `src/cli/harvest.mjs` and the modules it wires, and the two files in `scripts/`. Checked against commit e077171. Refusal codes are in [refusals.md](refusals.md).

## Invocation

```text
node src/cli/harvest.mjs <subcommand> [options]
node src/cli/harvest.mjs --in <dir> --out <file.xlsx>
npm run harvest -- <subcommand> [options]
```

Subcommands: `plan-fetch`, `ingest`, `build`, `fetch`, `auth`, `import`. Any first argument that is not one of these selects the rebuild form (`--in`, `--out`).

## Argument parsing

| Rule | Behaviour |
|---|---|
| Option syntax | `--name value` or `--name`. `--name=value` is not supported. |
| Flag versus value | A `--name` followed by a token that does not start with `--` takes that token as its value. Otherwise it is a flag. A flag such as `--dry-run` or `--complete` must therefore be last or be followed by another `--option`. |
| Unknown options | Ignored without error. |
| Positional tokens | Ignored without error. |
| Working directory | `.cache/` paths resolve against the current directory. |
| Dates | `YYYY-MM-DD`, read as UTC days. Other formats are unsupported. |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success, including "already covered", "fully covered" and "nothing settled to fetch". |
| 1 | Any refusal or error in a subcommand or the rebuild form. |
| 2 | Rebuild form without `--in` or `--out` (usage text on stderr). |

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
| Writes | `--out`, overwritten if it exists and never read. Tab order `Sources`, `Companies`, `Jobs`. Human-owned columns are blank. |
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
| Required combinations | `--merge` and `--out` must resolve to the same path. Create refuses an existing `--out`. Create and merge refuse an empty cache. `--dry-run` does not. `--target` other than `sheets` is refused. |
| Reads | The whole of `.cache/messages/` (absent reads as empty); the `--merge` file; `.cache/receipts/*.json` (with `--merge`, including `--dry-run`). |
| Writes | Create: `--out`. Merge: `--out`, replaced atomically through a `<file>.tmp-<pid>-<ms>` sibling, then `.cache/receipts/<epoch-ms>-<uuid>.json`. Preview: the report only. |
| Network | None. |
| Stdout, create | `harvest build: created a new workbook`, `  rows appended: <n>`, `  cells written: <n>`. |
| Stdout, merge | `harvest build: merged`; per tab `  <tab>: rows updated: <n>, rows appended: <n>, columns appended: <n>, cell changes: <n>`; `  cells written: <n>`. |
| Stdout, preview | Per tab: `harvest build --dry-run: plan for tab "<tab>"` then `columns to append`, `rows to update`, `rows to append`, `cell changes`. |
| Stderr | `harvest build: <n> derived correction(s):` then one `<tab>\t<key>\t<column>: <before> -> <after>` line each, or `harvest build: no derived corrections (<n> sighting bookkeeping change(s))`. The stale warning: `harvest build: <file> still matches what we last wrote -- this looks like a stale download, so edits made in the sheet since may be lost`. Refusals. |
| Exit codes | 0, 1. The stale warning does not change the exit code. |
| Notes | Sighting bookkeeping columns: `First Seen`, `Last Seen`, `Times Seen`, `Jobs Seen`, `Messages`, `Jobs Found`. The report lists every changed cell; the stderr summary lists corrections only. A missing `--merge` file raises a raw `ENOENT`. |

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

## Environment variables

| Name | Default | Effect |
|---|---|---|
| `HARVEST_API_BASE_URL` | unset (Google endpoints) | Redirects every Google endpoint to `<origin>/gmail/v1`, `/sheets/v4`, `/drive/v3`, `/upload/drive/v3`, `/token` and `/o/oauth2/v2/auth`. Accepts only an `http` or `https` URL whose host is `127.0.0.1`, `localhost` or `[::1]`, with no user name or password; otherwise `gmail.base-url-not-loopback`. An empty value counts as unset. Read by `fetch`, `auth`, `import`, `build --target sheets` and both scripts. Intended for tests against a local fake. |

No other `process.env` variable is read in `src/` or `scripts/`. The credential directory is `os.homedir()/.config/job-alert-harvester`; `XDG_CONFIG_HOME` is not read.

## Files and directories

| Path | Mode | Written by | Read by | Content |
|---|---|---|---|---|
| `.cache/messages/<YYYY-MM>/<id>.json` | default | `fetch`, `ingest` (atomic, via `.tmp`) | `build`, `fetch`, `ingest`, rebuild form, parity script | One message: `date`, `id`, `plaintextBody`, `sender`, `snippet`, `subject`. |
| `.cache/coverage.json` | default | `fetch`, `ingest --complete` (atomic, via `.tmp`) | `plan-fetch`, `fetch`, `ingest` | JSON array of covered intervals: `source`, `from`, `to`, `completedAt`, `messageCount`. Adjacent and overlapping intervals merge. |
| `.cache/receipts/<epoch-ms>-<uuid>.json` | default | `build` merge | `build` with `--merge` | `targetPath`, `inputDigest`, `outputDigest`, `appliedAt`. |
| `~/.config/job-alert-harvester/` | exactly 0700 | you; must exist before `auth` (which reads `client.json` first) | every credentialed command | The files below. |
| `.../client.json` | no group or other bits (use 0600) | you | `auth`, `fetch`, `import`, `build --target sheets`, live scripts | Desktop OAuth client, with an `installed` object. Never written by the harvester. |
| `.../token.json` | 0600 | `auth` | `fetch`, parity script | Gmail refresh token and mailbox address. |
| `.../sheets-token.json` | 0600 | `auth --target sheets` | `import`, `build --target sheets` | `drive.file` refresh token. |
| `.../sheets-target.json` | 0600 | `import` | `build --target sheets` | Id of the tracker Sheet. |
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
