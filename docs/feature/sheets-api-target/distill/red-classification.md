# RED classification: sheets-api-target DISTILL

Historical (2026-09-30): this classification is a DISTILL-time snapshot. All scenarios are now active; the pending-scenario helper `tests/acceptance/sheets-api-target/support/red-gate.mjs` was removed at the end of DELIVER.

Every scenario was run once with `RED_GATE=1` against the RED scaffolds and the unchanged existing modules. One line per scenario. `RED MISSING_FUNCTIONALITY` is the correct RED (an assertion or a scaffold throw reached by a well-formed test). `GREEN_TODAY` scenarios pin behaviour or structure that already holds (regression pins); `INFRA_GREEN` scenarios test the fake itself and run unskipped. No scenario failed on an import, fixture or setup error.

Totals (excluding the fake's own tests): 361 scenarios, 327 RED, 34 GREEN_TODAY; 12 infrastructure tests green.

## acceptance/sheets-api-target/endpoints-sheets.test.mjs

- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): default to the Google hosts, with the Gmail and token bases unchanged
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): an empty override is no override
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): a loopback override maps all three new bases, beside the two it already mapped
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @property one loopback host and port covers every base, and a path on the override is not carried into them
- GREEN_TODAY: @error refuses "https://sheets.googleapis.com" with gmail.base-url-not-loopback and returns no partial table
- GREEN_TODAY: @error refuses "http://127.0.0.1.evil.example" with gmail.base-url-not-loopback and returns no partial table
- GREEN_TODAY: @error refuses "http://evil.example@127.0.0.1:9" with gmail.base-url-not-loopback and returns no partial table
- GREEN_TODAY: @error refuses "http://user:secret@127.0.0.1:9" with gmail.base-url-not-loopback and returns no partial table
- GREEN_TODAY: @error refuses "http://0.0.0.0:80" with gmail.base-url-not-loopback and returns no partial table
- GREEN_TODAY: @error refuses "http://127.0.0.2:9" with gmail.base-url-not-loopback and returns no partial table
- GREEN_TODAY: @error refuses "ftp://127.0.0.1" with gmail.base-url-not-loopback and returns no partial table
- GREEN_TODAY: @error refuses "http://[::1]x" with gmail.base-url-not-loopback and returns no partial table
- GREEN_TODAY: @error refuses "not a url" with gmail.base-url-not-loopback and returns no partial table

## acceptance/sheets-api-target/google-transport.test.mjs

- RED MISSING_FUNCTIONALITY (scaffold reached): returns the status, headers and parsed body of a read, with the bearer attached and never in the URL
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refreshes an expired token once and repeats the same request with the new one
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a second 401 after the refresh is sheets.unauthorized, with one refresh and no third attempt
- RED MISSING_FUNCTIONALITY (scaffold reached): @error retries a 429 honouring Retry-After, and succeeds on the third attempt
- RED MISSING_FUNCTIONALITY (scaffold reached): @error retries a 403 carrying a rate reason as a 429
- RED MISSING_FUNCTIONALITY (scaffold reached): @error names sheets.quota-exhausted after three throttled attempts, and sheets.server-error after three failed ones
- RED MISSING_FUNCTIONALITY (scaffold reached): @error hands back a 403 authorisation failure and a 404 as they are, after one attempt, for the adapter to name
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a lost connection reads as status 0 and is retried like a server error, then named sheets.server-error
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses to send a write-class request at all, and names sheets.write-not-permitted
- RED MISSING_FUNCTIONALITY (scaffold reached): sends a metadata search through the read capability, because a search is a read
- RED MISSING_FUNCTIONALITY (scaffold reached): sends the write once and returns the answer
- RED MISSING_FUNCTIONALITY (scaffold reached): @error hands a 429 and a 503 back after ONE attempt: the adapter must re-verify before any second try
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a lost response is status 0, reported once and never retried
- RED MISSING_FUNCTIONALITY (scaffold reached): @error an expired token is refreshed once and the same write is sent again, since a 401 means nothing was applied
- RED MISSING_FUNCTIONALITY (scaffold reached): @error passes redirect: error on each bearer-carrying request, reads and writes alike
- RED MISSING_FUNCTIONALITY (scaffold reached): @error names drive.quota-exhausted, not a sheets code, when Drive throttles every attempt

## acceptance/sheets-api-target/import-check.test.mjs

