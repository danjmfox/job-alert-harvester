#!/usr/bin/env node
// Driving adapter (composition root):
//   node src/cli/harvest.mjs --in <dir> --out <file.xlsx>          rebuild from a directory
//   node src/cli/harvest.mjs plan-fetch --source <id> --from <d> --to <d> --batch <n>
//   node src/cli/harvest.mjs ingest --raw <dir> --window <a>..<b> --expect <n> [--complete]
//   node src/cli/harvest.mjs build --out <f> [--merge <f>] [--dry-run] [--report <f>]
//   node src/cli/harvest.mjs build --target sheets [--dry-run] [--report <f>]
//   node src/cli/harvest.mjs import --from <file.xlsx>
//   node src/cli/harvest.mjs fetch --source <id> --from <d> --to <d>
//   node src/cli/harvest.mjs auth [--target gmail|sheets]
//   node src/cli/harvest.mjs update [--from <d>] [--dry-run]
//
// Subcommands resolve the cache and the ledger under .cache/ relative to the
// working directory. Wire, then probe, then use: a failed probe refuses to start.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { createMessageReader } from '../adapters/json-message-reader.mjs';
import { writeWorkbook } from '../adapters/xlsx-workbook-writer.mjs';
import { harvest } from '../core/harvest.mjs';

import { createLedgerStore } from '../adapters/ledger-store.mjs';
import { createMessageCache } from '../adapters/message-cache.mjs';
import { createRawSpillSource } from '../adapters/raw-spill-source.mjs';
import { createReceiptStore } from '../adapters/receipt-store.mjs';
import { createTargetSheet } from '../adapters/xlsx-target-sheet.mjs';
import { parseCommandLine } from '../core/cli-options.mjs';
import { slim } from '../core/slim.mjs';
import { TUNING_LIMIT, formatTuningView, summariseRoleFamilies } from '../core/role-families.mjs';
import { nextUncoveredDay, validateInterval } from '../core/coverage.mjs';
import { formatSearchYield } from '../core/search-yield.mjs';
import { planMergeAll, HARVESTER_COLUMNS } from '../core/merge.mjs';
import { evaluateFreshness, Freshness } from '../core/receipts.mjs';
import { partitionChanges, formatChange } from '../core/changes.mjs';
import { writeChangeReport } from '../adapters/change-report-writer.mjs';
import { createCredentialStore, createSheetsCredentialStore } from '../adapters/credential-store.mjs';
import { createGmailApiSource } from '../adapters/gmail-api-source.mjs';
import { createGoogleTokenSource } from '../adapters/google-token-source.mjs';
import { createOAuthLoopback } from '../adapters/oauth-loopback.mjs';
import { createSheetProvisioner } from '../adapters/sheet-provisioner.mjs';
import { createSheetsTargetReader, createSheetsTargetWriter } from '../adapters/sheets-target.mjs';
import { clampToSettledDays } from '../core/coverage.mjs';
import { resolveEndpoints } from '../core/endpoints.mjs';
import { GMAIL, SHEETS } from '../core/oauth.mjs';
import { AuthTargetRefusal, BuildRefusal, SheetsRefusal } from '../core/sheets-refusals.mjs';
import { REGISTRY } from '../core/sources/registry.mjs';
import { runAuth } from './auth.mjs';
import { FetchRefusal, runFetchLoop } from './fetch-loop.mjs';
import { createGoogleReadTransport, createGoogleTransport } from './google-transport.mjs';
import { runImport } from './import.mjs';
import { runUpdate, runUpdatePreview } from './update.mjs';

const SUBCOMMANDS = ['plan-fetch', 'ingest', 'build', 'fetch', 'auth', 'import', 'update'];
const AUTH_PROFILES = new Map([
  ['gmail', GMAIL],
  ['sheets', SHEETS],
]);
const SHEETS_TARGET = 'sheets';
const CREDENTIAL_DIRECTORY = ['.config', 'job-alert-harvester'];
const CONSENT_TIMEOUT_MS = 5 * 60 * 1000;
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

