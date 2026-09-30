# Metadata retirement inventory

Doc type: Reference. Feature `sheets-api-target`, branch `feat/sheets-api-target`. Written 2026-09-30, after the human decision of the same day to retire row-key developer metadata (`feature-delta.md`, section "Amendment 2026-09-30: retire row-key developer metadata").

Every place the delivered work references developer metadata, with a proposed action for the follow-up DELIVER change. Nothing in `src/`, `tests/` or `scripts/` was edited to produce this file: the delivered code and tests are still the old ones. Line numbers are as of commit `50e788b`.

Terms: "row-key metadata" is the entry with key `harvester.row-key` bound to a keyed row. "Retired behaviour" is what the amendment removes. "Fake" is `tests/acceptance/sheets-api-target/support/sheets-fake.mjs`.

## Headline counts

| Measure | Count |
|---|---|
| Production symbols to DELETE | 25 (in `sheets-model`, `sheets-requests`, `sheets-refusals`, `sheets-target`, `import`) |
| Production symbols to REDUCE | 11 (two are comment or JSDoc blocks only) |
| Refusal or warning codes retired | 3 (`sheets.row-identity-conflict`, `sheets.metadata-pending`, `sheets.metadata-unavailable`) |
| Request kinds retired | 1 (`createDeveloperMetadata`); allow-list goes from five kinds to four |
| Receipt fields retired | 2 (`warnings`, `metadataPending`) |
| Test scenarios to DELETE | 19 |
| Test scenarios to MODIFY (metadata detail dropped, or retargeted) | 37 |
| Test scenarios to ADD | 1 (pins that no developer-metadata request is ever sent) |
| Test scenarios KEEP unchanged with metadata modelling | 3 (all in `sheets-fake.test.mjs`, the fake documenting Google facts) |
| Support helpers to change | 7 (in `sheets-domain-types.mjs` and `request-model.mjs`; the fake and the script stay) |

Suite effect: the 763-test suite becomes 745 (763 minus 19 deleted plus 1 added), assuming no other change. Modified scenarios keep their titles except where the table says a title is reworded.

## Production code

