# Live findings, Sheets API target (Reference)

> Superseded note (2026-09-30): the results below are Google facts and stay true. Row-key developer metadata, which several rows below describe as part of the design, was retired the same day (DR-0012 v1.4.0); production no longer uses it.

Source: operator run of `scripts/sheets-live-check.mjs` on 2026-09-30 (scratch Sheet, deleted). Real bodies: `live-fixtures.json` (ids, tokens and emails redacted). The fake: `tests/acceptance/sheets-api-target/support/sheets-fake.mjs`; its key shapes are pinned against the fixtures in `sheets-fake.test.mjs`.

## Assumptions A1-A19

| Id | Verdict | Evidence |
|---|---|---|
| A1 | Verified | typed values read back as numbers, booleans, text; interior blank reads `''` |
| A2 | Verified | converted date reads back as its serial number |
| A3 | Verified | `spreadsheets.batchUpdate` with one invalid request among valid ones on two tabs applied nothing; 400 `batchUpdate.invalid` |
| A4 | Verified | `values.batchUpdate` with one invalid range applied nothing; 400 `values.batchUpdate.invalid` |
| A5 | Verified | a cell-level request carrying a data filter is rejected |
| A6 | Verified | 3,000 x 20 (4.5 MB) and 6,000 x 20 (9.0 MB) accepted, HTTP 200; no ceiling found |
| A7 | Verified | write beyond the grid columns refused; `appendDimension` COLUMNS makes room |
| A8 | Verified | `fields=userEnteredValue` keeps formatting; `*` resets it |
| A9 | Verified | `values.batchUpdateByDataFilter` through a row-metadata filter writes the keyed row (`values.batchUpdateByDataFilter`); input for OQ-1 option B, not a reopening |
| A10 | Verified | value up to 20,000 characters accepted, 100,000 refused (400); `PROJECT` and `DOCUMENT` visibility accepted |
| A11 | Verified | `gmail users/me/profile` with a `drive.file` token: 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT` (`gmail.profile`) |
| A12 | Works (narrow re-run, 2026-09-30) | `GET /drive/v3/files/generateIds?count=1` answers 200 `drive#generatedIds`; the first run's HTML 404 was a wrong path in the probe; an optional import hardening, unused |
| A13 | Verified | Sheets and Drive answer 404 for a file the app never created (`error.sheets-not-granted`, `error.drive-not-granted`); real 429 (`error.429`) |
| A14 | Verified (narrow re-run, 2026-09-30) | 429 after about 57 rapid writes (60 per minute per user), no `Retry-After`. The 400s on 4 of 6 metadata chunks: Google answers "Adding the requested developer metadata would exceed the allowed storage limit" (first refused at request 196 of the third 500-row chunk): a per-Sheet cap on developer metadata, about 1,200 entries in the test Sheet |
| A15 | Verified | `appendCells` lands after the last row holding data, grows a full grid |
| A16 | Verified | a leading `=` string reads back as text |
| A17 | Refuted, fake corrected | a second same-key binding on one row is accepted (200); so is a binding on an empty row inside the grid; beyond the grid not measured |
| A18 | Verified | caller `sheetId` honoured; duplicate title or id rejected |
| A19 | Verified | one search returns matches across tabs as ROW locations (`developerMetadata.search`) |

## Measured limits

| Limit | Measured | Applied |
|---|---|---|
| Batch payload | 9.0 MB accepted, no ceiling found | `MAX_BATCH_BYTES` = 9 MiB in `src/core/sheets-requests.mjs` (was 10 MiB) |
| Developer metadata value | 20,000 characters accepted, 100,000 refused (400) | recorded; composite keys are far below |
| Write quota | 60 write requests per minute per user (`WriteRequestsPerMinutePerUser`), 429 after about 57 rapid writes | fake serves the 429 shape; scenarios script when it fires |
| 429 rate reason | `details[0].reason` = `RATE_LIMIT_EXCEEDED`, status `RESOURCE_EXHAUSTED`; no `errors[]`; no `Retry-After` | `retry-policy.mjs` classifies a 429 by status alone, so `RATE_LIMIT_REASONS` (403 reasons) is unchanged; no 403 rate-reason body was observed |
| Not-granted file | 404, not 403 | fake answers 404 |
| Metadata storage | per-Sheet cap: refused at about 1,200 entries in the test Sheet with "would exceed the allowed storage limit" | row-key metadata was retired for this reason (DR-0012 v1.4.0): production no longer creates or reads it |

## Body comparison (L19): every real body against the fake

| Captured body | Verdict | Divergence and action |
|---|---|---|
| `drive.files.create` | Corrected | fake now honours `fields` (`id,name,mimeType`); default keeps `kind` |
| `spreadsheets.get` | Corrected, partly not modelled | added `properties.locale`, `autoRecalc`, `timeZone` and `gridProperties.rowGroupControlAfter`/`columnGroupControlAfter`; `properties.defaultFormat` and `spreadsheetTheme` not modelled (large, never read) |
| `batchUpdate.ok` | Corrected | added `commentUpdateState: NO_UPDATES_REQUESTED`; an `addSheet` reply now carries `properties` (`sheetId`, `title`, `index`, `sheetType`, `gridProperties`); other replies stay `{}` |
| `values.batchGet` | Same (range echo not modelled) | keys match; the fake echoes the requested range rather than Google's normalised one |
| `batchUpdate.invalid` | Corrected | the 400 envelope has `code`, `message`, `status` only; the fake sent an extra `errors[]` |
| `developerMetadata.search` | Same | `locationType`, `dimensionRange`, `visibility`, `dataFilters` echo all match |
| `values.batchGetByDataFilter` | Not modelled | no route; the design does not read through data filters |
| `values.batchUpdate.invalid` | Not modelled | no route (404); atomicity verified live |
| `values.batchUpdateByDataFilter` | Not modelled | no route; verified live, optional hardening |
| `gmail.profile` | Corrected | fake served a 404; now the real 403 body |
| `drive.generateIds` | Not modelled | captured body is an HTML 404 from a wrong path; deferred |
| `drive.files.get` | Corrected | `fields=trashed` returns `{trashed}` only, no `id` |
| `error.429` | Corrected | real quota body with `RATE_LIMIT_EXCEEDED`; `Retry-After` absent unless a scenario passes `retryAfter` |
| `error.sheets-not-granted` | Corrected | 404 `NOT_FOUND`, no `errors[]` |
| `error.drive-not-granted` | Corrected | 404 with `File not found: <id>.`, `errors[0]` `notFound`, `location`, `locationType`, no `status` |

Behaviour corrected outside body shape: developer metadata accepts a duplicate same-key binding and a binding on an empty row inside the grid (L16).
