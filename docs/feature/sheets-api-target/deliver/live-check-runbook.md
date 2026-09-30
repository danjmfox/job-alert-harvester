# Live check runbook: sheets-api-target

Doc type: How-To. Goal: confirm or refute API assumptions A1-A19 (Fake Fidelity Ledger L01-L20) against real Google, about 10 minutes.

## Prerequisites

- GCP project of the Internal Desktop OAuth client (DR-0011) has the **Google Sheets API** and **Google Drive API** enabled.
- Consent screen lists scope `https://www.googleapis.com/auth/drive.file`.
- `~/.config/job-alert-harvester/client.json` exists (the same client file `harvest auth` uses).
- `npm install` done; a browser on this machine.

## Command

```
node scripts/sheets-live-check.mjs
```

Open the printed consent URL, approve `drive.file`, wait for the table. Offline dry run first, if wanted: `node scripts/sheets-live-check.mjs --self-test`.

## Narrow re-run

After the first full run, `node scripts/sheets-live-check.mjs --only A12,A14` re-runs only the named A-ids or L-ids (comma-separated), plus any probe they depend on. It creates and deletes a scratch Sheet as above and merges its new bodies into the existing `live-fixtures.json`.

- A12 answers whether `GET /drive/v3/files/generateIds` is allowed under `drive.file` (the first run used a wrong path).
- A14 answers the write quota, and captures why 4 of 6 metadata chunks of 500 rows returned 400.

## What it creates and deletes

- Creates one scratch native Sheet named `harvester-live-check-<timestamp>` in your Drive, imported from a synthetic workbook (never your tracker; it never reads your tracker or `.cache/`).
- Writes only into that Sheet. Uses a throwaway token slot, `~/.config/job-alert-harvester/sheets-live-check-token.json` (0600), not the real Sheets token slot.
- Deletes exactly that file at the end, even when a probe fails. If the last lines say the Sheet was NOT deleted, delete the file of that name from Drive by hand.
- Writes redacted real response bodies to `docs/feature/sheets-api-target/deliver/live-fixtures.json` (no token, id or email address).

## If it stops early

- `HINT: enable the Google Sheets API` or `Drive API`: enable it in the GCP project, rerun.
- `HINT: drive.file is missing from the consent screen`: add the scope under Data Access, rerun.

## Paste back

The `| id | verdict | evidence |` table (A1-A19, L01-L20) and the last two lines (`scratch Sheet deleted`, `fixtures written`). It holds no token, client secret or id. Verdicts: WORKS = Google behaves as the fake and the design assume; DOESN'T WORK = it differs (a finding, not a script failure); NOT TESTED = the probe could not observe it (for example a 429 that was not provoked).