| Kind | Location | Proposed action | Reason |
|---|---|---|---|
| production symbol | `src/core/sheets-model.mjs:9` `ROW_KEY_METADATA` | DELETE | Nothing names the metadata key once nothing binds or reads it. Also drop its imports at `sheets-requests.mjs:4` and `sheets-target.mjs:5`, and the re-export in `tests/.../support/sheets-domain-types.mjs:20,42` |
| production symbol | `src/core/sheets-model.mjs:91-104` `parseMetadataEntry` | DELETE | Only parses `developerMetadata:search` matches |
| production symbol | `src/core/sheets-model.mjs:107-112` `parseMetadata` | DELETE | Same; also imported by `sheets-target.mjs:5` and `sheets-model.test.mjs:8` |
| production symbol | `src/core/sheets-model.mjs:143-148` `refuseDisagreeingMetadata` | DELETE | The only raiser of `sheets.row-identity-conflict` |
| production symbol | `src/core/sheets-model.mjs:150-151` `rowBindings` | DELETE | Filters metadata to one tab; no metadata remains |
| production symbol | `src/core/sheets-model.mjs:163-165,175` `bindings`, `boundKeys` and the `unboundKeys` field of a resolved tab | DELETE | `unboundKeys` exists only so `bindRowKeys` knows which rows to bind. Also the `unboundKeys` JSDoc at `:182` and the field in test resolution fixtures (see support) |
| production symbol | `src/core/sheets-model.mjs:153,186,190` `resolveTab` and `resolveTabs` parameter `metadata` | REDUCE to `resolveTabs({ tabs, grids })` | Resolution keeps duplicate-key refusal, key-column-missing, duplicate-header, tab-missing and the row and column indices |
| production symbol | `src/core/sheets-model.mjs:2,89` header comment and section banner naming `developerMetadata` | REDUCE to the get and batchGet bodies only | Comment would otherwise describe a removed input |
| production symbol | `src/core/sheets-requests.mjs:14` `ROW_KEY_VISIBILITY` | DELETE | Visibility applies only to metadata |
| production symbol | `src/core/sheets-requests.mjs:18` `METADATA_SEARCH_PATH` and `:26` `isMetadataSearch` | DELETE | See the classifier row. Alternative in *Consequences to decide* |
| production symbol | `src/core/sheets-requests.mjs:29-32` `classifyRequest` | REDUCE to "GET is a read; anything else is a write" | With no metadata search sent, a POST to it should not be a read. Keeps fail-closed classification (an unrecognised request is a write) |
| production symbol | `src/core/sheets-requests.mjs:7` `ALLOWED_REQUEST_TYPES` | REDUCE to `updateCells`, `appendCells`, `appendDimension`, `addSheet` | The amendment's four kinds. Header comment at `:2` ("five") reduced to "four" |
| production symbol | `src/core/sheets-requests.mjs:179-191` `buildMetadataBody` | DELETE | The only builder of `createDeveloperMetadata` |
| refusal or warning code | `src/core/sheets-refusals.mjs:25` `SheetsRefusal.ROW_IDENTITY_CONFLICT` (`sheets.row-identity-conflict`) | DELETE | Key/metadata disagreement no longer exists |
| refusal or warning code | `src/core/sheets-refusals.mjs:34-38` `SheetsWarning` (`METADATA_PENDING` `sheets.metadata-pending`, `METADATA_UNAVAILABLE` `sheets.metadata-unavailable`) | DELETE the whole enum | Both members are retired; no other warning exists. The comment at `:34` describes receipt `warnings`, also retired |
| production symbol | `src/adapters/sheets-target.mjs:5-6` imports `ROW_KEY_METADATA`, `parseMetadata`, `buildMetadataBody`, `SheetsWarning` | DELETE these four names from the imports | Unused after the edits below |
| production symbol | `src/adapters/sheets-target.mjs:12` `TOO_MANY_REQUESTS` | DELETE | Used only by `bindInChunks:197` |
| production symbol | `src/adapters/sheets-target.mjs:15` `MAX_BINDINGS_PER_BATCH` | DELETE | The chunk size for binding |
| production symbol | `src/adapters/sheets-target.mjs:71` `resolveTabs({ tabs, grids, metadata: [] })` in `probeSheet` | REDUCE to `resolveTabs({ tabs, grids })` | Follows the `resolveTabs` signature |
| production symbol | `src/adapters/sheets-target.mjs:33-36` `readBody` `options` parameter | REDUCE (optional) | Only the metadata search passes `options` (a POST body). Every remaining caller sends a GET |
| production symbol | `src/adapters/sheets-target.mjs:93` `isCodedRefusal` | DELETE | Used only in `lookUpRowKeys` |
| production symbol | `src/adapters/sheets-target.mjs:95` `rowKeyLookup` | DELETE | The search body |
| production symbol | `src/adapters/sheets-target.mjs:97-107` `lookUpRowKeys` | DELETE | The `developerMetadata:search` call and its 5xx fallback |
| production symbol | `src/adapters/sheets-target.mjs:110-115` `resolveFresh` | REDUCE to return the resolution only | Drops `metadataAvailable`. Still reads tabs and the owned tabs' grids fresh, which is the guarantee that stays |
| production symbol | `src/adapters/sheets-target.mjs:153-166` `attemptApply` | REDUCE | Drops `metadataAvailable`, `lookupWarnings`. Keeps settle, `appendsSkippedAsPresent`, the size limit, one batch, the retry decision |
| production symbol | `src/adapters/sheets-target.mjs:177` `chunked` | DELETE | Used only to chunk bindings |
| production symbol | `src/adapters/sheets-target.mjs:179-180` `unboundRows` | DELETE | Reads the retired `unboundKeys` |
| production symbol | `src/adapters/sheets-target.mjs:183-189` `sendBindingChunk` | DELETE | Sends a binding chunk |
| production symbol | `src/adapters/sheets-target.mjs:192-200` `bindInChunks` | DELETE | The 100-per-batch binding loop |
| production symbol | `src/adapters/sheets-target.mjs:202-207` `bindFresh` | DELETE | A second fresh resolve plus binding. Its removal also removes one full set of reads per `apply` |
| production symbol | `src/adapters/sheets-target.mjs:209-211` `warningsFor` | DELETE | Builds retired warnings |
| production symbol | `src/adapters/sheets-target.mjs:213-226` `applyPlans` | REDUCE to return `{ appliedAt, cellsWritten, inputDigest: null, outputDigest: null, appendsSkippedAsPresent }` | Drops `metadataPending`, `warnings` and the `bindFresh` call. `appendsSkippedAsPresent` stays |
| production symbol | `src/adapters/sheets-target.mjs:228-231,245` `bindRowKeys` and the writer's `bindRowKeys` member | DELETE | The writer has `probe`, `read`, `apply` only |
| production symbol | `src/adapters/sheets-target.mjs:2,236-238` header and JSDoc | REDUCE | Remove `bindRowKeys`, `metadataPending`, `warnings` from the documented shape |
| production symbol | `src/cli/import.mjs:64-72` `bindRowKeys` (the import step and its two output lines `import: bound N row keys, M pending` and `import: row keys not bound; the next build binds them`) | DELETE | The retired import step. No test asserts these lines (checked: `sheets-cli.test.mjs` and `import-flow.test.mjs` only check that output holds no secret) |
| production symbol | `src/cli/import.mjs:95` the call `await bindRowKeys(collaborators, spreadsheetId)`; `:2` comment "then bind row keys" | DELETE the call; REDUCE the comment | |
| production symbol | `src/cli/import.mjs:75-77` `runImport` JSDoc, `sheets: (spreadsheetId) => { reader, writer }` | REDUCE (optional) to `{ reader }` | After binding is gone, `import` uses only `reader.read()`. `harvest.mjs:255` builds both; reducing it also removes a writer construction during `import`. Optional, see *Consequences to decide* |
| CLI text | `src/cli/harvest.mjs` | KEEP unchanged | No metadata text exists there. `summarizeApply` (`:401-414`) prints no warning or pending count |

