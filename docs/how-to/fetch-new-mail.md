# Fetch new mail

Doc type: How-To

Goal: copy LinkedIn job-alert emails for a range of days into the local cache (`.cache/messages/`) and record those days as covered.

There are two ways to do it. Use the CLI's own credential unless you have not set one up.

| Path | Use it when | Needs |
|---|---|---|
| CLI fetch (`fetch`) | Normally. | The credential from [Set up Google Cloud credentials](set-up-google-cloud.md). |
| Agent path (the `harvest` skill, `plan-fetch`, `ingest`) | You have no Google Cloud credential and can use the Gmail connector in Claude Code. | The connector, and the skill in `.claude/skills/harvest/`. |

Both paths write the same cache and the same coverage ledger, so you can switch between them.

## Before you start

- Run every command from the repository root. The cache and the ledger resolve relative to the working directory.
- For the CLI path, `node src/cli/harvest.mjs auth` has succeeded once.

## Fetch with the CLI credential

1. Choose the range as UTC calendar days in the form `YYYY-MM-DD`.

2. Run the fetch:

   ```bash
   node src/cli/harvest.mjs fetch --source linkedin --from 2026-09-16 --to 2026-09-28
   ```

3. Read the output. Each day that completes prints one line:

   ```text
   harvest fetch: 2026-09-16..2026-09-16 — 3 message(s)
   ```

   A message that fails a sanity check prints `harvest fetch: quarantined <message-id> (<reason>)` and is not cached.

4. Run the same command again. It prints `harvest fetch: linkedin <from>..<to> is already covered` and makes no request.

5. Continue with [Build the tracker workbook](build-the-tracker-workbook.md).

## Fetch with the agent path

1. In Claude Code, open the repository and ask it to run the `harvest` skill for your range.

2. Let the skill loop until `plan-fetch` reports the range fully covered. The skill runs these two commands, and you can run them yourself:

   ```bash
   node src/cli/harvest.mjs plan-fetch --source linkedin --from 2026-09-16 --to 2026-09-28 --batch 20
   node src/cli/harvest.mjs ingest --raw <window-dir> --window 2026-09-16..2026-09-16 --expect 3 --complete
   ```

3. Check the last `ingest` line: `harvest ingest: cached 3 message(s), skipped 0 duplicate(s), coverage committed for 2026-09-16..2026-09-16`.

4. Do not pass a `--to` day that has not ended. The agent path does not clamp to finished days.

## Why

**One day at a time.** Coverage is recorded per UTC day, so an interrupted run resumes at the first uncovered day. See DR-0002 (coverage intervals, not watermark).

**Clamping.** The CLI moves `--to` back to yesterday (UTC) so a day still receiving mail is never marked covered. If `--from` is later than yesterday it prints `harvest fetch: nothing settled to fetch` and exits with status 0.

**Coverage rule.** A day is committed only after every message Gmail listed for it is cached or quarantined. A quarantined message is logged but not cached, and its day is still committed, so a later fetch does not retry it. A body shorter than 1024 characters, or with no `/jobs/view/` link, is quarantined.

**Why an agent path exists.** The agent only moves file paths and never reads message content. See DR-0003 (agent couriers paths only).

## If it goes wrong

Refusals print as `code: detail` on stderr with exit status 1. Committed days stay committed; run the command again to continue. The full list is in the [refusals reference](../reference/refusals.md).

| You see | Do this |
|---|---|
| `gmail.credential-missing`, `gmail.credential-invalid`, `gmail.credential-permissions` | Repeat the relevant steps in [Set up Google Cloud credentials](set-up-google-cloud.md). |
| `gmail.reauth-required: run harvest auth to authorise again` | The refresh token expired or was revoked. Run `node src/cli/harvest.mjs auth`. |
| `gmail.wrong-mailbox` | The token belongs to a different account from the one recorded by `auth`. Run `auth` again as the mailbox that receives the alerts. |
| `gmail.sender-matches-nothing` | The mailbox holds no mail from the LinkedIn sender. Check you consented as the right account. |
| `gmail.unauthorized` | Gmail refused the request. Check the Gmail API is enabled, then run `auth` again. |
| `gmail.quota-exhausted`, `gmail.server-error` | Gmail stayed unavailable after three attempts. Wait, then run the command again. |
| `gmail.list-incomplete`, `gmail.list-malformed`, `gmail.id-mismatch`, `gmail.outside-window` | Gmail's answer failed a consistency check and the day was not committed. Run the command again; if it repeats, stop and report it. |
| `gmail.missing-plaintext-body` | A message has no plain-text part. No option skips it, so the fetch stops at that day. |
| `fetch.message-not-cached`, `fetch.unreadable-message`, `fetch.window-did-not-advance` | The count check failed and the day was not committed. Run the command again; if it repeats, stop and report it. |
| `fetch.unknown-source` | Use `--source linkedin`, the only source. |
| `coverage.interval.inverted` | `--to` is earlier than `--from`. |
| `ledger.unreadable` | `.cache/coverage.json` is not valid JSON. Restore it. Deleting it makes every day uncovered again; cached messages are skipped on the next fetch. |
| `spill.count-mismatch` (agent path) | The `--raw` directory holds a different number of `mcp-*-get_message-*.txt` files from `--expect`. Stage only this window's files and pass the exact count. |
| `spill.directory-absent`, `spill.not-json`, `spill.not-a-message`, `spill.missing-plaintext-body`, `spill.outside-window` (agent path) | A staged file is missing, malformed or dated outside `--window`. Nothing was ingested; fix the staging and run `ingest` again. |
