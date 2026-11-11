# Slice 04: The 05:30 update brings both sources into the Sheet

Story: US-04 (morning update brings both) in `../feature-delta.md`. Job: J-003 (have the tracker current without attention). Estimate: 1 to 1.5 days. Release R3 (unattended), which ends with a human review stop.

## Goal
`harvest update` fetches every registered source, builds the Sheet once if all fetches succeeded, and reports per source, so the scheduled run delivers Welcome to the Jungle adverts with no manual step.

## Why last
It is the only slice that touches the live schedule, and it is its own release. Premise P4: `update` is wired to LinkedIn at both call sites, and a source with no ledger refuses (`update.no-baseline`). A careless change would fail every morning, or fetch one source and build a Sheet with a gap in the other.

## Learning hypothesis
Disproves: that DR-0016's fail-closed sequence extends to several sources unchanged. Fails if one source's failure still lets a build run, if the first run for a new source guesses a start day, or if LinkedIn's morning behaviour changes.
Confirms: that one scheduled command is enough for both senders.

## IN scope
- Planning every source first, then fetching each in turn before one build. Decided by DDD-12 (`update` loops every source, accepted), which resolves OQ-08 (`update` and a second source). `--from` overrides every source's start.
- Any source failing or fetching partially: exit 1, no build, committed days kept (DDD-17, a source's failure blocks the build). A Welcome to the Jungle template change therefore also stops LinkedIn rows that morning.
- A new source with no ledger and no start day: refuse before any fetch, name the source. The refusal text names the source (today it names none).
- `--dry-run`: per-source range and uncovered days, no Gmail call, no write.
- `harvest status` and `install` warn when any fetchable source has no baseline.

## OUT of scope
- Changing the schedule, the plist or `install` (DR-0018, install generates the scheduler files).
- Per-stage exit codes (DR-0016 Exceptions).
- Notification changes.

## Production data
Acceptance scenarios use the Gmail and Sheets loopback fakes with synthetic fixtures. Dogfood: Dan seeds the new source once with an explicit start day, runs `harvest update --dry-run`, then one real `harvest update`, and the following 05:30 run unattended.

## Done when
Six scenarios of US-04 pass; the first unattended 05:30 run after merge adds Welcome to the Jungle rows and leaves LinkedIn's daily additions unchanged.

## Dependencies
Slice 03b (HTML-only fetch). DDD-12 and DDD-17 are accepted. The job runs whatever `main` holds (DR-0018): merge only on green. Existing update acceptance tests that assert the current dry-run line will change.

## Effort and reference class
1 to 1.5 days. Reference: `update-subcommand`, a single feature of similar shape, but this one also changes the install warning and existing tests.

## Privacy
Logs under `.cache/logs/` are gitignored and carry ids and counts only. No raw body, token or tracking link in any committed file.
