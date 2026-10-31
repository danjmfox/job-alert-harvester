# Slice 04: The 05:30 update brings both sources into the Sheet

Story: US-04 (morning update brings both) in `../feature-delta.md`. Job: J-003 (have the tracker current without attention). Estimate: 1 day.

## Goal
`harvest update` fetches every registered source, builds the Sheet once if all fetches succeeded, and reports per source, so the scheduled run delivers Welcome to the Jungle adverts with no manual step.

## Why fourth
It is the only slice that touches the live schedule. Premise P4: `update` is wired to LinkedIn at both call sites, and a source with no ledger refuses (`update.no-baseline`). A careless change would fail every morning, or fetch one source and build a Sheet with a gap in the other.

## Learning hypothesis
Disproves: that DR-0016's fail-closed sequence extends to several sources unchanged. Fails if one source's failure still lets a build run, if the first run for a new source guesses a start day, or if LinkedIn's morning behaviour changes.
Confirms: that one scheduled command is enough for both senders.

## IN scope
- Fetching each registered source in turn before one build (OQ-08 recommends looping).
- Any source failing or fetching partially: exit 1, no build, committed days kept.
- A new source with no ledger and no start day: refuse before any fetch, name the source.
- `--dry-run`: per-source range and uncovered days, no Gmail call, no write.

## OUT of scope
- Changing the schedule, the plist or `install` (DR-0018, install generates the scheduler files).
- Per-stage exit codes (DR-0016 Exceptions).
- Notification changes.

## Production data
Acceptance scenarios use the Gmail and Sheets loopback fakes with redacted fixtures. Dogfood: Dan seeds the new source once with an explicit start day, runs `harvest update --dry-run`, then one real `harvest update`, and the following 05:30 run unattended.

## Done when
Five scenarios of US-04 pass; the first unattended 05:30 run after merge adds Welcome to the Jungle rows and leaves LinkedIn's daily additions unchanged.

## Dependencies
Slice 03 (fetch). OQ-08 (`update` and a second source). The job runs whatever `main` holds (DR-0018): merge only on green.

## Effort and reference class
1 day. Reference: `update-subcommand`, which was a single feature of similar shape.

## Privacy
Logs under `.cache/logs/` are gitignored and carry ids and counts only. No raw body, token or tracking link in any committed file.