- RED MISSING_FUNCTIONALITY (scaffold reached): accepts the operator tracker: three tabs, an unknown column, human columns filled in
- RED MISSING_FUNCTIONALITY (scaffold reached): accepts an unknown extra tab and a Jobs tab with only a header, both preserved by import
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses import.no-dedup-key-column when the Jobs tab is absent or has no Dedup Key
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses import.key-column-missing for a Companies tab without Company, or a Sources tab without Source or Search Term
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses import.unrecognised-headers when the Jobs tab shares no harvester-owned or human-owned header, key aside
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error refuses import.duplicate-key, naming the key, when a Jobs key appears on two rows
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error refuses import.duplicate-key, naming the key, when a Companies key appears on two rows
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error refuses import.duplicate-key, naming the key, when a Sources key appears on two rows
- RED MISSING_FUNCTIONALITY (scaffold reached): rows with a blank key are never duplicates of one another
- RED MISSING_FUNCTIONALITY (scaffold reached): @property a tracker with unique keys and the harvester header is always accepted
- RED MISSING_FUNCTIONALITY (scaffold reached): accepts a Sheet with the same tabs, headers, row counts and keys
- RED MISSING_FUNCTIONALITY (scaffold reached): a date that reads back as a serial number is not a mismatch: cell values are not compared
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses import.conversion-mismatch when a tab was lost
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses import.conversion-mismatch when a tab appeared
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses import.conversion-mismatch when a header was renamed
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses import.conversion-mismatch when two headers swapped places
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses import.conversion-mismatch when a row was dropped
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses import.conversion-mismatch when a row was added
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses import.conversion-mismatch when a key changed but the count did not
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the mismatch names the tab and no cell value
- RED MISSING_FUNCTIONALITY (scaffold reached): @property a Sheet identical to its workbook always passes, and dropping any one row always fails

## acceptance/sheets-api-target/import-flow.test.mjs

- RED MISSING_FUNCTIONALITY (scaffold reached): @real-io @adapter-integration creates one Sheet, verifies it, records its id and binds every keyed row
- RED MISSING_FUNCTIONALITY (scaffold reached): preserves an unknown extra tab and an unknown column: import adds nothing and removes nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a workbook that has a Jobs header only is imported: the operator may start from an empty tracker
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a second import refuses import.already-imported before any request, and creates no second Sheet
- RED MISSING_FUNCTIONALITY (scaffold reached): @error an existing target record is never overwritten, whatever it holds
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses import.file-missing when --from names no file
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses import.not-a-workbook when --from is not an .xlsx, even one SheetJS would parse
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses import.no-dedup-key-column when the Jobs tab is absent, creating nothing and recording nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses import.no-dedup-key-column when the Jobs tab has no Dedup Key column, creating nothing and recording nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses import.key-column-missing when the Companies tab has no Company column, creating nothing and recording nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses import.key-column-missing when the Sources tab has no Search Term column, creating nothing and recording nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses import.unrecognised-headers when the Jobs tab shares no header with the harvester, creating nothing and recording nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses import.duplicate-key when two Jobs rows share a Dedup Key, creating nothing and recording nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses import.conversion-mismatch when a data row is lost, deletes the created file and records nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses import.conversion-mismatch when a header is renamed, deletes the created file and records nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses import.conversion-mismatch when a tab is lost, deletes the created file and records nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a record that cannot be written refuses import.record-failed and deletes the file it created
- RED MISSING_FUNCTIONALITY (scaffold reached): @error when that cleanup also fails the refusal prints the file id, which is not a secret, for manual removal
- RED MISSING_FUNCTIONALITY (scaffold reached): @error deletes only the id it created: the operator other files are never named in a delete
- RED MISSING_FUNCTIONALITY (scaffold reached): @error passes drive.quota-exhausted through when Drive throttles the upload, and records nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error passes drive.storage-full through when the operator Drive is full, and records nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a binding that fails leaves the import complete and the record in place, for build to heal

## acceptance/sheets-api-target/oauth-profiles.test.mjs

- GREEN_TODAY: the consent URL asks for gmail.readonly and nothing else
- GREEN_TODAY: @error a drive.file grant is refused for Gmail as gmail.scope-mismatch
- GREEN_TODAY: @error a Gmail token file without a mailbox is still invalid, and its refusals keep the gmail namespace
- GREEN_TODAY: the two profiles name different scopes and different refusal namespaces, and neither can be changed
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): the consent URL asks for drive.file, offline access, PKCE S256 and a state
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @property whatever the state, challenge and client, the scope is exactly drive.file and names no mail scope
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): accepts exactly drive.file for Sheets
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error @property refuses every scope set other than exactly drive.file, by name
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error refuses an absent or non-text scope for Sheets
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error refuses the Gmail scope under the Sheets profile, and drive.file under the Gmail profile
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): a refresh answering drive.file yields an access token, its scope and its expiry
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a wider grant is refused for the scope: sheets.scope-mismatch
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the Gmail grant is refused for the scope: sheets.scope-mismatch
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error invalid_grant on a refresh means the operator must consent again: sheets.reauth-required
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a server error on a refresh is a token-endpoint error: sheets.token-endpoint-error
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a success without an access token is a token-endpoint error: sheets.token-endpoint-error
- GREEN_TODAY: @error a failed code exchange stays auth.exchange-failed whatever the profile: auth.exchange-failed
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a code exchange that yields no refresh token is auth.no-refresh-token: auth.no-refresh-token
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): reads a Sheets token file that has no mailbox
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a Gmail token file read as the Sheets slot is refused as sheets.scope-mismatch, and the reverse as gmail.scope-mismatch
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a Sheets token file with no refresh token, an unknown version or non-text fields is sheets.credential-invalid
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the Sheets slot names its own permission and shape refusals, so an operator is told which credential is wrong
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error no refusal message carries a credential value

