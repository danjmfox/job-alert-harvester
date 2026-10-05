// @contract-shape:bounded-change
// DR-0016 decisions 2, 4 and 5: update fails closed. A fetch that stops means no build and not one request to Sheets; a
// build that fails after a good fetch says the fetch is kept; a partial fetch keeps its days and the next run resumes; a
// build that failed on one run is healed by the next, even though that run fetches nothing. Every failure exits 1 with one
// `update.stage-failed` line, last on stderr, naming the stage and carrying the inner code. Subprocess layer: each sad
// path is a named example (Mandate 11); the Gmail and Sheets fakes script the failures.
import { describe, expect } from 'vitest';
import { assertStateDelta, unchanged } from '../../common/state-delta.mjs';
import { forbiddenFor, json, rateLimited } from '../gmail-api-source/support/gmail-fake.mjs';
import { aSheetsCredentialHome } from '../sheets-api-target/support/sheets-domain-types.mjs';
import { scenario } from './support/red-gate.mjs';
import {
  BUILD_MERGED_LINE,
  KEEPS_THE_FETCH,
  NOTHING_NEW_LINE,
  CredentialRefusal,
  Role,
  RUN_AGAIN,
  STAGE_FAILED_PREFIX,
  SUMMARY_LINE,
  SheetsRefusal,
  RetryRefusal,
  TokenRefusal,
  Search,
  WEEK_UNIVERSE,
  YESTERDAY,
  aScratchWorkspace,
  anAlertOn,
  anOperatorsWeek,
  coveredDays,
  daysGmailWasAskedFor,
  gmailListingFailsFrom,
  includesLine,
  indexOfLineMatching,
  lastLineOf,
  observeWeek,
  operatorRunsUpdate,
  sheetRejectsTheDataBatch,
  stageFailedLinesIn,
  summaryLineFor,
  theUsualWeek,
  useWorkspaceCleanup,
} from './support/update-domain-types.mjs';

useWorkspaceCleanup();

const SLOW = 30_000;
const SHEETS_REAUTH_COMMAND = 'harvest auth --target sheets';
const GMAIL_REAUTH_COMMAND = 'harvest auth';
const grew = (what) => ({ description: what, holds: (before, after) => after > before });
const allUnchanged = (names) => Object.fromEntries(names.map((name) => [name, unchanged()]));
const refusalBody = () => json(400, { error: { code: 400, message: 'The request was refused', status: 'INVALID_ARGUMENT' } });

/** What every stopped fetch shares: exit 1, one stage-failed line, last on stderr, naming the fetch and the inner code, and nothing reaching the Sheet or stdout's success lines. */
function expectTheFetchStoppedAt(result, innerCode) {
  expect(result.status).toBe(1);
  expect(stageFailedLinesIn(result.stderr)).toHaveLength(1);
  const line = lastLineOf(result.stderr);
  expect(line.startsWith(`${STAGE_FAILED_PREFIX} fetch`)).toBe(true);
  expect(line).toContain(innerCode);
  expect(result.stdout).not.toContain(STAGE_FAILED_PREFIX);
  expect(includesLine(result.stdout, BUILD_MERGED_LINE)).toBe(false);
  expect(result.stdout.split('\n').some((line) => SUMMARY_LINE.test(line))).toBe(false);
}

