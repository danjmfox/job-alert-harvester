# ATDD Infrastructure Policy

Per `nw-distill` § Project Infrastructure Policy. One file per project. Apply-if-exists;
write-if-absent; rewrite with `--policy=fresh`. Git history is the audit trail.

Bootstrapped during job-alert-harvester DISTILL (2026-09-08). Ports below are the ones
in scope for this feature; the table grows by accretion as later features add ports.

## Driving

| Port | Mechanism | Note |
|---|---|---|
| CLI (`src/cli/harvest.mjs`) | subprocess via `node:child_process` `spawnSync`, cwd set to an isolated `mkdtemp` workspace | `runHarvest()` in `tests/acceptance/job-alert-harvester/support/domain-types.mjs` |
| CLI `fetch` and `auth` subcommands | asynchronous subprocess (`spawn`) from an isolated workspace with `HOME` set to a temp directory; the Gmail and token endpoints answered by the loopback fake below | `runHarvestAsync()` in `tests/acceptance/gmail-api-source/support/gmail-domain-types.mjs`; `spawnSync` would block the fake's event loop (gmail-api-source) |
| CLI `import`, `auth --target sheets` and `build --target sheets` | asynchronous subprocess (`spawn`) from an isolated workspace with `HOME` set to a temp directory; the Sheets API, Drive API and token endpoint answered by the loopback Sheets fake below | `runHarvestAsync()`; `tests/acceptance/sheets-api-target/sheets-cli.test.mjs`; one `@walking_skeleton` (`build --target sheets`) |
| Harvest skill (`.claude/skills/harvest/SKILL.md`) | contract pinned by `harvest-skill.test.mjs` | built; drives the Gmail connector and hands paths to the CLI (DR-0003) |

## Driven internal (real)

| Port | Mechanism | Note |
|---|---|---|
| `CoverageLedger` (`ledger-store.mjs`) | real filesystem, JSON file under an isolated `mkdtemp` workspace | direct adapter-factory calls in `probe-contracts.test.mjs`; end-to-end via CLI in `ingest-fail-closed.test.mjs` |
| `MessageCacheReader`/`MessageCacheWriter` (`message-cache.mjs`, `json-message-reader.mjs`) | real filesystem, month-sharded directory under an isolated workspace | same record shape as committed fixtures (DR-0002) |
| `MessageSource` — interim (`raw-spill-source.mjs`) | real filesystem glob over a spill directory | agent-mediated; named successor `gmail-api-source` is deferred (DR-0003) |
| `TargetSheet` — interim (`xlsx-target-sheet.mjs`) | real `xlsx` (SheetJS) read/write against a real file, `write-temp-fsync-rename` | direct adapter-factory calls in `probe-contracts.test.mjs`; successor `sheets-api-target` is the row below (DR-0005, DR-0012) |
| Credential files (`credential-store.mjs`) | real filesystem under a temp `HOME`, modes set explicitly, never by umask | `~/.config/job-alert-harvester/{client,token}.json`; `tests/integration/gmail-api-source/credential-store.test.mjs` |
| Sheets target record and Sheets token file (`credential-store.mjs`, extended) | real filesystem under a temp `HOME`, modes set explicitly; the record is written by exclusive create | `~/.config/job-alert-harvester/{sheets-token,sheets-target}.json`; `tests/integration/sheets-api-target/sheets-credential-store.test.mjs` |
| OAuth loopback listener (`oauth-loopback.mjs`) | real socket bound to `127.0.0.1`, random port | `tests/integration/gmail-api-source/oauth-loopback.test.mjs` |

## Driven external / non-deterministic (fake)

| Port | Fake | Note |
|---|---|---|
| Gmail REST API v1 (`gmail-api-source.mjs`) | `createGmailFake()` in `tests/acceptance/gmail-api-source/support/gmail-fake.mjs`, at the HTTP boundary: injected `fetch` for adapter suites, the same handler behind a loopback-only `node:http` server for the one CLI seam | payloads built around real captured alert bodies (DR-0007); models absent `messages` on an empty day, a lying `resultSizeEstimate`, 429 with `Retry-After`, 403 rate versus authorisation reasons |
| Google OAuth token endpoint (`google-token-source.mjs`) | the same `createGmailFake()` | models `invalid_grant`, a rotated refresh token, a response with no refresh token, a wider or narrower scope; the override is `HARVEST_API_BASE_URL`, loopback hosts only |
| Consent browser (`auth`) | `aFakeBrowser()` (in-process) and `consentRedirect()` (subprocess) | answers approve, deny, wrong state, no code, timeout |
| Google Sheets API v4 and Drive API v3 (`sheets-target.mjs`, `sheet-provisioner.mjs`) | `createSheetsFake()` in `tests/acceptance/sheets-api-target/support/sheets-fake.mjs`, at the HTTP boundary: injected `fetch` for adapter suites, the same handler behind a loopback-only binary-safe `node:http` server for the CLI seam | models values, tabs, headers, row-key metadata that follows sorts and inserts, all-or-nothing `batchUpdate`, Drive create with conversion, `files.delete`, 429 and 5xx with `Retry-After`, 403 rate versus authorisation reasons, a request log; every behaviour standing for an unverified Google behaviour is in the fidelity ledger at the top of the file and in `feature-delta.md`; fixtures are composed from memory until captured from a scratch Sheet (DR-0007) |
| Google OAuth token endpoint, Sheets grant | the same fake (built on `createGmailFake()`) | grants `drive.file`; models a wider grant, a missing refresh token, `invalid_grant`, a rotated refresh token |