## acceptance/sheets-api-target/retry-namespace.test.mjs

- GREEN_TODAY: @property the Gmail namespace is the default and names Gmail refusals exactly as before
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error @property a spent throttled or failing call is refused under the caller namespace
- GREEN_TODAY: @property a throttled call is retried while attempts remain, whatever the namespace
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error @property a call that retrying cannot mend is named unauthorized or request-rejected in the caller namespace, never retried
- GREEN_TODAY: @error the Gmail namespace keeps its own name for a rejected query
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @property a 403 with a rate reason is retried exactly as a 429, in any namespace
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error @property a 403 with any authorisation reason is never retried and is named unauthorized, in any namespace
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a 403 with no reason at all is an authorisation failure, not a rate limit

## acceptance/sheets-api-target/sheet-provisioner.test.mjs

- RED MISSING_FUNCTIONALITY (scaffold reached): @real-io @adapter-integration uploads the workbook once as a native Sheet and returns its id
- RED MISSING_FUNCTIONALITY (scaffold reached): sends the workbook bytes as they are, asks for the native Sheet type, and issues no other write
- RED MISSING_FUNCTIONALITY (scaffold reached): never follows a link in the answer: the file is not opened, fetched or listed
- RED MISSING_FUNCTIONALITY (scaffold reached): offers create, delete and probe and nothing that could update a file
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a create whose answer is lost is reported after ONE attempt: a replay could make a second Sheet
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses drive.quota-exhausted when Drive throttles the upload, creates nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses drive.storage-full when the operator Drive is full, creates nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses drive.unauthorized when the app is not authorised for Drive, creates nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses drive.unauthorized when the token is refused even after a refresh, creates nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses drive.server-error when Drive is failing, creates nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses drive.request-rejected when Drive rejects the upload as malformed, creates nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses drive.response-malformed when a 200 answer names no file id, creates nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses drive.response-malformed when a 200 answer is not JSON, creates nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses drive.response-malformed when a 200 answer names a file that is not a native Sheet, creates nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): removes the file it created and issues exactly one delete for that id
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses drive.not-created-here for any other id, and sends no request
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a second provisioner in another process cannot delete what the first created
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a delete Drive refuses is reported by name and leaves the file
- RED MISSING_FUNCTIONALITY (scaffold reached): passes with a refreshable drive.file token, and issues no Drive or Sheets request
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.credential-missing when the Sheets token file is absent
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.reauth-required when the refresh token was revoked
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.scope-mismatch when the granted scope is wider than drive.file

## acceptance/sheets-api-target/sheets-cli.test.mjs

- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @walking_skeleton @driving_adapter @real-io Operator merges this week alerts into their own Google Sheet and finds their notes untouched
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @driving_adapter build --target sheets --dry-run prints the plan and writes nothing to the Sheet, the fake recording zero write requests
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error @driving_adapter refuses build.target-conflict when --out or --merge is given with --target sheets, before any request
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error @driving_adapter refuses an unrecognised --target by name, before any request
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error @driving_adapter refuses sheets.not-imported, pointing at `harvest import`, when no Sheet has been recorded
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error @driving_adapter refuses sheets.credential-permissions for a Sheets token readable by everyone, before any request
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error @driving_adapter a revoked grant refuses sheets.reauth-required naming `harvest auth --target sheets`, and writes nothing
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error @driving_adapter a Sheet in the bin refuses sheets.spreadsheet-trashed and writes nothing
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error @driving_adapter a Sheet holding one job key on two rows refuses sheets.duplicate-key and changes nothing
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error @driving_adapter a Sheet without its Dedup Key column refuses sheets.key-column-missing and changes nothing
- GREEN_TODAY: @error @driving_adapter an empty cache refuses to build, exactly as the offline path does, and writes nothing
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error @driving_adapter an override that is not a loopback host is refused as gmail.base-url-not-loopback, and no token is sent anywhere
- GREEN_TODAY: plain `build --out` still writes the offline workbook and never touches the Sheet
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @driving_adapter @real-io Operator imports their workbook once: a Sheet is created, its id recorded privately, and nothing secret is printed
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error @driving_adapter a second import refuses import.already-imported and creates no second Sheet
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error @driving_adapter a workbook path that does not exist refuses import.file-missing before any request
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error @driving_adapter a conversion that loses a row refuses import.conversion-mismatch, deletes the created file and records nothing
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @driving_adapter operator imports, previews with --dry-run, then merges: the preview writes nothing and the merge keeps their Status
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @driving_adapter @real-io Operator consents once for drive.file: the refresh token is kept privately in its own file, never printed, and the Gmail token is untouched
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): proves PKCE on the wire: the verifier the token endpoint receives hashes to the challenge the browser was shown
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error @driving_adapter refuses sheets.scope-mismatch when Google grants a wider scope than drive.file, and writes no token file
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error @driving_adapter refuses auth.no-refresh-token when Google sends no refresh token, and writes no token file
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error @driving_adapter refuses auth.consent-denied when the operator denies consent, and writes no token file
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error @driving_adapter refuses auth.state-mismatch when the redirect carries a forged state, and writes no token file
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error @driving_adapter refuses auth.no-code when the redirect carries no code, and writes no token file
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error @driving_adapter an unrecognised --target is refused by name, and no consent is started
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error @driving_adapter operator revokes access, build refuses; re-running auth --target sheets and building again recovers

