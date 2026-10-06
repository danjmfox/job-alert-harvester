// Domain vocabulary for the update-subcommand acceptance tests (nWave Mandate-12).
//
// Production owns the domain nouns: the refusal codes come from src/. This module adds the operator's week (a cache, a
// ledger, a mailbox and a Sheet, all synthetic), the one origin that serves Gmail and Sheets, the command as an operator
// runs it (a spawned subprocess through the production composition root, the clock stopped by a `node --import`
// preload, an empty-HOME-style credential home with fake credentials), the observers of what the run left behind, and
// the wording the scenarios pin. Nothing here decides anything a production module decides.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createGmailFake, json } from '../../gmail-api-source/support/gmail-fake.mjs';
import { createGoogleFront, withLoopbackFake } from '../../sheets-api-target/support/google-front.mjs';
import { aGmailResource } from '../../gmail-api-source/support/gmail-domain-types.mjs';
import { anInterval, cachedMessageIds, committedCoverage } from '../../job-alert-harvester/support/domain-types.mjs';
import {
  KEY_COLUMN,
  aSheetsCredentialHome,
  cacheAlert,
  environment,
  fileDigests,
  keysOf,
  runHarvestAsync,
  writeJson,
} from '../../sheets-api-target/support/sheets-domain-types.mjs';
import { aSheetHoldingTheCache, anAlert, anEmptySheet, dedupKeyOf, messagesOf, theAdverts } from '../../search-yield-summary/support/search-yield-domain-types.mjs';
import { Role, Search } from '../../search-yield-summary/support/yield-vocabulary.mjs';
import { isoDay, secondsAtStartOf } from './update-oracle.mjs';

export { UpdateRefusal, Next } from '../../../../src/core/update-plan.mjs';
export { CliRefusal } from '../../../../src/core/cli-options.mjs';
export { FetchRefusal } from '../../../../src/cli/fetch-loop.mjs';
export { RetryRefusal } from '../../../../src/core/retry-policy.mjs';
export { CredentialRefusal, TokenRefusal } from '../../../../src/core/oauth.mjs';
export { SheetsRefusal } from '../../../../src/core/sheets-refusals.mjs';
export { Role, Search, anAlert, theAdverts, dedupKeyOf };
export { aScratchWorkspace, useWorkspaceCleanup } from '../../search-yield-summary/support/search-yield-domain-types.mjs';
export { YIELD_HEADING_PREFIX } from '../../search-yield-summary/support/search-yield-domain-types.mjs';
export { fileDigests, runHarvestAsync, writeJson };

// ---------------------------------------------------------------- the clock

/** The instant every scenario's subprocess believes it is: 07:30 UTC on 10 September 2026. */
export const NOW = '2026-09-10T07:30:00.000Z';
export const TODAY = '2026-09-10';
/** The last UTC day that has fully ended at NOW: the newest day a fetch can cover. */
export const YESTERDAY = '2026-09-09';
const FIXED_CLOCK = pathToFileURL(new URL('../../search-yield-summary/support/fixed-clock.mjs', import.meta.url).pathname).href;

// ---------------------------------------------------------------- the wording the scenarios pin (DISTILL PINNED DECISIONS)

/** DR-0016 decision 3, verbatim. */
export const NOTHING_NEW_LINE = 'harvest update: nothing new from Gmail';
/** The closing line of a run whose two stages both succeeded; `days` is the number of settled days the fetch covered. */
export const summaryLineFor = (days) => `harvest update: complete, fetched ${days} day(s), built the Sheet`;
export const SUMMARY_LINE = /^harvest update: complete, fetched (\d+) day\(s\), built the Sheet$/;
/** What a preview says: the range a real run would fetch (clamped to settled days) and how many of its days the ledger does not cover. */
export const dryRunLineFor = (from, to, uncovered) => `harvest update --dry-run: would fetch ${from}..${to}, ${uncovered} uncovered day(s)`;
export const DRY_RUN_LINE = /^harvest update --dry-run: would fetch (\S+)\.\.(\S+), (\d+) uncovered day\(s\)$/;
/** The fetch stage's own progress line for one day (existing behaviour). */
export const FETCHED_DAY_LINE = (day) => new RegExp(`^harvest fetch: ${day}\\.\\.${day} — (\\d+) message\\(s\\)$`);
export const BUILD_MERGED_LINE = 'harvest build: merged';
export const BUILD_DRY_RUN_HEADING = /^harvest build --dry-run: plan for tab /;
export const STAGE_FAILED_PREFIX = 'update.stage-failed:';
export const KEEPS_THE_FETCH = 'the fetch is kept';
export const RUN_AGAIN = 'run update again';

