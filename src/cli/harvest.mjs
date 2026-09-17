#!/usr/bin/env node
// Driving adapter (composition root):
//   node src/cli/harvest.mjs --in <dir> --out <file.xlsx>          rebuild from a directory
//   node src/cli/harvest.mjs plan-fetch --source <id> --from <d> --to <d> --batch <n>
//   node src/cli/harvest.mjs ingest --raw <dir> --window <a>..<b> --expect <n> [--complete]
//   node src/cli/harvest.mjs build --out <f> [--merge <f>] [--dry-run] [--report <f>]
//
// Subcommands resolve the cache and the ledger under .cache/ relative to the
// working directory. Wire, then probe, then use: a failed probe refuses to start.

import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { createMessageReader } from '../adapters/json-message-reader.mjs';
import { writeWorkbook } from '../adapters/xlsx-workbook-writer.mjs';
import { harvest } from '../core/harvest.mjs';

import { createLedgerStore } from '../adapters/ledger-store.mjs';
import { createMessageCache } from '../adapters/message-cache.mjs';
import { createRawSpillSource } from '../adapters/raw-spill-source.mjs';
import { createTargetSheet } from '../adapters/xlsx-target-sheet.mjs';
import { slim } from '../core/slim.mjs';
import { nextUncoveredDay, validateInterval } from '../core/coverage.mjs';
import { planMerge, HARVESTER_COLUMNS } from '../core/merge.mjs';

// apply() has no acceptance test pinning it yet — non-dry-run `build` stays a RED scaffold.
export const __SCAFFOLD__ = Object.freeze({ buildApply: true });

const SUBCOMMANDS = ['plan-fetch', 'ingest', 'build'];
const DEFAULT_SOURCE = 'linkedin';
const LEDGER_PATH = '.cache/coverage.json';
const CACHE_ROOT = '.cache/messages';

function parseWindow(raw) {
  const [from, to] = String(raw ?? '').split('..');
  if (!from || !to) {
    throw new Error(`harvest ingest: --window must be formatted <from>..<to>, got ${JSON.stringify(raw ?? null)}`);
  }
  return { from, to };
}

function runIngest(options) {
  const rawDirectory = options.raw;
  if (!rawDirectory) throw new Error('harvest ingest: --raw <dir> is required');
  const window = parseWindow(options.window);
  const expectedCount = Number(options.expect);
  if (!Number.isInteger(expectedCount)) throw new Error('harvest ingest: --expect <n> is required');
  const complete = options.flags.has('complete');

  // Composition root: wire -> probe -> use. A failed probe refuses to start,
  // before any cache write or ledger commit (DR-0003 Rule 3 — fail closed).
  const ledgerStore = createLedgerStore(LEDGER_PATH);
  const messageCache = createMessageCache(CACHE_ROOT);
  const messageReader = createMessageReader(CACHE_ROOT);
  const spillSource = createRawSpillSource(rawDirectory);

  ledgerStore.probe();
  messageCache.probe();
  spillSource.probe(expectedCount);

  const entries = spillSource.list(window);
  const alreadyCached = new Set(messageReader.ids());
  const newEntries = entries.filter((entry) => !alreadyCached.has(entry.id));

  for (const entry of newEntries) {
    const { record, quarantine } = slim(spillSource.read(entry.id));
    if (quarantine) {
      console.error(`harvest ingest: quarantined ${quarantine.id} (${quarantine.reason})`);
      continue;
    }
    messageCache.put(record);
  }

  if (complete) {
    ledgerStore.commit({
      source: DEFAULT_SOURCE,
      from: window.from,
      to: window.to,
      completedAt: new Date().toISOString(),
      messageCount: entries.length,
    });
  }

  const duplicateCount = entries.length - newEntries.length;
  console.log(
    `harvest ingest: cached ${newEntries.length} message(s), skipped ${duplicateCount} duplicate(s)` +
      (complete ? `, coverage committed for ${window.from}..${window.to}` : ''),
  );
}