## acceptance/sheets-api-target/sheets-fake.test.mjs

- INFRA_GREEN: refuses a call with no bearer token, and serves the token endpoint with drive.file
- INFRA_GREEN: answers spreadsheets.get with tab ids and grid sizes, and values:batchGet with a used range that omits `values` when empty
- INFRA_GREEN: applies a batch in one piece, and applies nothing when one request is invalid (L03)
- INFRA_GREEN: rejects a write beyond the grid columns until appendDimension makes room (L07), and never writes a formula (L15)
- INFRA_GREEN: keeps a cell format under fields=userEnteredValue and resets it under * (L08)
- INFRA_GREEN: appends rows after the last row holding data, and creates a tab with a chosen id (L14, L17)
- INFRA_GREEN: binds row-key metadata that follows its row through a human sort and an insert (spike-proven, L20), and refuses a duplicate (L16)
- INFRA_GREEN: lets a scenario act between two calls, reject the nth request, and lose a response after applying (L03)
- INFRA_GREEN: answers rate limits, authorisation failures and scripted overrides ahead of the auth check
- INFRA_GREEN: converts an uploaded workbook into a native Sheet, reports trashed, and deletes only by id (spike-proven, L20)
- INFRA_GREEN: models Drive conversion that loses data, for the import fidelity check (L02, L19)
- INFRA_GREEN: has no drive.file profile route and no values-API write route (L04, L10)

## acceptance/sheets-api-target/sheets-model.test.mjs