const sleep = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
const nowIso = () => new Date().toISOString();
const credentialDirectory = () => join(homedir(), ...CREDENTIAL_DIRECTORY);
const credentialStore = () => createCredentialStore({ directory: credentialDirectory() });
const sheetsCredentialStore = () => createSheetsCredentialStore({ directory: credentialDirectory() });

const refuse = (code, detail) => {
  throw Object.assign(new Error(detail ? `${code}: ${detail}` : code), { code });
};

function resolveSourceDescriptor(sourceId) {
  const descriptor = REGISTRY.find((candidate) => candidate.id === sourceId);
  if (!descriptor) {
    throw Object.assign(new Error(`${FetchRefusal.UNKNOWN_SOURCE}: ${sourceId}`), { code: FetchRefusal.UNKNOWN_SOURCE });
  }
  return descriptor;
}

/**
 * Wire -> probe -> use: runFetchLoop probes every adapter before the first request or write.
 * @returns {Promise<{ windowsCommitted: number }>}
 */
async function runFetch(options) {
  const sourceId = options.source ?? DEFAULT_SOURCE;
  const { from, to } = options;
  if (!from || !to) throw new Error('harvest fetch: --from <d> and --to <d> are required');
  validateInterval({ from, to });
  const descriptor = resolveSourceDescriptor(sourceId);

  const range = clampToSettledDays({ from, to }, nowIso());
  if (range === null) {
    console.log('harvest fetch: nothing settled to fetch');
    return { windowsCommitted: 0 };
  }

  const endpoints = resolveEndpoints(process.env);
  const ledger = createLedgerStore(LEDGER_PATH);
  ledger.probe();
  const covered = ledger.read().filter((interval) => interval.source === sourceId);
  if (nextUncoveredDay(range, covered) === null) {
    console.log(`harvest fetch: ${sourceId} ${range.from}..${range.to} is already covered`);
    return { windowsCommitted: 0 };
  }

  const store = credentialStore();
  const jitter = Math.random;
  const tokenSource = createGoogleTokenSource({ store, fetch, endpoints, nowMs: Date.now, sleep, jitter });
  const source = createGmailApiSource({ store, tokenSource, get: (url, init) => fetch(url, { ...init, method: 'GET' }), endpoints, sender: descriptor.sender, sleep, jitter });

  return runFetchLoop({
    range,
    sourceId,
    source,
    ledger,
    reader: createMessageReader(CACHE_ROOT),
    cache: createMessageCache(CACHE_ROOT),
    slim,
    now: nowIso,
    log: (line) => console.log(line),
  });
}

function authProfileFor(target) {
  if (target === undefined) return GMAIL;
  return AUTH_PROFILES.get(target) ?? refuse(AuthTargetRefusal.UNKNOWN_TARGET, JSON.stringify(target));
}

async function runAuthCommand(options) {
  const profile = authProfileFor(options.target);
  const store = profile === SHEETS ? sheetsCredentialStore().sheetsSlot() : credentialStore();
  const { emailAddress } = await runAuth({
    profile,
    store,
    fetch,
    loopback: createOAuthLoopback({ timeoutMs: CONSENT_TIMEOUT_MS }),
    endpoints: resolveEndpoints(process.env),
    random: (bytes) => new Uint8Array(randomBytes(bytes)),
    sha256: (text) => new Uint8Array(createHash('sha256').update(text).digest()),
    now: nowIso,
    print: (line) => console.log(line),
  });
  console.log(
    profile === SHEETS ? 'harvest auth --target sheets: consent recorded for drive.file' : `harvest auth: consent recorded for ${emailAddress}`,
  );
}

