# Slice 05: A stated salary appears in the Sheet

Story: US-05 (salary where stated) in `../feature-delta.md`. Job: J-001 (capture every advertised job in one tracker). Estimate: 0.25 to 0.5 day. Release R1 (rows offline) by the human's cut, after slice 01b. Still separable from every other slice.

## Goal
A card that states a sterling salary fills `Min Salary (annual)` and `Max Salary (annual)`; every other form leaves them blank and the row still exists.

## Why small and separable
It is independent of the pipeline, it carries the lowest risk, and `Salary above your minimum` has no figure whatever is built. It is cheap after slice 01b because salary is always its own line on the card, never joined to the location. A card with two lines has salary first and location second; a card with one line has location only.

## Learning hypothesis
Disproves: that the six observed salary forms (absent, `Salary above your minimum`, dollar range, sterling range, single sterling figure, euro range) can be told apart reliably. Fails if a title containing a number is read as a salary, if the salary line is read as the location, or if a non-sterling figure lands in a column that reads as pounds.
Confirms: that leaving non-sterling blank is acceptable for Dan's triage (OQ-03, non-GBP salary).

## IN scope
- `£N K` and `£N-M K` into the annual columns.
- `$`, `€`, `Salary above your minimum` and absence: blank cells.
- Salary text never alters Job, Company or the dedup key. The raw salary text stays on the row (DDD-14, sterling only).
- The location is kept whether or not a salary is stated.

## OUT of scope
- A currency column or any header change (a column-ownership decision, DR-0004).
- Hourly and day rates. Converting currencies.

## Production data
The slice-01b synthetic fixture plus one synthetic card per salary form (six). Dogfood: the rebuild command on Dan's scratch folder, comparing each salary against the email by eye.

## Done when
Five scenarios of US-05 pass and Dan's dogfood run agrees with the emails.

## Dependencies
Slice 01b (the card reader). OQ-03 (non-GBP salary) stands as recommended; DDD-14 agrees.

## Effort and reference class
0.25 to 0.5 day. Reference: the existing LinkedIn card-salary parser (`parseCardSalaryLine`), of which only the salary arithmetic is reusable.

## Privacy
Fixture cards are synthetic. No real body, token or tracking link.