- RED MISSING_FUNCTIONALITY (scaffold reached): yields the recorded id and every tab with its id, title and grid size
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.id-mismatch when the Sheet answering is not the recorded one
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.response-malformed when a 200 answer is null
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.response-malformed when a 200 answer is an array
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.response-malformed when a 200 answer is an empty object
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.response-malformed when a 200 answer is text
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.response-malformed when a 200 answer is no tab list
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.response-malformed when a 200 answer is a tab with no properties
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.response-malformed when a 200 answer is a tab with no id
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.response-malformed when a 200 answer is a tab with no title
- RED MISSING_FUNCTIONALITY (scaffold reached): yields one grid per requested tab, in order, and an empty grid for a range that answers with no values
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.response-malformed when the answer has no valueRanges
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.response-malformed when the answer has fewer ranges than tabs asked for
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.response-malformed when the answer has a range whose values are not rows
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.response-malformed when the answer has null
- RED MISSING_FUNCTIONALITY (scaffold reached): row 1 is the header, and a blank cell reads as null, a short row is padded, and typed values survive
- RED MISSING_FUNCTIONALITY (scaffold reached): a blank interior row is kept, so rows[i] is always sheet row i+2
- RED MISSING_FUNCTIONALITY (scaffold reached): an empty tab has no columns and no rows
- RED MISSING_FUNCTIONALITY (scaffold reached): @property every data row is kept in place with its typed values, whatever the header and the blanks
- RED MISSING_FUNCTIONALITY (scaffold reached): yields each row-key metadata with its row and tab, and nothing when none matched
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.response-malformed for an answer that is not an object, or a match with no location
- RED MISSING_FUNCTIONALITY (scaffold reached): one key value is its own text and several are a JSON array
- RED MISSING_FUNCTIONALITY (scaffold reached): @property two different composite keys never share an encoding, however the words are cut
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a row with any blank key column has no key, so it is never matched and never given metadata
- RED MISSING_FUNCTIONALITY (scaffold reached): locates every column by its header text, wherever a human has put it
- RED MISSING_FUNCTIONALITY (scaffold reached): locates every keyed row by its position in the key column, skipping blank rows and rows a human added with no key
- RED MISSING_FUNCTIONALITY (scaffold reached): a keyed row with no metadata is reported unbound, in row order, and a bound row is not
- RED MISSING_FUNCTIONALITY (scaffold reached): @property when metadata agrees with the key column for every row, nothing refuses and nothing is unbound
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error refuses sheets.duplicate-key, naming the key, when one key stands on two rows
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error refuses sheets.row-identity-conflict, naming the key, when its metadata sits on a different row
- RED MISSING_FUNCTIONALITY (scaffold reached): metadata for a key that no longer stands in the key column is ignored: there is nothing to write there
- RED MISSING_FUNCTIONALITY (scaffold reached): the same first key column on two tabs never mixes: metadata is read per tab
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error refuses sheets.key-column-missing for Jobs without Dedup Key that holds data rows, naming the tab
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error refuses sheets.key-column-missing for Companies without Company that holds data rows, naming the tab
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error refuses sheets.key-column-missing for Sources without Search Term that holds data rows, naming the tab
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error refuses sheets.key-column-missing for Sources without Source that holds data rows, naming the tab
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error refuses sheets.key-column-missing for a Jobs tab with no header, or a header without Dedup Key, even with no data rows (human-approved)
- RED MISSING_FUNCTIONALITY (scaffold reached): a tab with no data rows resolves without its key column, and an empty tab with no header resolves as new
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.duplicate-header when a key column or a harvester-owned column is named twice
- RED MISSING_FUNCTIONALITY (scaffold reached): a human-owned or unknown column named twice is not ambiguous for the harvester, so it is left alone
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.tab-missing when there is no Jobs tab, but a missing Companies or Sources tab is simply absent from the result
- RED MISSING_FUNCTIONALITY (scaffold reached): the Sources composite key is located as an ordered JSON array, and a blank Search Term is never located
- RED MISSING_FUNCTIONALITY (scaffold reached): the Jobs header the harvester wrote itself resolves every one of its 26 columns

## acceptance/sheets-api-target/sheets-probe-presence.test.mjs

- GREEN_TODAY: sheets-target reader exports a probe
- GREEN_TODAY: sheets-target writer exports a probe
- GREEN_TODAY: sheet-provisioner exports a probe
- GREEN_TODAY: sheets credential store exports a probe
- GREEN_TODAY: @error src/adapters/sheets-target.mjs imports no node: module, no other adapter, and calls no global fetch
- GREEN_TODAY: @error src/adapters/sheets-target.mjs never attaches a bearer header itself
- GREEN_TODAY: @error src/adapters/sheet-provisioner.mjs imports no node: module, no other adapter, and calls no global fetch
- GREEN_TODAY: @error src/adapters/sheet-provisioner.mjs never attaches a bearer header itself
- RED MISSING_FUNCTIONALITY (scaffold reached): only the shared transport attaches a bearer, and it refuses redirects on every request that carries one
- GREEN_TODAY: @error src/core/sheets-model.mjs is pure: no node: import, no adapter or cli import, no global fetch, no class
- GREEN_TODAY: @error src/core/sheets-requests.mjs is pure: no node: import, no adapter or cli import, no global fetch, no class
- GREEN_TODAY: @error src/core/import-check.mjs is pure: no node: import, no adapter or cli import, no global fetch, no class
- GREEN_TODAY: @error src/core/scope-profiles.mjs is pure: no node: import, no adapter or cli import, no global fetch, no class
- GREEN_TODAY: @error src/core/sheets-refusals.mjs is pure: no node: import, no adapter or cli import, no global fetch, no class

## acceptance/sheets-api-target/sheets-requests.test.mjs