## Test scenarios, by file

Scenario titles are quoted as in the files. "Line" is the `it(` line. A scenario is DELETE when the only guarantee it pins is retired. It is MODIFY when it pins a guarantee that stays and only uses metadata as a fixture detail, an argument or an assertion line.

### `tests/acceptance/sheets-api-target/sheets-model.test.mjs` (delete 6, modify 16)

| Kind | Location | Proposed action | Reason |
|---|---|---|---|
| test scenario | `:120` "yields each row-key metadata with its row and tab, and nothing when none matched" | DELETE | Pins `parseMetadata` |
| test scenario | `:130` "@error refuses sheets.response-malformed for an answer that is not an object, or a match with no location" | DELETE | Pins `parseMetadata` malformed-body handling. The malformed-body guarantee for the other responses is pinned elsewhere (`parseSpreadsheet`, `parseValueRanges`, and the apply scenario "a 200 answer that is not a Sheet at resolution") |
| test scenario | `:186` "a keyed row with no metadata is reported unbound, in row order, and a bound row is not" | DELETE | Pins `unboundKeys` |
| test scenario | `:194` "@property when metadata agrees with the key column for every row, nothing refuses and nothing is unbound" | DELETE | Pins agreement and `unboundKeys`. The row-index-by-key half of it is also pinned by ":176 locates every keyed row by its position" |
| test scenario | `:214` "@error refuses sheets.row-identity-conflict, naming the key, when its metadata sits on a different row" | DELETE | Pins the retired refusal |
| test scenario | `:223` "metadata for a key that no longer stands in the key column is ignored: there is nothing to write there" | DELETE | Pins metadata filtering |
| test scenario | `:231` "the same first key column on two tabs never mixes: metadata is read per tab" | REDUCE to "a key on two tabs is located per tab": drop the `metadata` argument and the `unboundKeys` assertion, keep `tabs.Companies.rowIndexByKey['linkedin:1'] === 3` | **Non-metadata guarantee**: a key value on Jobs and on Companies must resolve independently per tab. KEEP |
| test scenario | `:164` "locates every column by its header text, wherever a human has put it" | MODIFY | Drop `metadata: bound(...)` argument |
| test scenario | `:176` "locates every keyed row by its position in the key column, skipping blank rows and rows a human added with no key" | MODIFY | Drop `metadata: bound(...)` argument. **Non-metadata guarantee** (a keyless human row is never located): KEEP |
| test scenario | `:205` "@error refuses sheets.duplicate-key, naming the key, when one key stands on two rows" | MODIFY | Drop `metadata: []`. **Non-metadata guarantee** (duplicate-key refusal): KEEP |
| test scenario | `:247` "@error refuses sheets.key-column-missing for ${title} that holds data rows, naming the tab" (4 scenarios from one loop) | MODIFY | Drop `metadata: []` |
| test scenario | `:258` "@error refuses sheets.key-column-missing for a Jobs tab with no header ..." | MODIFY | Drop `metadata: []` |
| test scenario | `:267` "a tab with no data rows resolves without its key column, and an empty tab with no header resolves as new" | MODIFY | Drop `metadata: bound(...)` argument |
| test scenario | `:276` "@error refuses sheets.duplicate-header when a key column or a harvester-owned column is named twice" | MODIFY | Drop `metadata: []` |
| test scenario | `:282` "a human-owned or unknown column named twice is not ambiguous ..." | MODIFY | Drop `metadata: []` |
| test scenario | `:288` "@error refuses sheets.tab-missing when there is no Jobs tab ..." | MODIFY | Drop `metadata: []` (two calls) |
| test scenario | `:296` "the Sources composite key is located as an ordered JSON array, and a blank Search Term is never located" | MODIFY | Drop `metadata: []` and the `unboundKeys` assertion at `:305`. **Non-metadata guarantee** (composite key is a JSON array, never a joined string, DR-0010): KEEP |
| test scenario | `:308` "the Jobs header the harvester wrote itself resolves every one of its 26 columns" | MODIFY | Drop `metadata: []` |
| test scenario | `:151` "@error a row with any blank key column has no key, so it is never matched and never given metadata" | MODIFY (reword title only) | Drop "and never given metadata". **Non-metadata guarantee** (blank key is never matched, DR-0004 rule 2): KEEP |
| support helper | `:3-5` header comment, `:9` import `aMetadataBody`, `:8` import `parseMetadata`, `:160` local `bound` helper | REDUCE | Remove the metadata references |
| test scenario | `:136-149` "a row key is one value, or an ordered JSON array ..." (2 scenarios) | KEEP unchanged | Pins `encodeRowKey`, used by resolution. Not metadata behaviour |