export const linesOf = (text) => text.split('\n').filter((line) => line !== '');
export const lastLineOf = (text) => linesOf(text).at(-1) ?? '';
export const indexOfLineMatching = (text, pattern) => linesOf(text).findIndex((line) => (typeof pattern === 'string' ? line === pattern : pattern.test(line)));
export const includesLine = (text, pattern) => indexOfLineMatching(text, pattern) >= 0;
export const stageFailedLinesIn = (stderr) => linesOf(stderr).filter((line) => line.startsWith(STAGE_FAILED_PREFIX));

// ---------------------------------------------------------------- alerts and the week

/** One alert: the saved search that sent it, the day, and its adverts numbered from `first`. */
export const anAlertOn = (day, { search = Search.BROAD, first, titles = [Role.COACH] }) => anAlert({ search, on: day, adverts: theAdverts(titles, first) });
export const advertKeysOf = (alerts) => alerts.flatMap((alert) => alert.adverts.map((advert) => dedupKeyOf(advert.id)));

const LEDGER = '.cache/coverage.json';
const LOCK = '.cache/update.lock';
export const ledgerPathOf = (week) => join(week.workspace, LEDGER);
export const lockPathOf = (week) => join(week.workspace, LOCK);
export const cacheRootOf = (week) => join(week.workspace, '.cache/messages');
const inside = (day, { from, to }) => day >= from && day <= to;

/**
 * An operator's cache, ledger, mailbox and Sheet.
 * @param {object} options
 * @param {object[]} [options.cached] alerts already in the cache (their days are normally covered)
 * @param {object[]} [options.waiting] alerts sitting in the mailbox, not yet fetched
 * @param {{ from: string, to: string, source?: string }[] | null} [options.covered] the ledger's intervals; null leaves no ledger file at all
 * @param {'holds-the-cache' | 'headers-only'} [options.sheet] what the Sheet holds before the run
 * @param {object} [options.home] the credential home the run starts with (a complete one by default)
 */
export function anOperatorsWeek({ workspace, cached = [], waiting = [], covered = null, sheet = 'holds-the-cache', home = aSheetsCredentialHome() }) {
  const messages = messagesOf([...cached, ...waiting]);
  messages.slice(0, cached.length).forEach((record) => cacheAlert(workspace, record));
  const mailbox = messages.slice(cached.length);
  if (covered !== null) {
    writeJson(
      join(workspace, LEDGER),
      covered.map((interval) => anInterval({ ...interval, messageCount: cached.filter((alert) => inside(alert.on, interval)).length })),
    );
  }
  const gmail = createGmailFake({ messages: mailbox.map((record) => aGmailResource({ record })) });
  const sheets = sheet === 'holds-the-cache' ? aSheetHoldingTheCache(workspace) : anEmptySheet();
  return {
    workspace,
    home,
    gmail,
    sheets,
    front: createGoogleFront({ gmail, sheets }),
    cachedIds: messages.slice(0, cached.length).map((record) => record.id),
    waitingIds: mailbox.map((record) => record.id),
    waitingAdvertKeys: advertKeysOf(waiting),
    cachedAdvertKeys: advertKeysOf(cached),
  };
}

/** Two days already in the cache and covered through the 8th; yesterday's alert (the 9th) is waiting in the mailbox; the Sheet holds the cache. */
export const USUAL_CACHED = Object.freeze([
  anAlertOn('2026-09-07', { search: Search.BROAD, first: 1, titles: [Role.COACH] }),
  anAlertOn('2026-09-08', { search: Search.REGIONAL, first: 2, titles: [Role.SCRUM] }),
]);
export const USUAL_WAITING = Object.freeze([anAlertOn(YESTERDAY, { search: Search.BROAD, first: 3, titles: [Role.COACH, Role.ANALYST] })]);
/** A mailbox needs some alert from the sender or the fetch's probe refuses (`gmail.sender-matches-nothing`); this one is older than any covered day, so no run fetches it. */
export const AN_OLD_ALERT_IN_THE_MAILBOX = Object.freeze(anAlertOn('2026-09-01', { search: Search.BROAD, first: 9, titles: [Role.OWNER] }));
export const theUsualWeek = (workspace, overrides = {}) =>
  anOperatorsWeek({ workspace, cached: [...USUAL_CACHED], waiting: [...USUAL_WAITING], covered: [{ from: '2026-09-07', to: '2026-09-08' }], ...overrides });

