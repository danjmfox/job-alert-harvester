# job-alert-harvester

Doc type: Explanation, with a signpost to the task and reference documents.

Turns a year of LinkedIn job-alert emails into a spreadsheet you can actually work from: every advert, the companies behind them, and the saved searches that found them. It builds the tracker incrementally, so it can be re-run without losing anything you have typed into the tracker yourself.

It currently harvests LinkedIn only. Seven other sources are planned, and adding one is a descriptor plus fixtures, not a rewrite (DR-0006, source registry descriptors).

## What it produces

Three tabs, in one `.xlsx` workbook or in one Google Sheet:

| Tab | One row per | Key |
|---|---|---|
| `Jobs` | advert | `Dedup Key` (`linkedin:<job id>`) |
| `Companies` | company that advertised | `Company` |
| `Sources` | saved search that found adverts | `Source` + `Search Term` |

Every column has exactly one owner (DR-0004, one owner per column). The harvester refreshes the columns it derives on each run. It never writes the columns you type into: `Status`, `Qualified?`, `Applied on Date`, `Permanent/Contract`, `Onsite/Hybrid/Remote`, `Full time/Part Time`, `Min Salary (hourly)`, `Day Rate`, and any column it does not recognise. That is what makes re-running safe.

## Two ways to hold the tracker

The tracker is either an `.xlsx` file that you download from Google Sheets, merge into and upload again, or a Google Sheet that the harvester writes to directly. In the second case the Sheet becomes the only home of your typed columns, so a periodic `.xlsx` download is your backup (DR-0012, Sheets target under drive.file).

## Quick start

1. **Install.** Node 22 or later, then `npm install`. Check it with a first offline run: [Build the tracker workbook](docs/how-to/build-the-tracker-workbook.md).
2. **Set up credentials.** One Google OAuth client, then `node src/cli/harvest.mjs auth`: [Set up Google Cloud credentials](docs/how-to/set-up-google-cloud.md).
3. **Fetch mail.** `node src/cli/harvest.mjs fetch --source linkedin --from <d> --to <d>`: [Fetch new mail](docs/how-to/fetch-new-mail.md).
4. **Build the tracker.** `node src/cli/harvest.mjs build --out tracker.xlsx`, or merge into an existing tracker with `--merge`: [Build the tracker workbook](docs/how-to/build-the-tracker-workbook.md).
5. **Optionally, move to a Google Sheet.** `auth --target sheets`, `import`, then `build --target sheets`: [Use a Google Sheet as the tracker](docs/how-to/use-a-google-sheet-as-the-tracker.md).
6. **Optionally, keep the Sheet current.** `node src/cli/harvest.mjs update` fetches the days since the last fetched day, then builds into the Sheet. Run it by hand or on a schedule: [Run update on a schedule](docs/how-to/run-update-on-a-schedule.md).

> **Note: neither form overwrites.** `node src/cli/harvest.mjs --in <dir> --out <file>` and `build --out <file>` both refuse when the output file already exists, so re-running cannot destroy what you typed. Use `build --out <file> --merge <file>` to update an existing tracker. (Before 2026-09-30 the `--in` form overwrote silently; see `docs/feature/fix-rebuild-overwrites-output/rca.md`.)

## Documentation

| You need to | Read | Type |
|---|---|---|
| Install and check the tool works offline | [Build the tracker workbook](docs/how-to/build-the-tracker-workbook.md) | How-To |
| Create the Google credentials | [Set up Google Cloud credentials](docs/how-to/set-up-google-cloud.md) | How-To |
| Get new mail into the cache | [Fetch new mail](docs/how-to/fetch-new-mail.md) | How-To |
| Create or merge the `.xlsx` tracker | [Build the tracker workbook](docs/how-to/build-the-tracker-workbook.md) | How-To |
| Use a Google Sheet as the tracker | [Use a Google Sheet as the tracker](docs/how-to/use-a-google-sheet-as-the-tracker.md) | How-To |
| Run `update` every morning on macOS | [Run update on a schedule](docs/how-to/run-update-on-a-schedule.md) | How-To |
| Run the tests, the layering check and the live scripts | [Run the checks](docs/how-to/run-the-checks.md) | How-To |
| Look up a command, option, exit code, environment variable or file | [CLI reference](docs/reference/cli.md) | Reference |
| Look up a refusal code | [Refusal codes](docs/reference/refusals.md) | Reference |
| Understand why it is built this way | `docs/decisions/` and `docs/evolution/` | Explanation |
| See the architecture | [Architecture brief](docs/product/architecture/brief.md) | Explanation |

## What has not been verified yet

