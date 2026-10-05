// @contract-shape:bounded-change
// DR-0016 version 1.1.0: the four rulings the human made on cases DESIGN left open. An override rescues an empty ledger;
// a preview ignores the run lock; an unreadable ledger or `.cache/` is a stage failure through `update.stage-failed` (exit 1,
// last on stderr, the stage named, the inner code carried), as is an error that carries no code; a build that fails after a
// fetch that fetched nothing still says nothing new first (the line stays before the build). Subprocess layer: each case is a named example
// (Mandate 11); the Gmail and Sheets fakes script the faults. Pinned stage words: a ledger read at planning time is the
// `fetch` stage's (the ledger is the fetch's coverage record); the lock's own stage word is not pinned, only that one is named.
import { describe, expect } from 'vitest';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertStateDelta, unchanged } from '../../common/state-delta.mjs';
import { json } from '../gmail-api-source/support/gmail-fake.mjs';
import { scenario } from './support/red-gate.mjs';
import {
  BUILD_MERGED_LINE,
  DRY_RUN_LINE,
  NOTHING_NEW_LINE,
  STAGE_FAILED_PREFIX,
  SUMMARY_LINE,
  SheetsRefusal,
  UpdateRefusal,
  WEEK_FILES_UNIVERSE,
  YESTERDAY,
  anAlertOn,
  anOperatorsWeek,
  aLockHeldBy,
  aScratchWorkspace,
  coveredDays,
  daysGmailWasAskedFor,
  dryRunLineFor,
  fileDigests,
  includesLine,
  lastLineOf,
  ledgerPathOf,
  linesOf,
  observeWeek,
  observeWeekFiles,
  operatorRunsUpdate,
  sheetRejectsTheDataBatch,
  stageFailedLinesIn,
  summaryLineFor,
  theLockHolder,
  theUsualWeek,
  useWorkspaceCleanup,
} from './support/update-domain-types.mjs';

useWorkspaceCleanup();

const SLOW = 30_000;
const FIRST_DAY = '2026-09-07';
const grew = (what) => ({ description: what, holds: (before, after) => after > before });
const allUnchanged = (names) => Object.fromEntries(names.map((name) => [name, unchanged()]));
const cacheDirectoryOf = (week) => join(week.workspace, '.cache');

/** The operator has never fetched: alerts wait in the mailbox for the 8th and yesterday, and the cache holds nothing. */
const aWeekWithNoFetchedDays = (covered) =>
  anOperatorsWeek({
    workspace: aScratchWorkspace(),
    waiting: [anAlertOn('2026-09-08', { first: 1 }), anAlertOn(YESTERDAY, { first: 2 })],
    covered,
    sheet: 'headers-only',
  });

/** What a failed plan or lock leaves to observe: the files under `.cache/`, whether the ledger path is still what it was, and the calls each service heard. */
const observeWhatAFailureMustNotChange = (week) => ({
  'workspace.files': fileDigests(cacheDirectoryOf(week)),
  'ledger.isDirectory': (() => {
    try {
      return statSync(ledgerPathOf(week)).isDirectory();
    } catch {
      return null;
    }
  })(),
  'gmail.requestCount': week.gmail.requests.length,
  'sheets.requestCount': week.sheets.requests.length,
});
const FAILURE_UNIVERSE = Object.freeze(['workspace.files', 'ledger.isDirectory', 'gmail.requestCount', 'sheets.requestCount']);