- GREEN_TODAY: the allow-list is exactly the five constructable request types, and names no delete, clear or sort
- RED MISSING_FUNCTIONALITY (scaffold reached): @property every request in the body is one allow-listed type, one per entry
- RED MISSING_FUNCTIONALITY (scaffold reached): @property @error an update lands only on a row resolved from a planned key, never on another row
- RED MISSING_FUNCTIONALITY (scaffold reached): @property @error an update never touches a human-owned column, an unknown column or a key cell
- RED MISSING_FUNCTIONALITY (scaffold reached): @property header cells are written only for the planned appendColumns, in order, at the first free columns
- RED MISSING_FUNCTIONALITY (scaffold reached): @property appended rows are new rows: one per planned append, blank outside harvester-owned and key columns
- RED MISSING_FUNCTIONALITY (scaffold reached): @property the grid always has room: appendDimension widens exactly the shortfall, and only when there is one
- RED MISSING_FUNCTIONALITY (scaffold reached): @property every write names the field mask userEnteredValue and nothing broader
- RED MISSING_FUNCTIONALITY (scaffold reached): @property a cell whose fresh value already equals the planned value is not in the request, and every changed cell is
- RED MISSING_FUNCTIONALITY (scaffold reached): @property harvested text is written as text, numbers as numbers, and a null clears the cell: a formula is never constructed
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.header-changed when a column the plan updates has vanished from the Sheet since the plan was made
- RED MISSING_FUNCTIONALITY (scaffold reached): a tab the Sheet lacks is created in the same batch with a chosen id, its header and rows appended after it
- RED MISSING_FUNCTIONALITY (scaffold reached): a Sources update is located by its composite key as an ordered JSON array, never a joined string
- RED MISSING_FUNCTIONALITY (scaffold reached): @error the Companies key is also a harvester column, and an existing Company cell is still never written
- RED MISSING_FUNCTIONALITY (scaffold reached): the body carries no precondition and no data filter: Google would accept a bogus one, so sending one would be theatre
- RED MISSING_FUNCTIONALITY (scaffold reached): @error drops an append whose key is already in the Sheet, counts it, and keeps the appends that are genuinely new
- RED MISSING_FUNCTIONALITY (scaffold reached): leaves a plan whose appends are all new exactly as it was
- RED MISSING_FUNCTIONALITY (scaffold reached): an update whose every cell already holds the planned value produces no write at all
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.plan-too-large when the serialised body exceeds the limit
- RED MISSING_FUNCTIONALITY (scaffold reached): accepts a body exactly at the limit
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the refusal names no cell value
- RED MISSING_FUNCTIONALITY (scaffold reached): @property every binding becomes one createDeveloperMetadata on exactly that row, keyed and valued, and nothing more
- RED MISSING_FUNCTIONALITY (scaffold reached): GET spreadsheets/abc is a read
- RED MISSING_FUNCTIONALITY (scaffold reached): GET abc/values:batchGet is a read
- RED MISSING_FUNCTIONALITY (scaffold reached): POST abc/developerMetadata:search is a read
- RED MISSING_FUNCTIONALITY (scaffold reached): GET files/abc is a read
- RED MISSING_FUNCTIONALITY (scaffold reached): @error POST spreadsheets/abc:batchUpdate is a write
- RED MISSING_FUNCTIONALITY (scaffold reached): @error POST abc/values:batchUpdate is a write
- RED MISSING_FUNCTIONALITY (scaffold reached): @error PUT values/Jobs!A1 is a write
- RED MISSING_FUNCTIONALITY (scaffold reached): @error POST values/Jobs!A1:append is a write
- RED MISSING_FUNCTIONALITY (scaffold reached): @error POST abc/values:batchClear is a write
- RED MISSING_FUNCTIONALITY (scaffold reached): @error POST v3/files is a write
- RED MISSING_FUNCTIONALITY (scaffold reached): @error DELETE files/abc is a write
- RED MISSING_FUNCTIONALITY (scaffold reached): @error PATCH files/abc is a write
- RED MISSING_FUNCTIONALITY (scaffold reached): @error @property any non-GET request other than a metadata search is a write, whatever its path
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a method the classifier does not recognise is a write, not a read

## acceptance/sheets-api-target/sheets-target-apply.test.mjs