// ---------------------------------------------------------------- running

const clockEnvironment = (clock) => ({ FIXED_CLOCK_ISO: clock, NODE_OPTIONS: `--import=${FIXED_CLOCK}` });

/** Runs `harvest <command> <args>` in the week's workspace against the one origin serving both fakes, with the clock stopped at `clock`. */
export const operatorRuns = (week, command, args = [], { clock = NOW } = {}) =>
  withLoopbackFake(week.front, (baseUrl) =>
    runHarvestAsync([command, ...args], { cwd: week.workspace, env: { ...environment(week.home, baseUrl), ...clockEnvironment(clock) }, timeoutMs: 90_000 }),
  );

/** `harvest update [args]` as an operator (or the scheduler) runs it. */
export const operatorRunsUpdate = (week, ...args) => operatorRuns(week, 'update', args);

// ---------------------------------------------------------------- faults

/** The mailbox answers `list` with a refusal only while `failing.on` is true, for a window starting on or after `fromDay`. */
export function gmailListingFailsFrom(week, fromDay, respond) {
  const failing = { on: true };
  week.gmail.override('list', respond, { when: (request) => failing.on && Number(request.query.q?.match(/after:(\d+)/)?.[1] ?? 0) >= secondsAtStartOf(fromDay) });
  return failing;
}

/** The Sheet refuses the data batch only while `failing.on` is true. */
export function sheetRejectsTheDataBatch(week, respond) {
  const failing = { on: true };
  week.sheets.override('batch-update', respond, { when: () => failing.on });
  return failing;
}

export const emptyListing = () => json(200, { resultSizeEstimate: 0 });

// ---------------------------------------------------------------- the lock

const pidIsAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};
export { pidIsAlive };

/** A process id that belonged to a process that has exited. */
export function aDeadPid() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { pid } = spawnSync(process.execPath, ['-e', '']);
    if (pid && !pidIsAlive(pid)) return pid;
  }
  throw new Error('no dead process id found');
}

/** Leaves `.cache/update.lock` as a running `update` would: the holder's pid, as decimal digits. */
export function aLockHeldBy(week, pid) {
  mkdirSync(join(week.workspace, '.cache'), { recursive: true });
  writeFileSync(lockPathOf(week), String(pid), 'utf8');
}
export const theLockHolder = (week) => (existsSync(lockPathOf(week)) ? readFileSync(lockPathOf(week), 'utf8') : null);

// ---------------------------------------------------------------- observing

/** Port-exposed observables of the week after a run: the cache, the ledger, the Sheet, and how many requests each service saw. */
export function observeWeek(week) {
  return {
    'cache.messageIds': cachedMessageIds(cacheRootOf(week)),
    'ledger.coverage': committedCoverage(ledgerPathOf(week)).map(({ source, from, to }) => ({ source, from, to })),
    'sheet.jobKeys': keysOf(week.sheets.snapshot(), 'Jobs', KEY_COLUMN),
    'sheet.writeRequests': week.sheets.writeRequests().length,
    'gmail.requestCount': week.gmail.requests.length,
    'sheets.requestCount': week.sheets.requests.length,
  };
}
export const WEEK_UNIVERSE = Object.freeze(['cache.messageIds', 'ledger.coverage', 'sheet.jobKeys', 'sheet.writeRequests', 'gmail.requestCount', 'sheets.requestCount']);
/** The same plus every file under `.cache/` (cache, ledger, lock, anything else) as digests: for runs that must change nothing at all. */
export const observeWeekFiles = (week) => ({ ...observeWeek(week), 'workspace.files': fileDigests(join(week.workspace, '.cache')) });
export const WEEK_FILES_UNIVERSE = Object.freeze([...WEEK_UNIVERSE, 'workspace.files']);

/** The UTC days Gmail was asked to list, in the order asked (read from each query's `after:` bound; the probe's undated listing is not a day). */
export const daysGmailWasAskedFor = (week) =>
  week.gmail
    .requestsTo('list')
    .filter((request) => /after:\d+/.test(request.query.q ?? ''))
    .map((request) => Number(request.query.q.match(/after:(\d+)/)[1]))
    .map((seconds) => isoDay(seconds / 86_400));

/** The coverage the ledger holds for linkedin, as `from..to` strings. */
export const coveredDays = (week) => committedCoverage(ledgerPathOf(week)).filter((interval) => interval.source === 'linkedin').map(({ from, to }) => `${from}..${to}`);