describe('@driving_adapter harvest update --from rescues an operator who has fetched nothing yet', () => {
  for (const [label, covered] of [
    ['an empty ledger', []],
    ['no ledger at all', null],
  ]) {
    scenario(`@error update --from ${FIRST_DAY} on ${label} is not refused: it fetches from that day, builds and closes with three days`, async () => {
      // Given alerts wait for the 8th and yesterday, and the coverage ledger is ${label}
      const week = aWeekWithNoFetchedDays(covered);
      const before = observeWeek(week);
      // When the operator runs update --from 7 September
      const result = await operatorRunsUpdate(week, '--from', FIRST_DAY);
      // Then it is not refused for want of a baseline, and closes with the summary for the three days fetched
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).not.toContain(UpdateRefusal.NO_BASELINE);
      expect(includesLine(result.stdout, BUILD_MERGED_LINE)).toBe(true);
      expect(lastLineOf(result.stdout)).toBe(summaryLineFor(3));
      // And Gmail was asked for the 7th, 8th and 9th in order, and they are now cached and covered, with the adverts in the Sheet
      expect(daysGmailWasAskedFor(week)).toEqual([FIRST_DAY, '2026-09-08', YESTERDAY]);
      expect(coveredDays(week)).toEqual([`${FIRST_DAY}..${YESTERDAY}`]);
      assertStateDelta(before, observeWeek(week), {
        universe: ['cache.messageIds', 'ledger.coverage', 'sheet.jobKeys'],
        expected: {
          'cache.messageIds': { description: 'the two waiting alerts cached', holds: (b, a) => a.length === b.length + 2 && week.waitingIds.every((id) => a.includes(id)) },
          'ledger.coverage': { description: 'covered 7th to yesterday', holds: (_b, a) => JSON.stringify(a.map(({ from, to }) => `${from}..${to}`)) === JSON.stringify([`${FIRST_DAY}..${YESTERDAY}`]) },
          'sheet.jobKeys': { description: 'the waiting adverts appended', holds: (b, a) => a.length === b.length + week.waitingAdvertKeys.length && week.waitingAdvertKeys.every((key) => a.includes(key)) },
        },
      });
    }, SLOW);
  }
});

describe('@driving_adapter harvest update --dry-run ignores the run lock', () => {
  scenario('@error a preview while another update runs is not refused: it prints the range, makes no Gmail request and no write, and leaves the lock and cache as it found them', async () => {
    // Given another update is running: the lock names a live process
    const week = theUsualWeek(aScratchWorkspace());
    aLockHeldBy(week, process.pid);
    const before = observeWeekFiles(week);
    // When the operator runs update --dry-run
    const result = await operatorRunsUpdate(week, '--dry-run');
    // Then it prints what a run would fetch instead of refusing as already running
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toContain(UpdateRefusal.ALREADY_RUNNING);
    expect(includesLine(result.stdout, dryRunLineFor(FIRST_DAY, YESTERDAY, 1))).toBe(true);
    expect(linesOf(result.stdout).some((line) => DRY_RUN_LINE.test(line))).toBe(true);
    // And Gmail was never contacted, nothing was written, the lock still names the first update, and every file under .cache is as it was
    expect(week.gmail.requests).toHaveLength(0);
    expect(week.sheets.writeRequests()).toHaveLength(0);
    expect(theLockHolder(week)).toBe(String(process.pid));
    assertStateDelta(before, observeWeekFiles(week), {
      universe: WEEK_FILES_UNIVERSE,
      expected: { ...allUnchanged(WEEK_FILES_UNIVERSE), 'sheets.requestCount': grew('the Sheet was read for the preview') },
    });
  }, SLOW);
});

describe('@driving_adapter harvest update treats what it cannot read as a stage failure', () => {
  const expectTheFetchStoppedAtTheLedger = async (week) => {
    const before = observeWhatAFailureMustNotChange(week);
    const result = await operatorRunsUpdate(week);
    expect(result.status).toBe(1);
    expect(stageFailedLinesIn(result.stderr)).toHaveLength(1);
    expect(lastLineOf(result.stderr).startsWith(`${STAGE_FAILED_PREFIX} fetch stopped at ledger.unreadable`)).toBe(true);
    expect(result.stdout).toBe('');
    assertStateDelta(before, observeWhatAFailureMustNotChange(week), { universe: FAILURE_UNIVERSE, expected: allUnchanged(FAILURE_UNIVERSE) });
    expect(week.gmail.requests).toHaveLength(0);
    expect(week.sheets.requests).toHaveLength(0);
  };

  scenario('@error a ledger that cannot be read as a file stops update at the fetch with ledger.unreadable, reaches no service and changes nothing', async () => {
    // Given the coverage ledger's place holds a directory, so it cannot be read
    const week = theUsualWeek(aScratchWorkspace());
    rmSync(ledgerPathOf(week));
    mkdirSync(ledgerPathOf(week));
    // When the operator runs update, then the fetch is named with the ledger's own code, last on stderr, and nothing was reached or changed
    await expectTheFetchStoppedAtTheLedger(week);
  }, SLOW);

  scenario('@error a ledger whose contents cannot be understood stops update the same way: the fetch named with ledger.unreadable', async () => {
    // Given the coverage ledger holds text that is not a ledger
    const week = theUsualWeek(aScratchWorkspace());
    writeFileSync(ledgerPathOf(week), 'this is not a ledger', 'utf8');
    // When the operator runs update, then the fetch is named with the ledger's own code and nothing was reached or changed
    await expectTheFetchStoppedAtTheLedger(week);
  }, SLOW);

  scenario('@error a cache folder that cannot take the run lock stops update through update.stage-failed, and the run does not go ahead without it', async () => {
    // Given the place of the cache folder holds a plain file, so no lock can be taken there
    const week = theUsualWeek(aScratchWorkspace());
    rmSync(cacheDirectoryOf(week), { recursive: true });
    writeFileSync(cacheDirectoryOf(week), 'not a folder', 'utf8');
    // When the operator runs update --from 7 September, so that planning does not need the ledger
    const result = await operatorRunsUpdate(week, '--from', FIRST_DAY);
    // Then it fails as a stage failure that names a stage, not as an already-running refusal
    expect(result.status).toBe(1);
    expect(stageFailedLinesIn(result.stderr)).toHaveLength(1);
    expect(lastLineOf(result.stderr)).toMatch(/^update\.stage-failed: \w+ stopped/);
    expect(result.stderr).not.toContain(UpdateRefusal.ALREADY_RUNNING);
    expect(result.stdout).toBe('');
    // And it did not run unlocked: Gmail and Sheets heard nothing, and the cache folder's place still holds the plain file
    expect(week.gmail.requests).toHaveLength(0);
    expect(week.sheets.requests).toHaveLength(0);
    expect(readFileSync(cacheDirectoryOf(week), 'utf8')).toBe('not a folder');
    expect(theLockHolder(week)).toBeNull();
  }, SLOW);
});

