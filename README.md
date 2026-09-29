# job-alert-harvester

Turns a year of LinkedIn job-alert emails into a spreadsheet you can actually work from: every advert, the companies behind them, and the saved searches that found them — built incrementally, so it can be re-run without losing anything you have typed into the tracker yourself.

Currently harvests **LinkedIn only**. Seven other sources are planned; adding one is a descriptor plus fixtures, not a rewrite (see DR-0006).

## What it produces

Three tabs in one `.xlsx`:

| Tab | One row per | Key |
|---|---|---|
| `Jobs` | advert | `Dedup Key` (`linkedin:<job id>`) |
| `Companies` | company that advertised | `Company` |
| `Sources` | saved search that found adverts | `Source` + `Search Term` |

Every column has exactly one owner. Columns the harvester derives are refreshed on each run; columns you type into — `Status`, `Applied on Date`, `Qualified?`, and any column it does not recognise — are never written. That is DR-0004, and it is what makes re-running safe.

## Requirements

Node 22+. One runtime dependency, deliberately (`xlsx`), plus `vitest` and `fast-check` for tests.

```bash
npm install
```

## Usage

**Rebuild a workbook from the local cache** — the repair path. Re-derives every row from scratch, so a parser fix reaches your whole history:

```bash
node src/cli/harvest.mjs --in .cache/messages/2026-09 --out jobs.xlsx
```

**Preview a merge into your tracker.** Writes nothing; prints the plan:

```bash
node src/cli/harvest.mjs build --out tracker.xlsx --merge tracker.xlsx --dry-run
```

**Merge into your tracker.** Download it from Google Sheets as `.xlsx`, run this, upload the result:

```bash
node src/cli/harvest.mjs build --out tracker.xlsx --merge tracker.xlsx --report changes.txt
```

`--merge` must name the same file as `--out`: the merge reads and preserves its own target, so writing elsewhere would silently drop the tracker's contents. Without `--merge`, an existing `--out` is refused rather than overwritten.

Fetching new mail runs through the `harvest` skill in `.claude/skills/`, which drives the Gmail connector and hands paths — never message content — to `plan-fetch` and `ingest` (DR-0003).

## Reading the output

`--report <file>` lists every changed cell: tab, key, column, before, after. The summary on stderr separates **derived corrections** — a company name the parser now reads correctly — from **sighting bookkeeping**, the counters that move whenever an advert is re-seen. The corrections are the point; without the split they drown roughly 28:1.

A build may also warn that the target *still matches what we last wrote*. That means the file is the harvester's own previous output — you never uploaded it, or you are working from a stale download — so anything you have since typed in Google Sheets is not in this file and would be overwritten. The build proceeds; the warning is there so the loss is visible rather than silent (DR-0005).

## Two things to know before contributing

**`fixtures/` are real LinkedIn emails with the identifying parts removed.** Names, home locations and every per-recipient tracking token (`otpToken`, `midToken`, `trk`, `lipi`, …) read `REDACTED`. They are not placeholders awaiting realistic values — restoring plausible-looking tokens would put personal data back into a public repository. Add new fixtures the same way: copy a real message, then redact.

**`.cache/` is personal job-search history and is gitignored.** Raw mail, the coverage ledger, and receipts live there. It has never been committed; keep it that way.

## Design

Pure core, imperative shell. `src/core/` is pure — no classes, no mutation, no `node:` imports. `src/adapters/` owns all I/O. `src/cli/` is the composition root, and wires, probes, then uses: a failed probe refuses to start rather than half-finishing.

The reasoning lives in `docs/decisions/`:

| | |
|---|---|
| DR-0001 | Persist what cannot be re-derived; recompute what can |
| DR-0002 | Coverage intervals persist; processed ids derive from the cache |
| DR-0003 | The agent couriers paths and control values, never records |
| DR-0004 | Every column has exactly one owner |
| DR-0005 | The target sheet is a plan-executing port |
| DR-0006 | Source registry: descriptors are data, extractors return arrays |
| DR-0007 | The spill contract is what the harness actually writes |
| DR-0008 | Card position, not a noise denylist |
| DR-0009 | `build` derives every row from the whole cache, never from a window |
| DR-0010 | Every derived tab merges by its own key |

`docs/evolution/` holds the archived feature record and a root-cause retrospective on why a green test suite once coexisted with a third of the output being wrong.

## Tests

```bash
npx vitest run
```

25 files, 183 tests, including `fast-check` property tests over the coverage-interval algebra (DR-0002).

`npm test` runs the suite once; `npm run test:watch` starts watch mode.