### `tests/acceptance/sheets-api-target/sheets-requests.test.mjs` (delete 2, modify 10)

| Kind | Location | Proposed action | Reason |
|---|---|---|---|
| test scenario | `:299` "@property every binding becomes one createDeveloperMetadata on exactly that row, keyed and valued, and nothing more" | DELETE | Pins `buildMetadataBody` |
| test scenario | `:338` "POST abc/developerMetadata:search is a read" (one entry of the `READS` loop at `:320-325`) | DELETE | Pins the classifier treating a metadata search as a read; retired with `isMetadataSearch`. Remove the entry at `:323` |
| test scenario | `:19` "the allow-list is exactly the five constructable request types, and names no delete, clear or sort" | MODIFY (title and expected list) | Four kinds; still asserts no delete, clear, sort, insert or repeat. **Non-metadata guarantee** (no delete or sort is constructable): KEEP |
| test scenario | `:349` "@error @property any non-GET request other than a metadata search is a write, whatever its path" | MODIFY (reword title) | Becomes "any non-GET request is a write". **Non-metadata guarantee** (a read-only capability is structural): KEEP |
| test scenario | `:121` "@property a cell whose fresh value already equals the planned value is not in the request, and every changed cell is" | MODIFY | Drop `unboundKeys: []` from the resolution fixture (`:155`) |
| test scenario | `:183` "a tab the Sheet lacks is created in the same batch with a chosen id ..." | MODIFY | Drop `unboundKeys: []` (`:185`) |
| test scenario | `:201` "a Sources update is located by its composite key as an ordered JSON array, never a joined string" | MODIFY | Drop `unboundKeys: []` (`:206`) |
| test scenario | `:217` "@error the Companies key is also a harvester column, and an existing Company cell is still never written" | MODIFY | Drop `unboundKeys: []` (`:220`) |
| test scenario | `:242`, `:251`, `:259` (three "settling a plan ..." scenarios) | MODIFY | They share the resolution fixture at `:239`; drop `unboundKeys: []` there |
| test scenario | `:364` "for any set of tab ids on the Sheet, every new tab gets an id no existing tab holds" | MODIFY | Drop `metadata: []` at `:370` |
| support helper | `:3-4` comment, `:10` import `buildMetadataBody`, `:11` import `ROW_KEY_METADATA` | REDUCE | Remove |
| test scenario | `:227` "the body carries no precondition and no data filter: Google would accept a bogus one, so sending one would be theatre" | KEEP unchanged | Mentions "data filter" (a cell-level request carrying a data filter, A5), not metadata. Unrelated |

### `tests/acceptance/sheets-api-target/sheets-target-apply.test.mjs` (delete 8, modify 7, add 1)