- **`build --target sheets` on real data: used, with one gap.** On 2026-09-30 the operator backfilled mail and merged it into their Sheet month by month. The log shows the Sheet ending at 3,050 `Jobs`, 1,275 `Companies` and 16 `Sources` rows, a final re-run with 0 changes, and `gmail.quota-exhausted` on large fetches that resumed cleanly. The gap: the typed columns were not compared before and after, so their safety rests on the design and the tests (`docs/evolution/2026-09-30-sheets-api-target.md`).
- **`Role Family` on your real Sheet: built and run, with one gap.** On 2026-10-05 the operator found no hand-typed `Role Family` header, the scale check `S1` reported `WORKS` (3,052 requests in one batch, HTTP 200, 0.5 MB, on a scratch Sheet), and the real `build --target sheets` appended the column and wrote 3,051 cells (3,050 values plus the header) with no derived corrections reported and no change to `Companies` or `Sources`; a second dry-run then planned 0 appended columns and 0 cell changes. The gap: the typed columns were not compared before and after, and filters and pivots over the new column were not checked. Against the operator's cache the first pass put 982 of 3,050 adverts (32%) in `other`; after one round of pattern tuning it is 759 (25%), and most of the rest are adverts that are not target roles. Whether Google extends filters and pivots over the appended column is unverified (`docs/how-to/use-a-google-sheet-as-the-tracker.md`).
- **The External-audience credential route** for a personal Google account. It is documented in DR-0011 (Gmail credential is Internal OAuth) but has not been exercised; the credential in use is Internal.
- **Google Cloud console menu names.** The guides use Google's documented setting names and were not checked against the live console.
- **No CI.** The layering check and the tests run only when you run them (DR-0013, dependency-cruiser enforces layering). The evolution record lists the `xlsx` dependency advisories as an open item.

## Privacy

**`fixtures/` are real LinkedIn emails with the identifying parts removed.** Names, home locations and every per-recipient tracking token (`otpToken`, `midToken`, `trk`, `lipi` and similar) read `REDACTED`. They are not placeholders awaiting realistic values: restoring plausible-looking tokens would put personal data back into a public repository. Add new fixtures the same way: copy a real message, then redact.

**`.cache/` is personal job-search history and is gitignored.** Raw mail, the coverage ledger and receipts live there. It has never been committed; keep it that way.

## Design

Pure core, imperative shell. `src/core/` is pure: no classes, no mutation, no `node:` imports. `src/adapters/` owns all I/O. `src/cli/` is the composition root, and it wires, probes, then uses: a failed probe refuses to start rather than half-finishing. The one runtime dependency is `xlsx`; the development dependencies are `vitest`, `fast-check` and `dependency-cruiser`.

The reasoning lives in `docs/decisions/`:

| Record | Decision |
|---|---|
| [DR-0001](docs/decisions/DR-0001-persist-what-cannot-be-rederived.md) | Persist what cannot be re-derived; recompute what can |
| [DR-0002](docs/decisions/DR-0002-coverage-intervals-not-a-watermark.md) | Coverage intervals persist; processed ids derive from the cache |
| [DR-0003](docs/decisions/DR-0003-agent-couriers-paths-not-records.md) | The agent couriers paths and control values, never records |
| [DR-0004](docs/decisions/DR-0004-one-owner-per-column.md) | Every column has exactly one owner |
| [DR-0005](docs/decisions/DR-0005-target-sheet-is-a-plan-executing-port.md) | The target sheet is a plan-executing port |
| [DR-0006](docs/decisions/DR-0006-source-registry-descriptors-are-data.md) | Source registry: descriptors are data, extractors return arrays |
| [DR-0007](docs/decisions/DR-0007-spill-contract-is-what-the-harness-writes.md) | The spill contract is what the harness actually writes |
| [DR-0008](docs/decisions/DR-0008-card-position-not-a-noise-denylist.md) | Card position, not a noise denylist |
| [DR-0009](docs/decisions/DR-0009-build-derives-from-the-whole-cache.md) | `build` derives every row from the whole cache, never from a window |
| [DR-0010](docs/decisions/DR-0010-every-derived-tab-merges-by-its-own-key.md) | Every derived tab merges by its own key |
| [DR-0011](docs/decisions/DR-0011-gmail-credential-is-internal-oauth-readonly.md) | The CLI's Gmail credential is an Internal OAuth Desktop client, read-only, over native `fetch` |
| [DR-0012](docs/decisions/DR-0012-sheets-target-uses-drive-file-scope.md) | The Sheets target is a harvester-created Sheet under the `drive.file` scope |
| [DR-0013](docs/decisions/DR-0013-dependency-cruiser-enforces-the-layering-rules.md) | dependency-cruiser enforces the layering rules, run by the test suite |
| [DR-0014](docs/decisions/DR-0014-role-family-is-a-derived-column-classified-from-title-by-a-data-table.md) | Role Family is a derived column, classified from the title by a data table |
| [DR-0015](docs/decisions/DR-0015-search-yield-is-derived-in-harvest-and-printed-never-stored.md) | Search yield is derived inside `harvest()` and printed to stderr, never stored |
| [DR-0016](docs/decisions/DR-0016-update-subcommand-owns-the-fetch-then-build-sequence.md) | `harvest update` owns the fetch-then-build sequence and fails closed |

`docs/evolution/` holds the archived feature records and a root-cause retrospective on why a green test suite once coexisted with a third of the output being wrong.