- RED MISSING_FUNCTIONALITY (scaffold reached): @real-io @adapter-integration one batch merges three tabs: harvester cells change, new rows are appended, no human or unknown cell moves
- RED MISSING_FUNCTIONALITY (scaffold reached): a tab the Sheet lacks is created in the same batch, with its header and rows
- RED MISSING_FUNCTIONALITY (scaffold reached): merging the same harvest again changes nothing and sends no data batch
- RED MISSING_FUNCTIONALITY (scaffold reached): a cell already holding the planned value is not written: one changed title is one cell written
- RED MISSING_FUNCTIONALITY (scaffold reached): a null planned value clears the cell, as the offline tracker does
- RED MISSING_FUNCTIONALITY (scaffold reached): a cell format a person set survives the write of its value
- RED MISSING_FUNCTIONALITY (scaffold reached): an unknown extra tab is left exactly as it was
- RED MISSING_FUNCTIONALITY (scaffold reached): a column the operator reordered is still written by its header
- RED MISSING_FUNCTIONALITY (scaffold reached): a column the operator added is preserved, values and all
- RED MISSING_FUNCTIONALITY (scaffold reached): a harvester column the operator renamed is re-added at the right, and the renamed column is kept as an unknown column
- RED MISSING_FUNCTIONALITY (scaffold reached): a harvester column the operator deleted is re-added at the right and filled for every keyed row
- RED MISSING_FUNCTIONALITY (scaffold reached): @error the key column renamed between read and apply refuses sheets.key-column-missing and writes nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a column the plan updates vanishing between read and apply refuses sheets.header-changed and writes nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a key column or harvester column named twice refuses sheets.duplicate-header and writes nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): a sort between read and apply does not misdirect a write: each key gets its own value
- RED MISSING_FUNCTIONALITY (scaffold reached): a row inserted between read and apply pushes rows down, and no write lands on the wrong row or on the inserted row
- RED MISSING_FUNCTIONALITY (scaffold reached): a row typed into the Sheet at the last second is never overwritten: appended rows land below it
- RED MISSING_FUNCTIONALITY (scaffold reached): a human-owned cell edited mid-run keeps the operator value
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a hand-typed row with no key is never matched and never given a key binding
- RED MISSING_FUNCTIONALITY (scaffold reached): @error one key on two rows refuses sheets.duplicate-key, naming the key
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a key that no longer matches its row binding refuses sheets.row-identity-conflict, naming a key
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a batch Google rejects applies nothing on any of the three tabs, and names sheets.request-rejected without a cell value
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a batch applied but its answer lost is not applied twice: the retry finds the row present and appends nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error every attempt is re-verified against a fresh read before its write, first or retried
- RED MISSING_FUNCTIONALITY (scaffold reached): @error an outcome that stays unknown after three attempts is sheets.apply-outcome-unknown, and says a re-run is safe
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a throttled write is sheets.quota-exhausted after three attempts: nothing was applied, so it is not unknown
- RED MISSING_FUNCTIONALITY (scaffold reached): @error an unauthenticated write after one refresh is sheets.unauthorized: write ability is proven by the apply itself
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a 403 authorisation reason on the write is sheets.unauthorized after one attempt
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a 200 answer that is not a Sheet at resolution refuses sheets.response-malformed and writes nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.plan-too-large after skipping unchanged cells, sends no batch and changes nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): a plan whose cells are all unchanged is never too large, however small the limit
- RED MISSING_FUNCTIONALITY (scaffold reached): an appended row is bound only after it exists, by a further batch that carries metadata alone
- RED MISSING_FUNCTIONALITY (scaffold reached): a keyed row that lacks its binding is bound on the next merge, and merging again binds nothing more
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a binding that fails is reported as sheets.metadata-pending, not thrown, and the next merge heals it
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a failing binding lookup falls back to the key column, warns sheets.metadata-unavailable, and still merges
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a binding lookup that is throttled still refuses sheets.quota-exhausted and writes nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a binding lookup that is unauthenticated still refuses sheets.unauthorized and writes nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): binding every keyed row that lacks one reports how many were bound, and a second call binds none
- RED MISSING_FUNCTIONALITY (scaffold reached): binding a large tracker goes in chunks of at most 100 requests (pinned proposal), none of them a data write
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a chunk Google rejects is counted as pending, not thrown, so import can finish and build can heal
- RED MISSING_FUNCTIONALITY (scaffold reached): @error the reader offers no apply and no bind, and reading writes nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): reading yields the SheetState the merge planner reads: typed values, blanks as null, blank interior rows kept in place
- RED MISSING_FUNCTIONALITY (scaffold reached): reads ask for unformatted values, so a number stays a number (assumption A1)
- RED MISSING_FUNCTIONALITY (scaffold reached): every read is fresh: an edit made between two reads shows in the second
- GREEN_TODAY: the Sheets adapter names no global fetch and imports no node: module, so it can only use what it is handed

## acceptance/sheets-api-target/sheets-target-probe.test.mjs

