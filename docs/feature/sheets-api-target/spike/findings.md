# Spike findings: sheets-api-target

Doc type: Reference. Probe run 2026-09-29 by the operator against their own Drive with a synthetic workbook; probe at `/tmp/spike_sheets-api-target/probe.mjs` (throwaway, runbook in `runbook.md`). Consent screen: Internal audience, scope `drive.file` only.

**Verdict: WORKS.** All three assumptions in DR-0012 (the Sheets target is a harvester-created Sheet under `drive.file`) are verified.

| # | Assumption | Result |
|---|---|---|
| 1 | An app holding only `drive.file` creates a native Sheet by uploading an `.xlsx` with conversion (Drive `files.create`, multipart, target mimeType the native Sheet type) | WORKS; returned mimeType is the native Sheet type |
| 2 | The same token reads (`spreadsheets.get`, `values.get`) and batch-updates (`values.batchUpdate`) that Sheet | WORKS; a write to a harvester-owned column left simulated human `Status` edits and other rows untouched |
| 3a | Rows are located after a sort by re-reading the key column | WORKS |
| 3b | Developer metadata bound to each row follows the row through `sortRange` and `insertDimension`, found with `batchGetByDataFilter` | WORKS; agrees with 3a in both phases |
| E | A server-side precondition to reject a stale write | NONE FOUND: `writeControl.requiredRevisionId` with a bogus id and with a stale Drive revision id both returned HTTP 200; `If-Match` ignored; no ETag on Sheets responses |
| F | `files.delete` of the file the app created | WORKS (HTTP 204) |

## Design implications

- There is no optimistic-concurrency guard to lean on. Safety comes from the write shape: write only harvester-owned columns (DR-0004), never a human-owned cell, and address rows by developer metadata so a sort or insert between read and write cannot misdirect a write.
- Not probed: writing through a metadata address (`values.batchUpdateByDataFilter`). The probe only located rows that way. The adapter's acceptance tests must cover it, and DESIGN should state the fallback (resolve the row by re-reading the key column in the same request window).
- `drive.file` also covered `files.get` and `revisions.list` in this run, so those are available if wanted.
- The Desktop client and loopback consent pieces from DR-0011 were reused by the probe unchanged (except that `buildConsentUrl` hard-codes the Gmail scope and `parseTokenResponse` refuses non-Gmail scopes; the adapter needs those parameterised by scope).

## Constraints discovered

- Both the Google Sheets API and the Google Drive API must be enabled in the GCP project, and `drive.file` must be on the consent screen.
- The probe used a synthetic workbook, so nothing about the operator's real tracker (column order, size, the three-tab shape) has been exercised. That is DISTILL and DELIVER work.
