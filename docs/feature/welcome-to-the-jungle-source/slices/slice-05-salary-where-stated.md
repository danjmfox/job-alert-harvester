# Slice 05: A stated salary appears in the Sheet

Story: US-05 (salary where stated) in `../feature-delta.md`. Job: J-001 (capture every advertised job in one tracker). Estimate: 0.5 day. Can ship after, or apart from, slices 01 to 04.

## Goal
A card that states a sterling salary fills `Min Salary (annual)` and `Max Salary (annual)`; every other form leaves them blank and the row still exists.

## Why last
It is independent of the pipeline, it carries the lowest risk, and `Salary above your minimum` has no figure whatever is built. It shares the title, salary and location boundary with slice 01, so it is cheaper after that boundary is understood.

## Learning hypothesis
Disproves: that the four observed salary forms can be told apart reliably from the plain text. Fails if a title containing a number is read as a salary, or if a non-sterling figure lands in a column that reads as pounds.
Confirms: that leaving non-sterling blank is acceptable for Dan's triage (OQ-03, non-GBP salary).

## IN scope
- `£N K` and `£N-M K` into the annual columns.
- `$`, `€`, `Salary above your minimum` and absence: blank cells.
- Salary text never alters Job, Company or the dedup key.

## OUT of scope
- A currency column or any header change (a column-ownership decision, DR-0004).
- Hourly and day rates. Converting currencies.

## Production data
The slice-01 redacted fixture plus one redacted card per observed form. Dogfood: the rebuild command on Dan's scratch folder, comparing each salary against the email by eye.

## Done when
Four scenarios of US-05 pass and Dan's dogfood run agrees with the emails.

## Dependencies
Slice 01. OQ-03 (non-GBP salary).

## Effort and reference class
0.5 day. Reference: the existing LinkedIn card-salary parser (`parseCardSalaryLine`).

## Privacy
Fixture cards are redacted. No raw body, token or tracking link.
