#!/usr/bin/env node
// Driving adapter (composition root):
//   node src/cli/harvest.mjs --in <dir> --out <file.xlsx>          rebuild from a directory
//   node src/cli/harvest.mjs plan-fetch --source <id> --from <d> --to <d> --batch <n>
//   node src/cli/harvest.mjs ingest --raw <dir> --window <a>..<b> --expect <n> [--complete]
//   node src/cli/harvest.mjs build --out <f> [--merge <f>] [--dry-run] [--report <f>]
//
// Subcommands resolve the cache and the ledger under .cache/ relative to the
// working directory. Wire, then probe, then use: a failed probe refuses to start.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';

import { createMessageReader } from '../adapters/json-message-reader.mjs';
import { writeWorkbook } from '../adapters/xlsx-workbook-writer.mjs';
import { harvest } from '../core/harvest.mjs';

import { createLedgerStore } from '../adapters/ledger-store.mjs';
import { createMessageCache } from '../adapters/message-cache.mjs';
import { createRawSpillSource } from '../adapters/raw-spill-source.mjs';
import { createReceiptStore } from '../adapters/receipt-store.mjs';
import { createTargetSheet } from '../adapters/xlsx-target-sheet.mjs';
import { slim } from '../core/slim.mjs';
import { nextUncoveredDay, validateInterval } from '../core/coverage.mjs';
import { planMergeAll, HARVESTER_COLUMNS } from '../core/merge.mjs';
import { evaluateFreshness, Freshness } from '../core/receipts.mjs';
import { partitionChanges, formatChange } from '../core/changes.mjs';
import { writeChangeReport } from '../adapters/change-report-writer.mjs';

const SUBCOMMANDS = ['plan-fetch', 'ingest', 'build'];
const DEFAULT_SOURCE = 'linkedin';
const LEDGER_PATH = '.cache/coverage.json';
const CACHE_ROOT = '.cache/messages';
const RECEIPTS_DIR = '.cache/receipts';

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
 *  missing root, so the absence is handled here rather than in the reader).
 *  Exposes messageCount alongside the model so callers can refuse an empty
 *  cache without reading it twice. */
function deriveHarvestModel() {
  const messages = existsSync(CACHE_ROOT) ? createMessageReader(CACHE_ROOT).readAll() : [];
  return { model: harvest(messages), messageCount: messages.length };
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

const sha256OfFile = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** DR-0005: the digest is of the target's bytes as they are now, before this
 *  run writes anything -- taken ahead of probeAndReadTarget/apply either way.
 *  Warns on stderr and proceeds regardless -- never a refusal, per DR-0005
 *  ("converts an invisible loss into a visible warning. It does not prevent
 *  the loss."). */
function warnIfStale(targetPath, receiptStore) {
  const currentDigest = sha256OfFile(targetPath);
  const freshness = evaluateFreshness(targetPath, currentDigest, receiptStore.list());
  if (freshness === Freshness.STALE) {
    console.error(
      `harvest build: ${targetPath} still matches what we last wrote -- this looks like a stale download, ` +
        'so edits made in the sheet since may be lost',
    );
  }
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

/** Stderr summary distinguishing derived corrections from sighting
 *  bookkeeping (DR-0004 rule 4) -- a run with no corrections says so plainly
 *  rather than printing an empty section. */
function summarizeChanges(plans) {
  const { corrections, bookkeeping } = partitionChanges(plans);
  if (corrections.length === 0) {
    console.error(
      'harvest build: no derived corrections' +
        (bookkeeping.length ? ` (${bookkeeping.length} sighting bookkeeping change(s))` : ''),
    );
    return;
  }
  console.error(
    [
      `harvest build: ${corrections.length} derived correction(s):`,
      ...corrections.map((change) => `  ${formatChange(change)}`),
      bookkeeping.length ? `  (${bookkeeping.length} sighting bookkeeping change(s) not shown)` : null,
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

/** `--report <file>` detail: every changed cell, correction and bookkeeping
 *  alike -- only the stderr summary above separates the two classes. */
function writeReportIfRequested(options, plans) {
  if (!options.report) return;
  const { corrections, bookkeeping } = partitionChanges(plans);
  writeChangeReport(resolve(options.report), [...corrections, ...bookkeeping].map(formatChange));
}

function runBuildDryRun(options) {
  const { model } = deriveHarvestModel();
  if (options.merge) warnIfStale(resolve(options.merge), createReceiptStore(RECEIPTS_DIR));
  const sheetState = options.merge ? probeAndReadTarget(options.merge) : emptyTracker(model.jobs.columns);
  const plans = planMergeAll(sheetState, model);
  for (const plan of plans) {
    console.log(summarizePlan(plan));
  }
  summarizeChanges(plans);
  writeReportIfRequested(options, plans);
}

function summarizeApply(plans, receipt) {
  return [
    'harvest build: merged',
    ...plans.map((plan) =>
      [
        `  ${plan.tab}: rows updated: ${plan.updates.length}`,
        `rows appended: ${plan.appends.length}`,
        `columns appended: ${plan.appendColumns.length}`,
        `cell changes: ${plan.changes.length}`,
      ].join(', '),
    ),
    `  cells written: ${receipt.cellsWritten}`,
  ].join('\n');
}

function summarizeCreate(model, receipt) {
  return [
    'harvest build: created a new workbook',
    `  rows appended: ${model.jobs.rows.length}`,
    `  cells written: ${receipt.cellsWritten}`,
  ].join('\n');
}

/** apply reads and preserves its own target -- merging into a different
 *  --out would silently drop the tracker's contents, so --merge must name
 *  the same path as --out (DR-0005). */
function runMergeBuild(options, model) {
  if (resolve(options.merge) !== resolve(options.out)) {
    throw new Error('harvest build: --merge and --out must name the same file — apply only reads and preserves its own target');
  }
  const targetPath = resolve(options.merge);
  const receiptStore = createReceiptStore(RECEIPTS_DIR);
  warnIfStale(targetPath, receiptStore);

  const sheetState = probeAndReadTarget(options.merge);
  const plans = planMergeAll(sheetState, model);
  const receipt = createTargetSheet(options.out).apply(plans);
  // Append only after apply() has returned -- the atomic target write is
  // already complete by then, so a receipt-write failure can never leave the
  // tracker half-written.
  receiptStore.append({
    targetPath,
    inputDigest: receipt.inputDigest,
    outputDigest: receipt.outputDigest,
    appliedAt: receipt.appliedAt,
  });
  console.log(summarizeApply(plans, receipt));
  summarizeChanges(plans);
  writeReportIfRequested(options, plans);
}

function runCreateBuild(options, model) {
  if (existsSync(options.out)) {
    throw new Error(`harvest build: --out ${options.out} already exists — pass --merge ${options.out} to merge into it`);
  }
  const targetSheet = createTargetSheet(options.out);
  targetSheet.probe(); // wire -> probe -> use: the directory must be writable before create() runs
  const receipt = targetSheet.create(model);
  console.log(summarizeCreate(model, receipt));
}

function runBuild(options) {
  if (options.flags.has('dry-run')) {
    runBuildDryRun(options);
    return;
  }

  const { model, messageCount } = deriveHarvestModel();
  if (messageCount === 0) {
    throw new Error('harvest build: the cache is empty — refusing to write an empty tracker');
  }

  if (options.merge) {
    runMergeBuild(options, model);
    return;
  }
  runCreateBuild(options, model);
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
