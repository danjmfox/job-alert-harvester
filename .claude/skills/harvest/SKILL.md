---
name: harvest
description: Thin courier skill that drives Gmail search and fetch through the connector, stages spilled results by path, and invokes the harvest CLI to ingest them. Carries no record content — see DR-0003 and DR-0007.
---

# Harvest skill

This skill drives the LinkedIn job-alert harvest. It is a thin courier: it invokes only the harvest CLI's `plan-fetch` and `ingest` verbs, plus the Gmail connector's search and fetch tools, and it moves files by path. It holds no domain knowledge — field extraction stays in the CLI and core, never here. It never opens, quotes, or summarizes a spill file's contents (DR-0003 Rule 1), and it never parses a message body.

## Loop until fully covered

Repeat the following steps, in order, until `plan-fetch` reports the range is fully covered. There is no other stopping condition:

1. Run `plan-fetch` for the requested range to get the next uncovered window.
2. If `plan-fetch` reports the range is fully covered, stop — the harvest is complete.
3. Otherwise, fetch that window (Gmail search + fetch, below), stage its files, and run `ingest`.
4. Loop back to step 1.

```
# invokes only: harvest plan-fetch, harvest ingest
node src/cli/harvest.mjs plan-fetch --source linkedin --from <range-from> --to <range-to> --batch <n>
```

`plan-fetch` prints either the next window (`<from>..<to> batch=<n>`) or a message that the range is fully covered — that message is the only stop condition for the loop above.

## Querying Gmail for a window

Treat every Gmail message id as a fetch hint only — pass it to the connector to fetch, but never use it as a key or as data. Each cached record is keyed only by the id found inside its own payload, not by the id you supplied.

Compute the window's after:/before: bounds as Unix epoch seconds at UTC midnight — never YYYY/MM/DD local dates. before: is UTC midnight of the day after the window's `to` day, because the adapter windows by the UTC day of each message.

Search with `search_threads`, query `from:jobalerts-noreply@linkedin.com after:<epoch-seconds> before:<epoch-seconds>`. Follow every `pageToken` until no further page is returned — `resultCountEstimate` is not reliable. Collect every message id, across every thread, whose date falls inside the window.

Fetch each collected id with `get_message`, messageFormat: FULL_CONTENT, so the result spills to disk.

## Staging a window's spill files

The connector writes each fetched result into a shared tool-results directory, named mcp-*-get_message-*.txt — that directory also holds unrelated tool output and prior windows' files. For this window: create a fresh, per-window directory, and move only the files reported for this window's fetches into it, by the paths the connector reported. Never glob the shared directory for a window's files.

Pass that fresh directory as --raw to `ingest`.

## Handling an inline result

If a fetch returns the message inline instead of a saved path, do not transcribe or copy it — stop the window without --complete and report which message id came back inline. Do not stage a partial window as complete, and do not retry by editing anything.

## Completing a window

`ingest --window` is exactly the window `plan-fetch` returned in step 1 — never the requested `--from`/`--to` range. Pass --complete only once every page is exhausted and every collected message id for the window has been fetched and staged, with --expect equal to the number of messages fetched for the window:

```
# invokes only: harvest plan-fetch, harvest ingest
node src/cli/harvest.mjs ingest --raw <window-dir> --window <window-from>..<window-to> --expect <n> --complete
```

If a window stopped early on an inline result, still run `ingest` for what was staged, but withhold --complete and report the stop. `ingest` is safe to re-run later — it skips already-cached ids, so a resumed window merges cleanly. If `ingest` refuses, report its stderr verbatim and stop; do not retry by editing anything.

## Boundaries

- Never open, quote, or summarize a spill file's contents (DR-0003 Rule 1). Data moves by filesystem path only.
- Pass only control-value flags: --source, --from, --to, --batch, --raw, --window, --expect, --complete. `ingest` takes no --source flag; it always records `linkedin`.
- Never run `build` — producing the workbook is not this skill's job.
- No domain knowledge here: no parsing, no dedup, no field extraction. Field extraction stays in the CLI and core.