describe('@driving_adapter harvest update stops at the stage that failed and says which', () => {
  scenario('@error a fetch that hits Gmail\'s quota stops the update: no build, not one request to Sheets, exit 1, the fetch named with gmail.quota-exhausted', async () => {
    // Given yesterday's alert is waiting but Gmail answers every listing with a quota refusal
    const week = theUsualWeek(aScratchWorkspace());
    week.gmail.override('list', () => rateLimited());
    const before = observeWeek(week);
    // When the operator runs update
    const result = await operatorRunsUpdate(week);
    // Then the fetch is named as the stage that stopped, with Gmail's own refusal code
    expectTheFetchStoppedAt(result, RetryRefusal.QUOTA_EXHAUSTED);
    // And Sheets was never reached, and the cache, the ledger and the Sheet are exactly as they were
    expect(week.sheets.requests).toHaveLength(0);
    assertStateDelta(before, observeWeek(week), {
      universe: WEEK_UNIVERSE,
      expected: { ...allUnchanged(WEEK_UNIVERSE), 'gmail.requestCount': grew('Gmail was asked, and refused') },
    });
  }, SLOW);

  scenario('@error a Gmail credential that needs authorising again stops the update with gmail.reauth-required and the command to run, as the last stderr line', async () => {
    // Given Gmail no longer honours the operator's refresh token
    const week = theUsualWeek(aScratchWorkspace());
    week.gmail.revokeRefreshToken();
    // When the operator runs update
    const result = await operatorRunsUpdate(week);
    // Then the last stderr line is the stage-failed line, naming the fetch, the inner code and the command that fixes it
    expectTheFetchStoppedAt(result, TokenRefusal.REAUTH_REQUIRED);
    expect(lastLineOf(result.stderr)).toContain(GMAIL_REAUTH_COMMAND);
    expect(week.sheets.requests).toHaveLength(0);
    expect(coveredDays(week)).toEqual(['2026-09-07..2026-09-08']);
  }, SLOW);

  scenario('@error a Gmail refusal that is not a rate limit stops the update the same way: gmail.unauthorized, no build', async () => {
    // Given Gmail refuses the listing as forbidden
    const week = theUsualWeek(aScratchWorkspace());
    week.gmail.override('list', () => forbiddenFor('forbidden'));
    // When the operator runs update
    const result = await operatorRunsUpdate(week);
    // Then the fetch is named with its code and Sheets is never reached
    expectTheFetchStoppedAt(result, RetryRefusal.UNAUTHORIZED);
    expect(week.sheets.requests).toHaveLength(0);
  }, SLOW);

  scenario('@error a Gmail credential that is missing stops the update at the fetch before any request is made', async () => {
    // Given the operator's home holds no Gmail token
    const week = theUsualWeek(aScratchWorkspace(), { home: aSheetsCredentialHome({ gmailToken: null }) });
    // When the operator runs update
    const result = await operatorRunsUpdate(week);
    // Then the fetch is named with the credential refusal, and neither Gmail nor Sheets heard anything
    expectTheFetchStoppedAt(result, CredentialRefusal.MISSING);
    expect(week.gmail.requests).toHaveLength(0);
    expect(week.sheets.requests).toHaveLength(0);
  }, SLOW);

  scenario('@error a fetch that stops partway keeps the days it covered and builds nothing; the next update resumes from the first uncovered day and builds', async () => {
    // Given the ledger runs to the 6th, three alerts are waiting for the 7th, 8th and 9th, and Gmail refuses any listing from the 8th
    const week = anOperatorsWeek({
      workspace: aScratchWorkspace(),
      cached: [anAlertOn('2026-09-05', { first: 1 }), anAlertOn('2026-09-06', { search: Search.REGIONAL, first: 2, titles: [Role.SCRUM] })],
      waiting: [anAlertOn('2026-09-07', { first: 3 }), anAlertOn('2026-09-08', { first: 4, titles: [Role.OWNER] }), anAlertOn(YESTERDAY, { first: 5, titles: [Role.COACH] })],
      covered: [{ from: '2026-09-05', to: '2026-09-06' }],
    });
    const failing = gmailListingFailsFrom(week, '2026-09-08', () => forbiddenFor('forbidden'));
    const [seventh, eighth, ninth] = week.waitingIds;
    const before = observeWeek(week);
    // When the operator runs update
    const stopped = await operatorRunsUpdate(week);
    // Then the 7th is cached and covered, the 8th and 9th are not, nothing was built, and the failure names the fetch
    expectTheFetchStoppedAt(stopped, RetryRefusal.UNAUTHORIZED);
    expect(week.sheets.requests).toHaveLength(0);
    assertStateDelta(before, observeWeek(week), {
      universe: WEEK_UNIVERSE,
      expected: {
        ...allUnchanged(WEEK_UNIVERSE),
        'cache.messageIds': { description: 'only the 7th was added', holds: (b, a) => a.length === b.length + 1 && a.includes(seventh) && !a.includes(eighth) && !a.includes(ninth) },
        'ledger.coverage': { description: 'covered through the 7th', holds: (_b, a) => JSON.stringify(a.map(({ from, to }) => `${from}..${to}`)) === JSON.stringify(['2026-09-05..2026-09-07']) },
        'gmail.requestCount': grew('Gmail was asked'),
      },
    });
    // And once Gmail answers again, the next update asks only for the 8th and the 9th, and builds
    failing.on = false;
    const askedBefore = daysGmailWasAskedFor(week).length;
    const resumed = await operatorRunsUpdate(week);
    expect(resumed.status, resumed.stderr).toBe(0);
    expect(daysGmailWasAskedFor(week).slice(askedBefore)).toEqual(['2026-09-08', YESTERDAY]);
    expect(coveredDays(week)).toEqual([`2026-09-05..${YESTERDAY}`]);
    expect(lastLineOf(resumed.stdout)).toBe(summaryLineFor(2));
    expect(observeWeek(week)['sheet.jobKeys']).toEqual(expect.arrayContaining(week.waitingAdvertKeys));
  }, SLOW);

  scenario('@error a build that fails after a good fetch says the fetch is kept: the new days stay cached and covered, the Sheet is untouched, exit 1', async () => {
    // Given yesterday's alert is waiting and the Sheet refuses the data batch
    const week = theUsualWeek(aScratchWorkspace());
    sheetRejectsTheDataBatch(week, refusalBody);
    const before = observeWeek(week);
    // When the operator runs update
    const result = await operatorRunsUpdate(week);
    // Then the build is named with the Sheet's own code, and the line says the fetch is kept and to run update again
    expect(result.status).toBe(1);
    expect(stageFailedLinesIn(result.stderr)).toHaveLength(1);
    const line = lastLineOf(result.stderr);
    expect(line.startsWith(`${STAGE_FAILED_PREFIX} build`)).toBe(true);
    expect(line).toContain(SheetsRefusal.REQUEST_REJECTED);
    expect(line).toContain(KEEPS_THE_FETCH);
    expect(line).toContain(RUN_AGAIN);
    expect(result.stdout).not.toContain(STAGE_FAILED_PREFIX);
    expect(result.stdout.split('\n').some((stdoutLine) => SUMMARY_LINE.test(stdoutLine))).toBe(false);
    // And the fetch really is kept: yesterday's alert is cached and covered, and the Sheet holds exactly what it did
    assertStateDelta(before, observeWeek(week), {
      universe: ['cache.messageIds', 'ledger.coverage', 'sheet.jobKeys'],
      expected: {
        'cache.messageIds': { description: 'yesterday\'s alert cached', holds: (b, a) => a.length === b.length + 1 && week.waitingIds.every((id) => a.includes(id)) },
        'ledger.coverage': { description: 'covered through yesterday', holds: (_b, a) => JSON.stringify(a.map(({ from, to }) => `${from}..${to}`)) === JSON.stringify([`2026-09-07..${YESTERDAY}`]) },
        'sheet.jobKeys': unchanged(),
      },
    });
  }, SLOW);

  scenario('@error the same failure heals on the next run: update fetches nothing, says so, builds, and the Sheet catches up', async () => {
    // Given an update whose build failed after a good fetch
    const week = theUsualWeek(aScratchWorkspace());
    const failing = sheetRejectsTheDataBatch(week, refusalBody);
    const failed = await operatorRunsUpdate(week);
    expect(failed.status).toBe(1);
    const gmailRequestsAfterTheFailure = week.gmail.requests.length;
    const before = observeWeek(week);
    failing.on = false;
    // When the Sheet accepts writes again and the operator runs update
    const healed = await operatorRunsUpdate(week);
    // Then update has nothing new from Gmail, asks it nothing, builds, and closes with zero days
    expect(healed.status, healed.stderr).toBe(0);
    expect(indexOfLineMatching(healed.stdout, NOTHING_NEW_LINE)).toBeGreaterThanOrEqual(0);
    expect(indexOfLineMatching(healed.stdout, NOTHING_NEW_LINE)).toBeLessThan(indexOfLineMatching(healed.stdout, BUILD_MERGED_LINE));
    expect(lastLineOf(healed.stdout)).toBe(summaryLineFor(0));
    expect(week.gmail.requests).toHaveLength(gmailRequestsAfterTheFailure);
    // And the Sheet now holds yesterday's adverts, which no new mail was needed to deliver
    assertStateDelta(before, observeWeek(week), {
      universe: WEEK_UNIVERSE,
      expected: {
        ...allUnchanged(WEEK_UNIVERSE),
        'sheet.jobKeys': { description: 'yesterday\'s adverts appended', holds: (b, a) => a.length === b.length + week.waitingAdvertKeys.length && week.waitingAdvertKeys.every((key) => a.includes(key)) },
        'sheet.writeRequests': grew('the data batch was written'),
        'sheets.requestCount': grew('the Sheet was read and written'),
      },
    });
  }, SLOW);

  scenario('@error a Sheet that needs authorising again stops the build, keeps the fetch, and names the command to run', async () => {
    // Given Google no longer honours the Sheets refresh token
    const week = theUsualWeek(aScratchWorkspace());
    week.sheets.revokeRefreshToken();
    // When the operator runs update
    const result = await operatorRunsUpdate(week);
    // Then the build is named with sheets.reauth-required and the command that fixes it, and the fetch is kept
    expect(result.status).toBe(1);
    const line = lastLineOf(result.stderr);
    expect(line.startsWith(`${STAGE_FAILED_PREFIX} build`)).toBe(true);
    expect(line).toContain(SheetsRefusal.REAUTH_REQUIRED);
    expect(line).toContain(SHEETS_REAUTH_COMMAND);
    expect(line).toContain(KEEPS_THE_FETCH);
    expect(coveredDays(week)).toEqual([`2026-09-07..${YESTERDAY}`]);
  }, SLOW);

  scenario('@error an operator who has not imported a tracker yet gets the build\'s refusal after a good fetch, with the fetch kept', async () => {
    // Given the home holds credentials but no record of a tracker Sheet
    const week = theUsualWeek(aScratchWorkspace(), { home: aSheetsCredentialHome({ target: null }) });
    // When the operator runs update
    const result = await operatorRunsUpdate(week);
    // Then the build is named with sheets.not-imported, says the fetch is kept, and yesterday is covered
    expect(result.status).toBe(1);
    const line = lastLineOf(result.stderr);
    expect(line.startsWith(`${STAGE_FAILED_PREFIX} build`)).toBe(true);
    expect(line).toContain(SheetsRefusal.NOT_IMPORTED);
    expect(line).toContain(KEEPS_THE_FETCH);
    expect(coveredDays(week)).toEqual([`2026-09-07..${YESTERDAY}`]);
  }, SLOW);

  scenario('@error a failure never reaches stdout: stdout holds the progress made, stderr holds the one refusal line', async () => {
    // Given a build that fails after a good fetch
    const week = theUsualWeek(aScratchWorkspace());
    sheetRejectsTheDataBatch(week, refusalBody);
    // When the operator runs update
    const result = await operatorRunsUpdate(week);
    // Then stdout shows the fetch that was done and nothing of the refusal, and stderr's last line is the refusal
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/harvest fetch: /);
    expect(result.stdout).not.toMatch(/update\.[a-z-]+/);
    expect(lastLineOf(result.stderr).startsWith(STAGE_FAILED_PREFIX)).toBe(true);
  }, SLOW);
});