| Kind | Location | Proposed action | Reason |
|---|---|---|---|
| test scenario | `:362` "@error a key that no longer matches its row binding refuses sheets.row-identity-conflict, naming a key" | DELETE | The retired refusal. After retirement, two keys a human swapped are located by the key column and each gets its own value; the sort scenario at `:272` already pins that each key gets its own value |
| test scenario | `:524` "an appended row is bound only after it exists, by a further batch that carries metadata alone" | DELETE, replaced by the ADD row below | Pins the follow-up binding batch |
| test scenario | `:535` "a keyed row that lacks its binding is bound on the next merge, and merging again binds nothing more" | DELETE | Pins healing |
| test scenario | `:549` "@error a binding that fails is reported as sheets.metadata-pending, not thrown, and the next merge heals it" | DELETE | Pins the retired warning |
| test scenario | `:567` "@error a failing binding lookup falls back to the key column, warns sheets.metadata-unavailable, and still merges" | DELETE | Pins the retired warning and lookup fallback |
| test scenario | `:595` "binding every keyed row that lacks one reports how many were bound, and a second call binds none" | DELETE | Pins `bindRowKeys` |
| test scenario | `:608` "binding a large tracker goes in chunks of at most 100 requests (pinned proposal), none of them a data write" | DELETE | Pins chunking |
| test scenario | `:621` "@error a chunk Google rejects is counted as pending, not thrown, so import can finish and build can heal" | DELETE | Pins `pending` |
| test scenario | `:583` "@error a binding lookup that is throttled still refuses sheets.quota-exhausted and writes nothing" and "... unauthenticated still refuses sheets.unauthorized and writes nothing" (2 scenarios from the `LOOKUP_REFUSALS` loop at `:578-593`) | REWRITE: retarget `fake.override('metadata-search', answer)` to `fake.override('values', answer)`, reword the title to "a resolution read that is throttled / unauthenticated ..." | **Non-metadata guarantee**: a throttled or unauthenticated read at resolution refuses with the named code and writes nothing. No other apply scenario pins it (the neighbouring ones cover a throttled or unauthenticated **write**, and a malformed resolution body). Do not delete |
| test scenario | `:49` "@real-io @adapter-integration one batch merges three tabs: ..." | MODIFY | Remove `'sheet.rowKeyBindings'` from the expected delta (`:78`), reduce the allow-list check at `:84` to four kinds, drop the "each new row is bound" comment (`:63`), and `warnings: []` from the receipt match at `:83` (the field is retired). **Non-metadata guarantees** (one batch, human cells untouched, allow-list): KEEP |
| test scenario | `:88` "a tab the Sheet lacks is created in the same batch, with its header and rows" | MODIFY | Remove `'sheet.rowKeyBindings'` at `:105` |
| test scenario | `:303` "a row typed into the Sheet at the last second is never overwritten: appended rows land below it" | MODIFY | Delete the metadata assertion at `:314`. **Non-metadata guarantee** (a human-typed row is never overwritten; appends land below it): KEEP |
| test scenario | `:331` "@error a hand-typed row with no key is never matched and never given a key binding" | MODIFY (reword title to "... is never matched") | Remove `'sheet.rowKeyBindings'` from the universe and expected map (`:340-341`). **Non-metadata guarantee** (keyless human row untouched): KEEP |
| test scenario | `:633` "@error the reader offers no apply and no bind, and reading writes nothing" | MODIFY (reword title only) | The assertion `Object.keys(reader).sort() == ['probe', 'read']` already holds. **Non-metadata guarantee** (dry-run reader cannot write): KEEP |
| test scenario | new | ADD "a merge that appends a row sends exactly one batch, and no request of any kind mentions developer metadata" | The acceptance pin the amendment needs: without it the retirement is captured only by deleting tests. Assert on the fake's request log: one `batch-update`, no `metadata-search` route, no `createDeveloperMetadata` in any batch. Absorbs the appended-row-lands-at-row-3 detail of `:531` |
| support helper | `:4` comment, `:30` import `metadataBatches`, `:45` `metadataOnly` | REDUCE | Remove; `metadataOnly` is used only by the deleted scenarios |
| test scenario | `:114`, `:398`, `:410` and the other scenarios using `dataBatches` | KEEP unchanged | `dataBatches` keeps its name and becomes "every `batch-update`" (see support). **Non-metadata guarantees**: idempotent no-op merge, "applied but answer lost is not applied twice" (`appendsSkippedAsPresent`), atomicity (`:382`), one batch per apply |
| test scenario | `:348` "@error one key on two rows refuses sheets.duplicate-key, naming the key" | KEEP unchanged | **Non-metadata guarantee** (duplicate key refuses from the key column alone). Uses `TRACKER_UNIVERSE`, whose `sheet.rowKeyBindings` entry is removed in support, with no scenario edit |
| test scenario | `:272`, `:288`, `:317` (sort, insert, human-edited cell mid-run) | KEEP unchanged | **Non-metadata guarantees**: writes land by key after a sort or insert before the fresh resolve; human cell protected. Note: the fake's hook `humanSortsRows` moves metadata rows too, which is harmless |

### `tests/acceptance/sheets-api-target/sheets-target-probe.test.mjs` (delete 1, modify 1)

| Kind | Location | Proposed action | Reason |
|---|---|---|---|
| test scenario | `:73` "passes, and still writes nothing, when rows lack their row-key metadata: healing belongs to apply" | DELETE | Only pins that missing metadata does not fail the probe |
| test scenario | `:40` "passes when credentials, token, scope, Sheet, trash flag and headers all check out, and issues no write-class request" | MODIFY | Line `:52` allows `request.route === 'metadata-search'`; reduce to "every request is a GET". **Non-metadata guarantee** (probe is read-only): KEEP |

### `tests/acceptance/sheets-api-target/import-flow.test.mjs` (delete 1, modify 2)

