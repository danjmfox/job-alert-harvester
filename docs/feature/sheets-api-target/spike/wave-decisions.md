# SPIKE Decisions: sheets-api-target

## Assumption Tested
- An OAuth app holding only `drive.file` can create a native Sheet from an `.xlsx`, read and batch-update it, and locate rows reliably after a sort or insert (DR-0012).

## Probe Verdict
- WORKS: all three assumptions verified; Google offers no stale-write precondition (see findings.md).

## Promotion Decision
- DISCARD, decided by the human on 2026-09-29: the findings are enough. The adapter needs its own design (scope-parameterised consent, import, plan-to-request translation, write by metadata address); a skeleton built from a 365-line throwaway would be rebuilt. Probe directory and its local `drive.file` token file deleted.

## Design Implications
- Safety comes from the write shape, not a lock: write only harvester-owned columns (DR-0004) and address rows by developer metadata.
- Write through a metadata address (`values.batchUpdateByDataFilter`) was not probed; the adapter's acceptance tests must pin it, with a fallback of re-reading the key column immediately before the write.
- `buildConsentUrl` hard-codes the Gmail scope and `parseTokenResponse` refuses non-Gmail scopes; both need parameterising by scope.

## Constraints Discovered
- Sheets API and Drive API must both be enabled in the GCP project; `drive.file` must be on the consent screen.
- Only synthetic data was exercised; the real tracker's shape is untested.