/** One token source per profile, shared by every adapter of that profile. */
function wireSheets(endpoints) {
  const jitter = Math.random;
  const store = sheetsCredentialStore();
  const tokenSource = createGoogleTokenSource({ profile: SHEETS, store: store.sheetsSlot(), fetch, endpoints, nowMs: Date.now, sleep, jitter });
  const transportFor = (namespace) => createGoogleTransport({ tokenSource, fetch, sleep, jitter, namespace });
  const adapterOptions = { store, tokenSource, endpoints, sleep, jitter };
  return {
    store,
    tokenSource,
    provisioner: () => createSheetProvisioner({ transport: transportFor('drive'), endpoints, tokenSource }),
    reader: (spreadsheetId) => createSheetsTargetReader({ ...adapterOptions, spreadsheetId, transport: { read: createGoogleReadTransport({ tokenSource, fetch, sleep, jitter, namespace: 'sheets' }) } }),
    writer: (spreadsheetId) => createSheetsTargetWriter({ ...adapterOptions, spreadsheetId, transport: transportFor('sheets') }),
  };
}

async function runImportCommand(options) {
  if (!options.from) throw new Error('harvest import: --from <file.xlsx> is required');
  const from = resolve(options.from);
  const wiring = wireSheets(resolveEndpoints(process.env));
  await runImport({
    from,
    store: wiring.store,
    workbook: createTargetSheet(from),
    provisioner: wiring.provisioner(),
    sheets: (spreadsheetId) => ({ reader: wiring.reader(spreadsheetId), writer: wiring.writer(spreadsheetId) }),
    print: (line) => console.log(line),
    now: nowIso,
  });
}

function probeInputDirectory(directory) {
  if (!existsSync(directory)) {
    throw new Error(`harvest: --in ${directory} does not exist`);
  }
}