| Kind | Location | Proposed action | Reason |
|---|---|---|---|
| test scenario | `:271` "@error a binding that fails leaves the import complete and the record in place, for build to heal" (in `describe` "binding row keys is the last, non-fatal step", `:270`) | DELETE with its `describe` | Its whole subject is the binding step |
| test scenario | `:73` "@real-io @adapter-integration creates one Sheet, verifies it, records its id and binds every keyed row" | MODIFY (reword title: drop "and binds every keyed row") | Remove the metadata assertion at `:91-95`. Change `:96-97` from "first is drive-create, the rest are batch-update" to "the only write request is drive-create". **Non-metadata guarantees** (one Sheet, id recorded privately, no secret in output): KEEP |
| test scenario | `:101` "preserves an unknown extra tab and an unknown column: import adds nothing and removes nothing" | MODIFY | Remove `expect(snapshot.tabs.Notes.metadata).toEqual([])` at `:111`. **Non-metadata guarantee** (unknown tab and column preserved): KEEP |
| support helper | `:3` header comment ("then binds row-key metadata"), `:270` describe title | REDUCE / DELETE | |
| support helper | `:56-59` the `sheets` collaborator returns `{ reader, writer }` | REDUCE (optional) to `{ reader }` | Follows the optional `import.mjs` change |

### `tests/acceptance/sheets-api-target/sheets-cli.test.mjs` (modify 1)

| Kind | Location | Proposed action | Reason |
|---|---|---|---|
| test scenario | `:93` "@walking_skeleton ... Operator merges this week alerts into their own Google Sheet and finds their notes untouched" | MODIFY | Remove the `'sheet.rowKeyBindings'` expectation at `:117`. Without the removal the scenario fails: appended Companies and Sources rows would no longer be bound. **Non-metadata guarantee** (the walking skeleton, human notes untouched): KEEP |

### `tests/acceptance/sheets-api-target/google-transport.test.mjs` (delete 1)

| Kind | Location | Proposed action | Reason |
|---|---|---|---|
| test scenario | `:139` "sends a metadata search through the read capability, because a search is a read" | DELETE | Pins the classifier's read treatment of a search. The neighbouring scenario at `:129-137` (a POST through the read capability is refused `sheets.write-not-permitted`) stays and gets sharper: after `classifyRequest` is reduced, every POST is a write |

### `tests/acceptance/sheets-api-target/sheets-fake.test.mjs` (keep 3)

| Kind | Location | Proposed action | Reason |
|---|---|---|---|
| test scenario | `:118` "binds row-key metadata that follows its row through a human sort and an insert (spike-proven, L20)" | KEEP | Tests the fake, not production. A documented Google fact (metadata moves with its row) |
| test scenario | `:204` "accepts a second metadata binding with the same key on one row, and a binding on an empty row inside the grid (L16)" | KEEP | Same: a documented Google fact and a fixture-fidelity check |
| test scenario | `:268` (`'developerMetadata.search'` fixture entry in the live-body comparison) | KEEP | Compares the fake's search body with the captured live body. The live fixture stays as evidence |

### Other test files

| Kind | Location | Proposed action | Reason |
|---|---|---|---|
| test scenario | `sheets-probe-presence.test.mjs`, `sheet-provisioner.test.mjs`, `sheets-credential-store.test.mjs`, `sheets-token-source.test.mjs`, `oauth-profiles.test.mjs`, `endpoints-sheets.test.mjs`, `retry-namespace.test.mjs`, `import-check.test.mjs` | KEEP unchanged | No metadata reference. `sheet-provisioner.test.mjs:50` `driveMetadata` is Drive file metadata (name and MIME type), unrelated |
| test scenario | `oauth-profiles.test.mjs:2,123` "token file bound to its slot" | KEEP unchanged | The word "bound" there is unrelated |

## Support helpers and the fake

