---
id: DR-0012
status: accepted
dateCreated: 2026-09-29
domain: job-alert-harvester
refines: DR-0005
changelog:
  - date: 2026-09-29
    version: 0.1.0
    note: Initial draft — the Sheets API adapter's scope, ownership and concurrency stance; three assumptions await a spike
---

# The Sheets target is a harvester-created Sheet under the `drive.file` scope

## Context

DR-0005 (the target sheet is a plan-executing port) made the tracker's write side a port that applies a
plan of cell changes, with an interim adapter that rewrites an `.xlsx` you download and re-upload, and a
Sheets API adapter as the named successor. Today the tracker is an `.xlsx` file in Drive, so every merge is
download, merge, upload, and the only defence against overwriting what you typed in between is the
stale-upload warning.

This record fixes the credential and ownership shape of the successor. It does not change the port.
DR-0011 (the Gmail credential is Internal OAuth) already ruled that a Sheets adapter needs its own consent
and does not share the Gmail token; least authority is the principle carried over.

Constraints:

- One operator, one tracker, one machine; the repository is public and no credential is ever committed.
- The Sheets API only edits native Google Sheets. An `.xlsx` sitting in Drive cannot be updated in place.
- DR-0004 (every column has exactly one owner): the harvester may write only the columns it owns and must
  never write yours, including columns it does not recognise.

## Options Considered

### Option 1: Keep the manual cycle

Download, merge, upload. No new credential, and it works today. The stale-download hazard remains and
depends on the operator noticing a warning. Kept as the fallback, not the direction.

### Option 2: `spreadsheets` scope

Google classes it as sensitive. It reads and writes every spreadsheet the account owns, so a bug or a leaked
token can damage unrelated Sheets. Simple to use with your existing tracker; contradicts the
least-authority reasoning of DR-0011.

### Option 3: `drive.file`, the harvester creates and owns the tracker Sheet (chosen)

Google classes it as non-sensitive, and the Sheets API accepts it. Access is limited to files the app creates
or that you open with it. The harvester creates the tracker Sheet itself, so it can update that one file
and nothing else in the account. Cost: your current `.xlsx` tracker has to be imported once into a
harvester-created Sheet, and an Internal-audience app adds no verification burden either way.

### Option 4: `drive.file` with your existing Sheet opened through a picker

Keeps your existing file, but a picker needs a browser UI the CLI does not have, and the `.xlsx` in Drive would
still have to be converted. Rejected for a CLI.

## Decision

Add a Sheets target adapter behind the DR-0005 port, using the **`drive.file`** scope with a Sheet the harvester
**creates and owns**.

- **Consent.** A separate consent and a separate token file from the Gmail token (the Gmail token stays
  `gmail.readonly` only). Same Internal Desktop client, loopback and PKCE flow as DR-0011.
- **Import.** A one-off `import` creates the Sheet from your current tracker, and records its file id outside
  the repo beside the credentials.
- **Writes.** Only harvester-owned columns are written (DR-0004). Rows are located by their key on every
  run, never by remembered row number. A human-owned cell is never a write target, so an edit you make while
  a merge runs cannot be overwritten.
- **Atomicity.** The plan for all three tabs is applied in a single batch (DR-0005, DR-0010), and the adapter
  refuses to start if the recorded Sheet cannot be read.
- **Nothing credential-shaped** appears in output, logs or the cache.

### Assumptions verified by the spike (2026-09-29)

Verified in docs/feature/sheets-api-target/spike/findings.md against the operator's own Drive with a synthetic workbook:

1. An app holding only `drive.file` creates a native Sheet by uploading an `.xlsx` with conversion. **Verified.**
2. That app reads and batch-updates that Sheet through the Sheets API with the same token, and a write to a harvester-owned column leaves human-owned cells untouched. **Verified.**
3. Rows are located reliably after a sort or an insert, both by re-reading the key column and by developer metadata bound to each row. **Verified.**

Google offers **no server-side stale-write precondition**: a bogus or stale `requiredRevisionId` and an `If-Match`
header were both accepted. So the safety is the write shape, not a lock: only harvester-owned columns are
written, and rows are addressed by developer metadata so a sort or insert between read and write cannot misdirect
a write. Writing through that address (`values.batchUpdateByDataFilter`) was not probed and must be pinned by the adapter's
acceptance tests, with a fallback of resolving the row by re-reading the key column immediately before the write.

## Consequences

- New `sheets` adapter and `import`/`auth --target sheets` subcommands; `src/core/` unchanged apart from any
  pure plan-to-request translation.
- The GCP project must have the Sheets and Drive APIs enabled and the `drive.file` scope added to the
  consent screen; a `spreadsheets`-sized blast radius never exists.
- The stale-download hazard disappears, but the tracker is no longer the file you already have; you edit the
  harvester-created Sheet from then on.
- The `.xlsx` adapter stays as the offline and fallback path.

## Exceptions

Revisit if Google changes what `drive.file` covers or the write-by-metadata path fails its acceptance tests (fall back to Option 2 with a recorded reason, or Option 1), if the
harvester is ever run by anyone other than the operator, or if Google changes what `drive.file` covers.