function runRebuild(input, output) {
  // Probe, then use: a failed probe refuses to start (see module header).
  probeInputDirectory(input);
  if (existsSync(output)) {
    refuse(
      BuildRefusal.OUT_EXISTS,
      `--out ${output} already exists; the rebuild form never overwrites. ` +
        `Choose a new --out, or run build --out <f> --merge ${output} to merge into it`,
    );
  }
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

const jobsRowsOf = (plans) =>
  plans.filter((plan) => plan.tab === 'Jobs').flatMap((plan) => [...plan.updates.map((update) => update.cells), ...plan.appends]);

/** Stderr-only Role Family tuning view (DR-0014): never stdout, never the --report file. */
function printTuningView(plans) {
  formatTuningView(summariseRoleFamilies(jobsRowsOf(plans), { limit: TUNING_LIMIT })).forEach((line) => console.error(line));
}

/** Stderr-only per-search yield (DR-0015): never stdout, never the --report file. */
function printSearchYield(model) {
  formatSearchYield(model.searchYield).forEach((line) => console.error(line));
}

/** `--report <file>` detail: every changed cell, correction and bookkeeping
 *  alike -- only the stderr summary above separates the two classes. */
function writeReportIfRequested(options, plans) {
  if (!options.report) return;
  const { corrections, bookkeeping } = partitionChanges(plans);
  writeChangeReport(resolve(options.report), [...corrections, ...bookkeeping].map(formatChange));
}

function reportDryRun(options, plans, model) {
  for (const plan of plans) {
    console.log(summarizePlan(plan));
  }
  summarizeChanges(plans);
  printTuningView(plans);
  printSearchYield(model);
  writeReportIfRequested(options, plans);
}

function runBuildDryRun(options) {
  const { model } = deriveHarvestModel();
  if (options.merge) warnIfStale(resolve(options.merge), createReceiptStore(RECEIPTS_DIR));
  const sheetState = options.merge ? probeAndReadTarget(options.merge) : emptyTracker(model.jobs.columns);
  reportDryRun(options, planMergeAll(sheetState, model), model);
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
  printTuningView(plans);
  printSearchYield(model);
  writeReportIfRequested(options, plans);
}

function runCreateBuild(options, model) {
  if (existsSync(options.out)) {
    refuse(BuildRefusal.OUT_EXISTS, `--out ${options.out} already exists; pass --merge ${options.out} to merge into it`);
  }
  const targetSheet = createTargetSheet(options.out);
  targetSheet.probe(); // wire -> probe -> use: the directory must be writable before create() runs
  const receipt = targetSheet.create(model);
  console.log(summarizeCreate(model, receipt));
}

function refuseEmptyCache(messageCount) {
  if (messageCount === 0) {
    throw new Error('harvest build: the cache is empty — refusing to write an empty tracker');
  }
}

const withImportGuidance = (error) =>
  error?.code === SheetsRefusal.NOT_IMPORTED ? Object.assign(new Error(`${error.code}: run harvest import --from <tracker.xlsx>`), { code: error.code }) : error;

/** Wire -> probe -> use: --dry-run is handed the reader alone, so it holds no write capability. */
async function runSheetsBuild(options) {
  if (options.out !== undefined || options.merge !== undefined) refuse(BuildRefusal.TARGET_CONFLICT, '--out and --merge name an offline workbook; --target sheets writes the recorded Sheet');
  const wiring = wireSheets(resolveEndpoints(process.env));
  const dryRun = options.flags.has('dry-run');
  const { model, messageCount } = deriveHarvestModel();
  if (!dryRun) refuseEmptyCache(messageCount);

  const target = dryRun ? wiring.reader() : wiring.writer();
  await target.probe().catch((error) => {
    throw withImportGuidance(error);
  });
  const plans = planMergeAll(await target.read(), model);
  if (dryRun) {
    reportDryRun(options, plans, model);
    return;
  }
  console.log(summarizeApply(plans, await target.apply(plans)));
  summarizeChanges(plans);
  printTuningView(plans);
  printSearchYield(model);
  writeReportIfRequested(options, plans);
}

async function runBuild(options) {
  const target = options.target;
  if (target === SHEETS_TARGET) return runSheetsBuild(options);
  if (target !== undefined) refuse(BuildRefusal.UNKNOWN_TARGET, JSON.stringify(target));

  if (options.flags.has('dry-run')) {
    runBuildDryRun(options);
    return;
  }

  const { model, messageCount } = deriveHarvestModel();
  refuseEmptyCache(messageCount);

  if (options.merge) {
    runMergeBuild(options, model);
    return;
  }
  runCreateBuild(options, model);
}

function runUpdateCommand(options) {
  const shared = {
    options,
    source: DEFAULT_SOURCE,
    now: nowIso,
    readLedger: () => {
      const ledger = createLedgerStore(LEDGER_PATH);
      ledger.probe();
      return ledger.read();
    },
    buildStage: runSheetsBuild,
    print: (line) => console.log(line),
  };
  if (options.flags.has('dry-run')) return runUpdatePreview(shared);
  return runUpdate({
    ...shared,
    fetchStage: ({ source, from, to }) => runFetch({ source, from, to }),
  });
}

function runSubcommand(name, options) {
  if (name === 'update') return runUpdateCommand(options);
  if (name === 'fetch') return runFetch(options);
  if (name === 'auth') return runAuthCommand(options);
  if (name === 'import') return runImportCommand(options);
  if (name === 'ingest') return runIngest(options);
  if (name === 'plan-fetch') return runPlanFetch(options);
  return runBuild(options);
}

/** A named refusal prints as `code: detail`; an error that already leads with its code is left as is. */
const refusalLine = (error) =>
  typeof error.code === 'string' && !error.message.startsWith(error.code) ? `${error.code}: ${error.message}` : error.message;

const argv = process.argv.slice(2);

if (SUBCOMMANDS.includes(argv[0])) {
  try {
    await runSubcommand(argv[0], parseCommandLine(argv[0], argv.slice(1)));
  } catch (error) {
    console.error(refusalLine(error));
    process.exit(1);
  }
} else {
  try {
    const { in: input, out: output } = parseCommandLine('rebuild', argv);
    if (!input || !output) {
      console.error(
        'usage: harvest.mjs --in <dir> --out <file.xlsx>\n' + `       harvest.mjs <${SUBCOMMANDS.join('|')}> [options]`,
      );
      process.exit(2);
    }
    runRebuild(input, output);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