| Kind | Location | Proposed action | Reason |
|---|---|---|---|
| support helper | `support/sheets-domain-types.mjs:20,42` import and re-export of `ROW_KEY_METADATA` | DELETE (after the production symbol goes) | |
| support helper | `support/sheets-domain-types.mjs:289-` `aMetadataBody` | DELETE | Used only by the deleted `parseMetadata` scenarios |
| support helper | `support/sheets-domain-types.mjs:338,342` `observeTracker` key `'sheet.rowKeyBindings'` and its entry in `TRACKER_UNIVERSE` | DELETE | Metadata is no longer part of what a merge may change. Removing it from the universe removes the need to edit `allUnchanged(TRACKER_UNIVERSE)` scenarios |
| support helper | `support/sheets-domain-types.mjs:344-346` `isMetadataOnly`, `metadataBatches`; `dataBatches` | DELETE `isMetadataOnly` and `metadataBatches`; REWRITE assertion-free `dataBatches` to return every `batch-update` request (keep the name) | Several kept scenarios use `dataBatches`; keeping the name avoids editing them |
| support helper | `support/sheets-domain-types.mjs:196,201` `observeSheet` key `'sheet.rowKeyMetadata'`, `SHEET_UNIVERSE` | KEEP or DELETE | Verify whether any test uses `observeSheet` or `SHEET_UNIVERSE`; a search found only the definitions in this file. If unused, delete them as dead code, else drop the metadata key |
| support helper | `support/request-model.mjs:34,58-59` `decoded.metadata` and the `createDeveloperMetadata` branch of `decode` | DELETE | The decoder need not understand a kind that cannot be built. A stray one is then caught by the allow-list property scenario (`sheets-requests.test.mjs:24`) |
| support helper | `support/request-model.mjs:104,119` `unboundKeys: []` in generated resolutions | DELETE | Field retired |
| fake behaviour | `support/sheets-fake.mjs:9-39` ledger, `:52` `REAL_ROW_KEY_METADATA`, `:214-259,269` `bindMetadata` seeding, `:288,347-367,523,533` `metadata-search` route and body, `:425-433` `createDeveloperMetadata`, `:670-680` snapshot `metadata` | KEEP | The human's expectation confirmed: the fake keeps modelling Google as documented facts. Nothing in it depends on production calling those endpoints, so nothing breaks. Two consequences: `bindMetadata: false` becomes unused after the deleted scenarios go (`sheets-target-apply.test.mjs:536,596,610,622`, `sheets-target-probe.test.mjs:74`); leave the option, or remove it when convenient. And the fake still seeds metadata on known tabs by default, so metadata a run leaves in a snapshot is seeded, never created by production |
| script probe | `scripts/sheets-live-check.mjs:729-734` probes `probeDuplicateMetadata` (A17), `probeMetadataLimits` (A10), `probeMetadataSearch` (A19), `probeMetadataFollowsRows` (L20), `probeValuesByDataFilter` (A9), and `:34,215-226,565-566,673-699` helpers `ROW_KEY`, `rowKeyLookup`, `bindKey`, the import-sized chunk probe for A14 | KEEP | The human's expectation confirmed. They record Google facts, and the script imports nothing metadata-related from `src/` (only `endpoints`, `oauth`, `oauth-loopback`). Two things to know: (1) `--self-test` imports the fake (`:847`) and checks probes against its metadata modelling at `:904,928,933`, so the fake must keep that modelling; (2) a full live run would again spend metadata storage in the scratch Sheet (the cap that motivated this retirement) and would exercise endpoints production no longer uses. Consider a script note, not a code change |
| script probe | `scripts/sheets-live-check.mjs:53,~570` required fixture `'developerMetadata.search'` | KEEP | A captured live body in `deliver/live-fixtures.json` that the fake test at `sheets-fake.test.mjs:268` compares against |

## Documentation lines that state the retired behaviour

| Kind | Location | Proposed action | Reason |
|---|---|---|---|
| doc line | `docs/feature/sheets-api-target/feature-delta.md` (DESIGN sections, ledger, API Assumptions) | DONE in this change (superseded markers, amendment section) | |
| doc line | `docs/product/architecture/brief.md` section 13 | DONE in this change | |
| doc line | `docs/decisions/DR-0012-sheets-target-uses-drive-file-scope.md:18,23,29,33,38-39,101,114,119-125,140` | The orchestrator amends | Says metadata is a second locator and tripwire, a disagreement refuses the apply, write-by-metadata is a test obligation, and binding is non-fatal. Line 114 (spike assumption 3 "both by re-reading the key column and by developer metadata") is a verified spike fact and can stay as history |
| doc line | `docs/feature/sheets-api-target/deliver/live-findings.md:17,22,27,34,38,49,60` | Annotate (not edited here) | Assumption results A9, A14, A19, the metadata-value limit, and the storage-limit row 38 ("row-key binding is non-fatal; beyond the cap new rows stay unbound and the receipt warns `sheets.metadata-pending`") state the old handling. The measurements are facts and stay |
| doc line | `docs/feature/sheets-api-target/deliver/roadmap.json:93,114,118,130,255,260,262,277,315,319,334,387,395,410` | Leave | Historical DELIVER plan. Do not rewrite history; the follow-up change writes its own roadmap step |
| doc line | `docs/feature/sheets-api-target/distill/red-classification.md:36,193,221-233,286-299,324-355` | Leave | Historical DISTILL classification of the scenarios this change deletes |
| doc line | `docs/evolution/2026-09-30-sheets-api-target.md:21,26,44,45,48` | Add a superseded note (not edited here) | Archived narrative says binding stays non-fatal and chunked at 100, 541 keys bound, and "write-by-metadata: proven live, deliberately not used" |
| doc line | `docs/architecture/atdd-infrastructure-policy.md:37` | Check | One matching line; not read in full |
| doc line | `docs/feature/sheets-api-target/spike/{findings,wave-decisions,runbook}.md` | Leave | Spike record: metadata following a row (spike 3b) is a verified fact |

## Guarantees that must survive the retirement

These scenarios look metadata-related or contain metadata detail, and guard a guarantee that is **not** about metadata. Keep them and drop only the metadata detail.