function runPlanFetch(options) {
  const source = options.source ?? DEFAULT_SOURCE;
  const from = options.from;
  const to = options.to;
  const batch = Number(options.batch);
  if (!from || !to) throw new Error('harvest plan-fetch: --from <d> and --to <d> are required');
  validateInterval({ from, to });

  // Offline: reads the ledger, writes nothing (DR-0002 fetch planning).
  const ledgerStore = createLedgerStore(LEDGER_PATH);
  ledgerStore.probe();

  const coverageForSource = ledgerStore.read().filter((interval) => interval.source === source);
  const nextDay = nextUncoveredDay({ from, to }, coverageForSource);

  if (nextDay === null) {
    console.log(`harvest plan-fetch: ${source} ${from}..${to} is fully covered`);
    return;
  }
  console.log(`harvest plan-fetch: ${nextDay.from}..${nextDay.to} batch=${Number.isInteger(batch) ? batch : 'unspecified'}`);
}

function parseArguments(argv) {
  const options = { flags: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      options.flags.add(token.slice(2));
      continue;
    }
    options[token.slice(2)] = next;
    i += 1;
  }
  return options;
}

function probeInputDirectory(directory) {
  if (!existsSync(directory)) {
    throw new Error(`harvest: --in ${directory} does not exist`);
  }
}

function runRebuild(input, output) {
  // Probe, then use: a failed probe refuses to start (see module header).
  probeInputDirectory(input);
  const messages = createMessageReader(input).readAll();
  if (messages.length === 0) {
    throw new Error(`harvest: --in ${input} holds no message JSON — refusing to write an empty workbook`);
  }

  const model = harvest(messages);
  mkdirSync(dirname(output), { recursive: true });
  writeWorkbook(output, model);

  console.log(
    `harvested ${messages.length} messages -> ${model.jobs.rows.length} jobs, ` +
      `${model.companies.rows.length} companies, ${model.sources.rows.length} saved searches`,
  );
  console.log(`wrote ${output}`);
}

/** DR-0009: `build` derives every row from the whole cache, never a window —
 *  sharing `createMessageReader` + `harvest` with the `--in` rebuild path
 *  (see runRebuild below) is what keeps that invariant from narrowing. An
 *  absent cache reads as no messages, since a preview has nothing to derive
 *  from yet (createMessageReader().readAll() itself throws ENOENT on a
 *  missing root, so the absence is handled here rather than in the reader). */
function deriveHarvestModel() {
  const messages = existsSync(CACHE_ROOT) ? createMessageReader(CACHE_ROOT).readAll() : [];
  return harvest(messages);
}

function emptyTracker(columns) {
  return { tabs: { Jobs: { columns, rows: [] } } };
}

/** Wire -> probe -> use (DR-0005): a failed probe refuses before any read. */
function probeAndReadTarget(targetPath) {
  const targetSheet = createTargetSheet(targetPath);
  targetSheet.probe();
  return targetSheet.read();
}

function summarizePlan(plan) {
  return [
    `harvest build --dry-run: plan for tab "${plan.tab}"`,
    `  columns to append: ${plan.appendColumns.length}` +
      (plan.appendColumns.length ? ` (${plan.appendColumns.join(', ')})` : ''),
    `  rows to update: ${plan.updates.length}`,
    `  rows to append: ${plan.appends.length}`,
    `  cell changes: ${plan.changes.length}`,
  ].join('\n');
}

function runBuildDryRun(options) {
  const model = deriveHarvestModel();
  const sheetState = options.merge ? probeAndReadTarget(options.merge) : emptyTracker(model.jobs.columns);
  const plan = planMerge(sheetState, model);
  console.log(summarizePlan(plan));
}

function runBuild(options) {
  // apply() is not pinned by any acceptance test yet — a non-dry-run build
  // refuses cleanly rather than attempting an unimplemented write.
  if (!options.flags.has('dry-run')) {
    throw new Error('harvest build: writing to the target sheet is not yet implemented — pass --dry-run to preview the plan');
  }
  runBuildDryRun(options);
}

function runSubcommand(name, options) {
  if (name === 'ingest') return runIngest(options);
  if (name === 'plan-fetch') return runPlanFetch(options);
  return runBuild(options);
}

const argv = process.argv.slice(2);

if (SUBCOMMANDS.includes(argv[0])) {
  try {
    runSubcommand(argv[0], parseArguments(argv.slice(1)));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
} else {
  const { in: input, out: output } = parseArguments(argv);
  if (!input || !output) {
    console.error(
      'usage: harvest.mjs --in <dir> --out <file.xlsx>\n' + `       harvest.mjs <${SUBCOMMANDS.join('|')}> [options]`,
    );
    process.exit(2);
  }

  try {
    runRebuild(input, output);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