- RED MISSING_FUNCTIONALITY (scaffold reached): passes when credentials, token, scope, Sheet, trash flag and headers all check out, and issues no write-class request
- RED MISSING_FUNCTIONALITY (scaffold reached): passes with a header-only Jobs tab and no Companies or Sources tab: they are created on apply
- RED MISSING_FUNCTIONALITY (scaffold reached): passes with a Companies tab that has no header at all: an empty tab is treated as new (human-approved)
- RED MISSING_FUNCTIONALITY (scaffold reached): passes, and still writes nothing, when rows lack their row-key metadata: healing belongs to apply
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.credential-missing when the client file is absent, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.credential-missing when the Sheets token file is absent, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.credential-invalid when the client file is not valid, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.credential-invalid when the Sheets token file names no refresh token, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.credential-permissions when the client file is readable by its group, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.credential-permissions when the Sheets token file is readable by everyone, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.credential-permissions when the credential directory is open to its group, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.not-imported when no Sheet has been imported yet, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.target-record-invalid when the target record names no spreadsheet, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.target-record-invalid when the target record is of an unknown version, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.target-record-invalid when the target record is not JSON, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.scope-mismatch when the Sheets token file holds the Gmail token, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.reauth-required when the refresh token has been revoked, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.token-endpoint-error when the token endpoint rejects the client, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.token-endpoint-error when the token endpoint answers with no access token, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.scope-mismatch when the granted scope is wider than drive.file, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.scope-mismatch when the granted scope is narrower than drive.file, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.spreadsheet-unreadable when the Sheet is not found, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.spreadsheet-unreadable when the Sheet is forbidden to this app, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.unauthorized when the Sheet call is unauthenticated even after a refresh, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.quota-exhausted when quota is exhausted (429 on every attempt), and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.quota-exhausted when quota is exhausted (403 rate reason on every attempt), and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.server-error when Google fails on every attempt, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.id-mismatch when the Sheet that answers is not the recorded one, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.response-malformed when a 200 answer is an error page, not a Sheet, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.response-malformed when the header read answers with no ranges, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.spreadsheet-trashed when the Sheet is in the bin, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.tab-missing when the Jobs tab is missing, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.key-column-missing when Companies holds data but no Company column, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.key-column-missing when Jobs holds data but no Dedup Key column, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.key-column-missing when the Jobs tab is empty and has no header at all: the plan cannot write the key header (human-approved), and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.key-column-missing when the Jobs tab has a header without Dedup Key and no rows (human-approved), and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.duplicate-header when Dedup Key is named twice, and leaves the credentials untouched, writes nothing and leaks no secret
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a revoked refresh token tells the operator to run `harvest auth --target sheets`, never a raw HTTP error
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a refused probe reads no cell: the header check is the last thing it does

## acceptance/sheets-api-target/sheets-token-source.test.mjs

- RED MISSING_FUNCTIONALITY (scaffold reached): @real-io @adapter-integration refreshes with the Sheets refresh token and the client file, and answers drive.file
- RED MISSING_FUNCTIONALITY (scaffold reached): refreshes once per process: a second request reuses the access token in memory
- RED MISSING_FUNCTIONALITY (scaffold reached): persists a rotated refresh token into sheets-token.json only, and never an access token to disk
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.scope-mismatch when Google grants more than drive.file, and changes no file
- RED MISSING_FUNCTIONALITY (scaffold reached): @error names sheets.reauth-required, and `harvest auth --target sheets`, when the grant was revoked
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a token endpoint that answers with no access token is sheets.token-endpoint-error
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a Gmail token file sitting in the Sheets slot is refused as sheets.scope-mismatch before any request

## integration/sheets-api-target/sheets-credential-store.test.mjs

- RED MISSING_FUNCTIONALITY (scaffold reached): @real-io @adapter-integration reads the record the import left
- RED MISSING_FUNCTIONALITY (scaffold reached): writes the record with exclusive create, mode 0600, leaving every other file and no temp file behind
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses to overwrite an existing record, whatever it holds, and leaves it byte-identical
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.not-imported when the record is absent, and writes nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.target-record-invalid when the record is not JSON, and writes nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.target-record-invalid when the record is a JSON array, and writes nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.target-record-invalid when the record names no spreadsheet, and writes nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.target-record-invalid when the record names a spreadsheet that is not text, and writes nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.target-record-invalid when the record is of an unknown version, and writes nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.credential-permissions when the record is readable by its group, and writes nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses sheets.credential-permissions when the record sits in a directory open to its group, and writes nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses a record whose shape is wrong before writing, so a bad id is never stored
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a symlink or a directory where the record should be is refused as sheets.credential-invalid, and never followed
- RED MISSING_FUNCTIONALITY (scaffold reached): reads the Sheets token file and the client file through the slot view
- RED MISSING_FUNCTIONALITY (scaffold reached): writes a rotated token atomically at 0600 into the Sheets file only; client and Gmail token stay byte-identical
- RED MISSING_FUNCTIONALITY (scaffold reached): creates the Sheets token file, and the directory at 0700, for a first consent
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses to store the Gmail token in the Sheets slot, or a Sheets token with no refresh token, and writes nothing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error refuses a Gmail token file read as the Sheets slot, and a Sheets token file read as the Gmail slot is not the store business
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error refuses sheets.credential-missing when the Sheets token file is absent, without a credential value in the message
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error refuses sheets.credential-invalid when the Sheets token file is not JSON, without a credential value in the message
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error refuses sheets.credential-permissions when the Sheets token file is readable by everyone, without a credential value in the message
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error refuses sheets.credential-permissions when the Sheets token file sits in a directory open to its group, without a credential value in the message
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a symlink at the Sheets token path is never followed or replaced
- RED MISSING_FUNCTIONALITY (scaffold reached): @error the client file is only ever read: a refused client leaves it byte-identical and mode-unchanged
- RED MISSING_FUNCTIONALITY (scaffold reached): the store change universe: after every write the directory holds only the four named files