describe('@driving_adapter harvest update names the stage even when the error carries no code', () => {
  scenario('@error a build that fails with an error that has no code stops update at the build with no inner code: an empty cache is refused after a fetch that found nothing', async () => {
    // Given the ledger already covers the 7th to yesterday and the cache holds nothing
    const week = anOperatorsWeek({
      workspace: aScratchWorkspace(),
      waiting: [anAlertOn('2026-09-01', { first: 9 })],
      covered: [{ from: FIRST_DAY, to: YESTERDAY }],
      sheet: 'headers-only',
    });
    // When the operator runs update
    const result = await operatorRunsUpdate(week);
    // Then the build is named without an inner code, with the cache-is-empty message as detail, and the fetch is said to be kept
    expect(result.status).toBe(1);
    const line = lastLineOf(result.stderr);
    expect(line).toMatch(/^update\.stage-failed: build stopped: .*cache is empty/);
    expect(line).not.toContain(' stopped at ');
    expect(line).toContain('the fetch is kept');
    expect(week.sheets.writeRequests()).toHaveLength(0);
  }, SLOW);
});

describe('@driving_adapter harvest update keeps the nothing-new line when the build then fails', () => {
  scenario('@error a build that fails after a fetch that found nothing new still says nothing new once, then stderr ends with the build named and no summary is printed', async () => {
    // Given the ledger covers the 7th to yesterday, the cache holds those days, the Sheet holds none of their adverts, and the Sheet refuses the data batch
    const week = anOperatorsWeek({
      workspace: aScratchWorkspace(),
      cached: [anAlertOn(FIRST_DAY, { first: 1 }), anAlertOn(YESTERDAY, { first: 2 })],
      covered: [{ from: FIRST_DAY, to: YESTERDAY }],
      sheet: 'headers-only',
    });
    sheetRejectsTheDataBatch(week, () => json(400, { error: { code: 400, message: 'The request was refused', status: 'INVALID_ARGUMENT' } }));
    const before = observeWeek(week);
    // When the operator runs update
    const result = await operatorRunsUpdate(week);
    // Then the build is named with the Sheet's own code, last on stderr
    expect(result.status).toBe(1);
    expect(lastLineOf(result.stderr).startsWith(`${STAGE_FAILED_PREFIX} build`)).toBe(true);
    expect(lastLineOf(result.stderr)).toContain(SheetsRefusal.REQUEST_REJECTED);
    // And stdout says nothing new exactly once, and does not claim the run completed
    expect(linesOf(result.stdout).filter((line) => line === NOTHING_NEW_LINE)).toHaveLength(1);
    expect(linesOf(result.stdout).some((line) => SUMMARY_LINE.test(line))).toBe(false);
    expect(week.gmail.requests).toHaveLength(0);
    expect(observeWeek(week)['sheet.jobKeys']).toEqual(before['sheet.jobKeys']);
  }, SLOW);
});
