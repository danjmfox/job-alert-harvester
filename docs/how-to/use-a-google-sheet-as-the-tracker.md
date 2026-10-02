# Use a Google Sheet as the tracker

Doc type: How-To

Goal: import your tracker `.xlsx` once as a native Google Sheet that the harvester creates, then build into that Sheet directly.

## Before you start

- You have a current tracker `.xlsx` with a `Jobs` tab that has a `Dedup Key` column. To get one from an existing Sheet, follow merge step 1 in [Build the tracker workbook](build-the-tracker-workbook.md).
- The Google Sheets and Google Drive APIs are enabled and the `drive.file` scope is on the consent screen (see [Set up Google Cloud credentials](set-up-google-cloud.md)).
- The cache holds mail (see [Fetch new mail](fetch-new-mail.md)).
- You run commands from the repository root.

## Steps

1. Record the Sheets consent, then approve it in the browser:

   ```bash
   node src/cli/harvest.mjs auth --target sheets
   ```

2. Import the tracker:

   ```bash
   node src/cli/harvest.mjs import --from tracker.xlsx
   ```

   Expected output: `import: created Sheet <spreadsheet-id>`. The Sheet takes the file's name (`tracker.xlsx`) and lands in the Drive of the account that consented.

3. **Yours to do (browser):** Open the new Sheet in Google Drive and check that the tabs and your typed columns are as you expect.

4. Preview a build into the Sheet. Nothing is written:

   ```bash
   node src/cli/harvest.mjs build --target sheets --dry-run --report .cache/changes.txt
   ```

5. Build into the Sheet:

   ```bash
   node src/cli/harvest.mjs build --target sheets --report .cache/changes.txt
   ```

   Expected output starts with `harvest build: merged` and ends with `cells written: <n>`.

6. From now on, type into this Sheet only. The old `.xlsx` file and any older copy in Drive are no longer updated.

7. **Yours to do (browser):** Download the Sheet as `.xlsx` on a regular schedule (File, Download, Microsoft Excel (.xlsx)) and keep the file. This is your backup.

Repeat steps 4 and 5 after each [fetch](fetch-new-mail.md).

## Why

**What `import` does.** It refuses if a Sheet is already recorded, checks the workbook, uploads it as a native Sheet through Drive, reads the Sheet back and compares tabs, headers, row counts and key sets with the workbook, then records the Sheet's id in `~/.config/job-alert-harvester/sheets-target.json`. If the comparison or the record fails, it deletes the Sheet it just created, or names the Sheet's id so you can delete it by hand. The workbook check refuses a missing `Dedup Key` column on `Jobs`, missing key columns on `Companies` (`Company`) or `Sources` (`Source` and `Search Term`), a `Jobs` header with no recognised column, and any duplicate key.

**Why an import.** With the `drive.file` scope the harvester can only edit Sheets it created, and the Sheets API cannot edit an `.xlsx` in place. See DR-0012 (Sheets target under drive.file).

**The Sheet is the only copy.** The harvester never deletes anything, but a deleted Sheet or a revoked `drive.file` grant leaves your typed columns with no other copy. Hence the backup in step 7.

**No `--out` or `--merge`.** `build --target sheets` refuses to run together with `--out` or `--merge`, which name an offline workbook. The stale-download warning and receipts belong to the `.xlsx` path and are not used here.

**Accepted residual risk.** Between the fresh read and the single write, about a second, a sort, insert or delete of rows in the Sheet by a human can send a write for a harvester-owned column to another row. The harvester never writes human-owned columns or key cells, so your typed cells are never overwritten. Google offers no revision check that would close the gap. Do not edit the Sheet while a build runs.

**Limits found in live testing.** Google allows about 60 write requests per minute per user; a build normally sends one write request, and up to three attempts if Google answers with a rate limit or a server error. A request of 9 MB was accepted, and the harvester refuses a request larger than 9 MiB. Google's server does not protect against stale writes. See DR-0012 (Sheets target under drive.file) and `docs/feature/sheets-api-target/deliver/live-findings.md`.

**Before the first build that adds `Role Family`.** Check your Sheet's `Jobs` header for a column you typed called `Role Family`; the harvester would treat it as its own and overwrite it (`--dry-run` shows `columns to append: 0` if one exists). Then run `node scripts/sheets-live-check.mjs --only S1` (see [Run the checks](run-the-checks.md)) to confirm Google accepts about 3,050 single-cell updates in one batch. The first build appends the column at the far right of your header, widening the grid if it is exactly as wide as the header.

**What has been verified.** On 2026-09-30 the first real `auth --target sheets`, `import`, and both a dry run and a real `build --target sheets` ran against the operator's own Sheet. Both builds reported 0 cell changes, because the imported tracker already matched the cache. Later the same day the operator backfilled mail and merged it month by month, ending at 3,050 `Jobs`, 1,275 `Companies` and 16 `Sources` rows with a final re-run that reported 0 changes, so the paths that update existing cells and append new rows have run on real data. The typed columns were not compared before and after. Read the `--dry-run` plan and the `--report` file before trusting a large merge.

## If it goes wrong

Refusals print as `code: detail` on stderr with exit status 1. The full list is in the [refusals reference](../reference/refusals.md).

| You see | Do this |
|---|---|
| `sheets.credential-missing`, `sheets.credential-invalid`, `sheets.credential-permissions` | Run `auth --target sheets` and check the directory modes ([Set up Google Cloud credentials](set-up-google-cloud.md)). |
| `sheets.reauth-required: run harvest auth --target sheets` | Run `node src/cli/harvest.mjs auth --target sheets`. |
| `import.already-imported` | A Sheet is already recorded, and there is no command to import again. Use `build --target sheets`. Deleting `~/.config/job-alert-harvester/sheets-target.json` would allow another import and leaves the old Sheet in Drive; no decision record describes that procedure. |
| `import.file-missing`, `import.not-a-workbook` | `--from` names no readable `.xlsx` file. |
| `import.no-dedup-key-column`, `import.key-column-missing`, `import.unrecognised-headers`, `import.duplicate-key` | The workbook failed the check named in the detail (tab, key). Fix the workbook and import again. Nothing was created. |
| `import.conversion-mismatch` | Google's conversion changed tabs, headers, row counts or keys. The created Sheet was deleted. Try again; if it repeats, stop and report it. |
| `import.record-failed` | The Sheet was created but its id could not be saved. Delete the Sheet named in the message if one is named, then run `import` again. |
| `drive.storage-full` | Your Drive has no free space. |
| `sheets.not-imported: run harvest import --from <tracker.xlsx>` | Complete step 2 first. |
| `sheets.spreadsheet-unreadable` | The recorded Sheet is deleted, or not visible to this credential. A file the app did not create answers as not found. |
| `sheets.spreadsheet-trashed` | Restore the Sheet from the Drive bin. |
| `sheets.duplicate-key` | Two rows carry the same key in one tab. Delete one by hand; the whole build was refused. |
| `sheets.tab-missing`, `sheets.key-column-missing`, `sheets.duplicate-header`, `sheets.header-changed` | A header the harvester relies on was renamed, removed or repeated. Restore it, and run the build again. |
| `sheets.plan-too-large` | The change exceeds 9 MiB even after skipping unchanged cells. The harvester does not split it; report it. |
| `sheets.apply-outcome-unknown` | Google did not confirm the write. Run the build again; it will not append twice. |
| `sheets.quota-exhausted` | Wait a minute and run the build again. |
| `build.target-conflict` | Remove `--out` and `--merge` from a `--target sheets` command. |
| `build.unknown-target` | `--target` accepts only `sheets`. |
