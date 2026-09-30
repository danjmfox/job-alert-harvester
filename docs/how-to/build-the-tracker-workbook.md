# Build the tracker workbook

Doc type: How-To

Goal: install the harvester, then create or update the three-tab tracker `.xlsx` (`Jobs`, `Companies`, `Sources`) from the local cache without touching the columns you type into.

If your tracker is a Google Sheet that the harvester writes to directly, use [Use a Google Sheet as the tracker](use-a-google-sheet-as-the-tracker.md) instead.

## Install and run offline

1. Check that Node is version 22 or later:

   ```bash
   node --version
   ```

2. Install the dependencies from the repository root:

   ```bash
   npm install
   ```

3. Build a workbook from the bundled sample emails. This needs no credential and no network:

   ```bash
   node src/cli/harvest.mjs --in fixtures/linkedin --out first-run.xlsx
   ```

   Expected output:

   ```text
   harvested 5 messages -> <n> jobs, <n> companies, <n> saved searches
   wrote first-run.xlsx
   ```

4. Open `first-run.xlsx` and confirm it has the tabs `Sources`, `Companies` and `Jobs`. Delete the file when done; `.xlsx` files are gitignored.

To see the usage text, run `node src/cli/harvest.mjs` with no arguments. It prints a `usage:` block on stderr and exits with status 2.

## Create a new tracker from the cache

Use this when you have no tracker yet. The cache must hold mail (see [Fetch new mail](fetch-new-mail.md)).

1. Run:

   ```bash
   node src/cli/harvest.mjs build --out tracker.xlsx
   ```

2. Confirm the last lines read `harvest build: created a new workbook`, then the row and cell counts.

The command refuses to overwrite an existing `--out` file. To update a tracker that exists, use the next section.

## Merge into your existing tracker

1. **Yours to do (browser):** If the tracker lives in Google Sheets, download a fresh copy as `.xlsx` and save it as `tracker.xlsx` in the repository root. In Google Sheets this is File, Download, Microsoft Excel (.xlsx).

2. Preview the merge. This writes nothing except an optional report:

   ```bash
   node src/cli/harvest.mjs build --out tracker.xlsx --merge tracker.xlsx --dry-run
   ```

3. Read the plan. It prints, per tab, the columns to append, rows to update, rows to append and cell changes.

4. Run the merge and write a report of every changed cell:

   ```bash
   node src/cli/harvest.mjs build --out tracker.xlsx --merge tracker.xlsx --report .cache/changes.txt
   ```

5. Read the stderr summary. It separates **derived corrections** (a value the parser now reads differently) from **sighting bookkeeping** (`First Seen`, `Last Seen`, `Times Seen`, `Jobs Seen`, `Messages`, `Jobs Found`, which move whenever an advert is seen again). `changes.txt` lists both, one line per cell: tab, key, column, before, after.

6. **Yours to do (browser):** Upload `tracker.xlsx` back to Google Sheets to replace your tracker.

## Rebuild a workbook from a directory

1. Run with `--in` and a new `--out` path:

   ```bash
   node src/cli/harvest.mjs --in .cache/messages --out rebuilt.xlsx
   ```

2. Use a path that does not exist. This form refuses when `--out` already exists (`build.out-exists: --out <path> already exists; the rebuild form never overwrites`) and never reads an existing workbook. To update a tracker that exists, use `build --out <file> --merge <file>` from the previous section.

## Why

**Same file for `--merge` and `--out`.** The merge reads and preserves its own target, so writing to a different file would drop the tracker's contents. See DR-0005 (target sheet as port).

**Human columns survive.** Every column has one owner. The merge overwrites only harvester-owned columns and never writes `Status`, `Applied on Date`, `Qualified?` or any column it does not recognise. See DR-0004 (one owner per column).

**Whole cache.** `build` derives every row from the whole cache, so a parser fix reaches your whole history on the next merge. See DR-0009 (build uses whole cache).

**The stale-download warning.** The build compares the target file with the last file it wrote for that path. A match means you merged into your own previous output, so anything typed in Google Sheets since then is missing from this file. The build warns and proceeds. Google Sheets re-encodes a workbook on download, so a real download-and-upload cycle does not trigger it.

## If it goes wrong

Only some of these carry a code. The full list of codes is in the [refusals reference](../reference/refusals.md).

| You see | Do this |
|---|---|
| `harvest build: the cache is empty — refusing to write an empty tracker` | Fetch mail first ([Fetch new mail](fetch-new-mail.md)). |
| `build.out-exists: --out <file> already exists; pass --merge <file> to merge into it` | Add `--merge <file>` naming the same file, or choose a new `--out`. |
| `harvest build: --merge and --out must name the same file` | Make both flags name one path. |
| `harvest build: <file> still matches what we last wrote -- this looks like a stale download` (stderr warning, the build continues) | The merge has already run on a file that lacks your recent edits. Do not upload the result. Download a fresh copy from Google Sheets (merge step 1), then run the merge again. |
| `target.not-a-workbook` | The `--merge` file is not an `.xlsx` (for example, an HTML page saved by a browser). Download it again. |
| `target.no-dedup-key-column` | The `Jobs` tab has no `Dedup Key` header. Restore the header or download a fresh copy. |
| `target.not-writable` | The folder of `--out` is missing or not writable. |
| `build.unknown-target` | `--target` accepts only `sheets`. |
| `harvest: --in <dir> does not exist`, or `holds no message JSON` | Point `--in` at a directory of message JSON files. |
| A raw `ENOENT` error naming your file | The `--merge` file does not exist at that path. |