| Guarantee | Scenario | Action |
|---|---|---|
| Duplicate key refuses from the key column alone | `sheets-target-apply.test.mjs:348`; `sheets-model.test.mjs:205` | KEEP (`:205` drops `metadata: []`) |
| `appendsSkippedAsPresent`, no double append after a lost answer | `sheets-target-apply.test.mjs:398`, `:114` | KEEP unchanged |
| Atomic single batch across tabs | `sheets-target-apply.test.mjs:49`, `:382` | KEEP (`:49` loses one delta entry and the five-kind list) |
| Human-owned and keyless human rows protected, appends land below a typed row | `sheets-target-apply.test.mjs:303`, `:317`, `:331` | KEEP (metadata lines dropped) |
| Throttled or unauthenticated read at resolution refuses and writes nothing | `sheets-target-apply.test.mjs:583` (2 scenarios) | REWRITE to a resolution read, do not delete |
| Key found per tab, never mixed across tabs | `sheets-model.test.mjs:231` | REDUCE, keep |
| Composite Sources key is a JSON array | `sheets-model.test.mjs:296`, `:136-149` | KEEP |
| Unknown tab and column preserved by import | `import-flow.test.mjs:101` | KEEP (`:111` dropped) |
| Import creates one Sheet, records privately, leaks no secret | `import-flow.test.mjs:73` | KEEP (title and metadata assertion changed) |
| Probe and reader are read-only | `sheets-target-probe.test.mjs:40`; `sheets-target-apply.test.mjs:633` | KEEP (`:52` tightened) |
| Read capability refuses a POST | `google-transport.test.mjs:129-137` | KEEP unchanged |
| Allow-list has no delete, clear or sort | `sheets-requests.test.mjs:19`, `:24` | KEEP (`:19` four kinds) |

## Consequences to decide

Not resolved here.

1. **Classifier treatment of a metadata search.** This inventory proposes reducing `classifyRequest` to "GET is a read, else a write", which also deletes the transport scenario at `google-transport.test.mjs:139`. The alternative is to keep `isMetadataSearch` as a documented read (harmless, since nothing sends it). The proposal is stricter and matches "no metadata request is ever sent"; the alternative touches less code.
2. **Receipt shape.** The amendment retires `warnings` and `metadataPending`. Whether `warnings` should remain as an always-empty array for a future warning, or go, is the human's call; this inventory proposes it goes (`SheetsWarning` has no remaining member).
3. **`import` collaborators.** After binding goes, `import` needs only a reader, so `harvest.mjs:255` could stop constructing a writer for import. Optional and cosmetic.
4. **A16 and A18 mislabelled in the request.** The instruction named A16 and A18 among the metadata assumptions. By `feature-delta.md` they are "a leading `=` is stored as text" and "caller-chosen `sheetId`", which the request builder still relies on (`chooseSheetIds`, string cells). Only A9, A10, A17 and A19 were marked "no longer relied on". Confirm this reading. The ledger rows the instruction named (L04 part, L09, L16, L18) are marked; L15 and L17 are not.
5. **Other ledger and assumption rows that lean on metadata, not marked because not named.** A14 and L13 (the quota measurement mentions "import's metadata chunks" and the storage limit finding), L20 (metadata follows a row through `sortRange` and `insertDimension`), and the A14 wording "headroom for import's metadata chunks". The measurements stay facts; whether to annotate them is not decided.
6. **Live-check script hygiene.** A full run of `scripts/sheets-live-check.mjs` writes metadata into the scratch Sheet, the behaviour that hit Google's cap. Whether to add a script note, or skip the metadata probes by default, is not decided. This inventory leaves the script unchanged, as expected.
7. **Existing operator data.** The operator's Sheet already holds 541 row-key entries. Nothing reads them after this change, and Google offers a delete request for them, but the amendment's allow-list has no delete kind by design. Whether to leave them in place, or remove them once by hand, is not decided. They do not block any write.
8. **Fewer reads per apply.** Removing `bindFresh` removes one full resolution (about three reads) after every write. This is a side effect, not a decision, but it changes the "about five read calls" cost line in the DESIGN; the amendment edits that line.
9. **`import.duplicate-key` rationale.** Its stated reason was "metadata would be ambiguous". The refusal still guards against a later `sheets.duplicate-key` at build, so it stays; the DESIGN row was reworded, and the human may want to confirm the refusal is still wanted at import.
10. **Residual risk pin.** The accepted residual risk (a human sort, insert or delete inside the write window can misdirect a harvester-owned write) has an acceptance test only for a sort or insert *before* the fresh resolve (`sheets-target-apply.test.mjs:272,288`), and one for a human edit *between* resolve and write (`:317`). No scenario exercises a sort *inside* the window, and none can prove it safe. Whether to add a scenario that documents the misdirected write is not decided.
