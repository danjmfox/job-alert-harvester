# sheets-api-target — Evolution Record

**Type**: Explanation. **Finalized**: 2026-09-30. **Workspace**: `docs/feature/sheets-api-target/` (kept as delivery history; `deliver/roadmap.json` and `deliver/execution-log.json` committed).

## What shipped

The CLI can now write the operator's job tracker into a native Google Sheet that it created itself, under the narrow `drive.file` scope. `TargetSheet` is unchanged; `sheets-target` is its second adapter, beside `xlsx-target-sheet`.

- **Subcommands** (`src/cli/`): `import` (one-off upload of a tracker `.xlsx` as a native Sheet, then a check that the conversion kept tabs, headers, row counts and key sets), `auth --target sheets` (consent for `drive.file`, separate token slot), `build --target sheets` (`--dry-run` gets a reader with no write capability; `--report` unchanged). Plain `build --out/--merge` is untouched.
- **Pure core**: `endpoints` (Sheets and Drive bases), `retry-policy` (refusal namespace), `oauth` (scope profiles), `import-check`, `sheets-requests` (plan to one guarded `batchUpdate` body; no delete, clear or sort request constructable), `sheets-model` (Sheets JSON to `SheetState`, row and column resolution).
- **Adapters**: `credential-store` (Sheets token slot and an exclusive-create target record), `google-token-source` (Sheets profile), `sheet-provisioner` (creates one file, deletes only what it created), `sheets-target` (reader, and writer that re-resolves rows and columns from a fresh read on every attempt).
- **CLI transport**: `google-transport` (separate read and write capabilities; the write side sends once and never replays), and the `import` flow.

Full suite at close: 56 files, 763 tests, all passing, none pending (745 after the metadata retirement described under "Later the same day" below). 17/17 steps traced by `des-verify-integrity`. `scripts/sheets-live-check.mjs --self-test`: 35 checks pass. Adversarial review: approved.

## Decisions and where they live

- DR-0012 (Sheets target under `drive.file`) v1.2.0, status **`accepted`**: `docs/decisions/DR-0012-sheets-target-uses-drive-file-scope.md`. v1.2.0 records the measured write quota.
- DR-0005 (target sheet is a plan-executing port), corrected: Sheets offers no usable ETag or revision guard for writes, the Sheets probe is read-only, and receipt digests are null.
- The five DESIGN open questions, resolved by the human on 2026-09-29 (`feature-delta.md`, Open Questions): one `batchUpdate` write shape (OQ-1); explicit `--target sheets` (OQ-2); refuse the whole apply on duplicate keys (OQ-3); refuse `sheets.plan-too-large` after skipping unchanged cells (OQ-4). OQ-5 (sibling `sheets-fake.mjs` as the test seam) was taken as recommended and **ratified by the human on 2026-09-30**, after real use.
- Names pinned by the DISTILL tests (refusal codes, `Receipt.warnings`, `bindRowKeys` result shape, transport retry rules), ratified by the human on 2026-09-29: `feature-delta.md`, Pre-requisites and Decisions Pinned by Tests.
- Product-level summary: `docs/product/architecture/brief.md` section 13.

## Live check

The operator ran `scripts/sheets-live-check.mjs` on 2026-09-30 (`deliver/live-findings.md`, `deliver/live-fixtures.json`). Of 19 assumptions, 16 were verified, 1 was refuted and the fake corrected (a second same-key metadata binding on a row is accepted), and 2 were deferred (A12, A14).

- Write quota is about 60 write requests per minute per user; a 429 arrives after about 57 rapid writes, with no `Retry-After`.
- A file the app did not create answers 404, not 403.
- Batches of 9 MB were accepted; `MAX_BATCH_BYTES` is 9 MiB.
- Every captured real body was compared with the fake; most were corrected.

## Process facts worth keeping

- DISCUSS was skipped and DEVOPS was `NOT_APPLICABLE`, both by instruction (local CLI, one operator). A spike verified the `drive.file` assumptions before DR-0012 was accepted.
- Two DISTILL oversights surfaced in DELIVER. The shipped Gmail endpoint tests asserted an exact three-key table, so two expected objects were widened, human-approved. A fixture was aligned wrongly in `sheets-target-apply.test.mjs`. A third fixture composed separate token sources.
- A real bug was found in DELIVER: a tab id could collide with an unowned tab. Fixed with a regression test.
- The live-check script broke for a few minutes when the interim scope-profiles module was deleted; every later step now runs its `--self-test`.
- In step 01-06 the crafter wrote code before observing RED, then confirmed RED afterwards.
- Mutation testing skipped per the project's `nightly-delta` strategy. Refactor pass: 1 commit.

## Not done

- **Narrow live re-run: done later on 2026-09-30.** A12 verified (the script's path was wrong). A14: the 400s are a per-Sheet developer-metadata storage limit (about 1,200 entries in the test Sheet); binding stays non-fatal and chunked at most 100.
- **First real use: done later on 2026-09-30.** `auth --target sheets`, `import` (541 row keys bound, 0 pending), and both a dry run and a real `build --target sheets` reported 0 cell changes and wrote nothing, because the imported tracker already matched the cache. The update and append paths ran against real data later the same day (see "Real use after the first import").
- **`dependency-cruiser`**: a LOCKED decision from the first feature was never implemented; adopted afterwards in DR-0013 on its own branch.
- **CI** and the **`xlsx` advisories**: unchanged project-level open items.
- **Write-by-metadata**: proven live, deliberately not used.

## Later the same day: row-key metadata retired

The narrow live re-run found that Google caps the developer metadata a Sheet can hold (refused at about 1,200 entries in the test Sheet). The operator's real import had bound 541 row-key entries, and the tracker grows by about 19 keyed rows a day, so the cap would arrive in roughly five weeks. The human retired the feature before the PR (DR-0012 v1.4.0): the key column alone locates rows, nothing creates, binds, reads or checks developer metadata, and the statements above that binding is "non-fatal and chunked at most 100", that `import` bound 541 keys, and that write-by-metadata was "proven live, deliberately not used" describe the state before that change. The suite is 745 tests (19 scenarios that pinned the retired behaviour removed, 37 modified, one added: no request of any kind mentions developer metadata). The accepted residual risk is written in DR-0012: a human sort, insert or delete inside the single write window can misdirect a harvester-owned-column write; nothing on Google's side can close it. The 541 entries already in the operator's Sheet stay; nothing reads them.

## Real use after the first import

Later on 2026-09-30 the operator backfilled mail month by month with `fetch`, and after each month ran `build --target sheets --dry-run` and then the real merge. The operator's terminal log shows:

- Each real merge appended new rows and wrote derived-column corrections. The final Sheet held 3,050 `Jobs` rows, 1,275 `Companies` rows and 16 `Sources` rows.
- A final `build --target sheets` over the same cache reported 0 changes, so the merge is idempotent on real data.
- Several large `fetch` runs stopped with `gmail.quota-exhausted`. Re-running resumed from the coverage ledger each time without duplicating days.
- Some derived columns changed on rows already in the Sheet as older mail arrived (for example `Date Discovered` moved earlier), which is the documented derived-column behaviour.

Not recorded: the typed columns were not compared before and after, so "typed columns untouched" rests on the design and the tests, not on captured evidence. The same log showed `--from` and `--to` accepting impossible dates such as `2026-02-31`; the fix and its analysis are in `docs/feature/fix-validate-date-arguments/` (the command line, the coverage interval and the ledger now all refuse non-days).
