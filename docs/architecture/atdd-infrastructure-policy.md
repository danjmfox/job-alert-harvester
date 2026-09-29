# ATDD Infrastructure Policy

Per `nw-distill` § Project Infrastructure Policy. One file per project. Apply-if-exists;
write-if-absent; rewrite with `--policy=fresh`. Git history is the audit trail.

Bootstrapped during job-alert-harvester DISTILL (2026-09-08). Ports below are the ones
in scope for this feature; the table grows by accretion as later features add ports.

## Driving

| Port | Mechanism | Note |
|---|---|---|
| CLI (`src/cli/harvest.mjs`) | subprocess via `node:child_process` `spawnSync`, cwd set to an isolated `mkdtemp` workspace | `runHarvest()` in `tests/acceptance/job-alert-harvester/support/domain-types.mjs` |
| Harvest skill (`.claude/skills/harvest/SKILL.md`) | contract pinned by `harvest-skill.test.mjs` | built; drives the Gmail connector and hands paths to the CLI (DR-0003) |

## Driven internal (real)

| Port | Mechanism | Note |
|---|---|---|
| `CoverageLedger` (`ledger-store.mjs`) | real filesystem, JSON file under an isolated `mkdtemp` workspace | direct adapter-factory calls in `probe-contracts.test.mjs`; end-to-end via CLI in `ingest-fail-closed.test.mjs` |
| `MessageCacheReader`/`MessageCacheWriter` (`message-cache.mjs`, `json-message-reader.mjs`) | real filesystem, month-sharded directory under an isolated workspace | same record shape as committed fixtures (DR-0002) |
| `MessageSource` — interim (`raw-spill-source.mjs`) | real filesystem glob over a spill directory | agent-mediated; named successor `gmail-api-source` is deferred (DR-0003) |
| `TargetSheet` — interim (`xlsx-target-sheet.mjs`) | real `xlsx` (SheetJS) read/write against a real file, `write-temp-fsync-rename` | direct adapter-factory calls in `probe-contracts.test.mjs`; named successor `sheets-api-target` is deferred (DR-0005) |

## Driven external / non-deterministic (fake)

| Port | Fake | Note |
|---|---|---|
| (none in this feature) | — | Gmail/Sheets API adapters are deferred; the interim adapters above are file-real, not externally-networked, so no fake is needed yet |
