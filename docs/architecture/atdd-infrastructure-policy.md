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
| Harvest skill (`.claude/skills/harvest/SKILL.md`) | contract pinned by `harvest-skill.test.mjs` | built; drives the Gmail connector and hands paths to the CLI (DR-0003) |

## Driven internal (real)

| Port | Mechanism | Note |
|---|---|---|
| `CoverageLedger` (`ledger-store.mjs`) | real filesystem, JSON file under an isolated `mkdtemp` workspace | direct adapter-factory calls in `probe-contracts.test.mjs`; end-to-end via CLI in `ingest-fail-closed.test.mjs` |
| `MessageCacheReader`/`MessageCacheWriter` (`message-cache.mjs`, `json-message-reader.mjs`) | real filesystem, month-sharded directory under an isolated workspace | same record shape as committed fixtures (DR-0002) |
| `MessageSource` — interim (`raw-spill-source.mjs`) | real filesystem glob over a spill directory | agent-mediated; named successor `gmail-api-source` is deferred (DR-0003) |
| `TargetSheet` — interim (`xlsx-target-sheet.mjs`) | real `xlsx` (SheetJS) read/write against a real file, `write-temp-fsync-rename` | direct adapter-factory calls in `probe-contracts.test.mjs`; named successor `sheets-api-target` is deferred (DR-0005) |
| Credential files (`credential-store.mjs`) | real filesystem under a temp `HOME`, modes set explicitly, never by umask | `~/.config/job-alert-harvester/{client,token}.json`; `tests/integration/gmail-api-source/credential-store.test.mjs` |
| OAuth loopback listener (`oauth-loopback.mjs`) | real socket bound to `127.0.0.1`, random port | `tests/integration/gmail-api-source/oauth-loopback.test.mjs` |

## Driven external / non-deterministic (fake)

| Port | Fake | Note |
|---|---|---|
| Gmail REST API v1 (`gmail-api-source.mjs`) | `createGmailFake()` in `tests/acceptance/gmail-api-source/support/gmail-fake.mjs`, at the HTTP boundary: injected `fetch` for adapter suites, the same handler behind a loopback-only `node:http` server for the one CLI seam | payloads built around real captured alert bodies (DR-0007); models absent `messages` on an empty day, a lying `resultSizeEstimate`, 429 with `Retry-After`, 403 rate versus authorisation reasons |
| Google OAuth token endpoint (`google-token-source.mjs`) | the same `createGmailFake()` | models `invalid_grant`, a rotated refresh token, a response with no refresh token, a wider or narrower scope; the override is `HARVEST_API_BASE_URL`, loopback hosts only |
| Consent browser (`auth`) | `aFakeBrowser()` (in-process) and `consentRedirect()` (subprocess) | answers approve, deny, wrong state, no code, timeout |
| Sheets API adapter | — | deferred (OQ-5, Sheets adapter out of scope); no fake yet |
