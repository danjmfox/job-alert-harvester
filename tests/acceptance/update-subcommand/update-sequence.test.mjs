// @contract-shape:bounded-change
// `harvest update` as an operator (or the scheduler) runs it: a spawned subprocess through the production composition root,
// a synthetic cache, ledger and mailbox, fake credentials under a temp HOME, and one loopback origin serving the existing
// Gmail and Sheets fakes (the Driven external ports). The clock is stopped at 07:30 UTC on 10 September 2026 by a
// `node --import` preload, so "yesterday" is the 9th. Subprocess layer: example-only (Mandate 11).
// Covers DESIGN slices 1 and 3 and the stream conventions: the walking skeleton, nothing new, a quiet day, a second run,
// never fetching today, several days, and what goes to stdout versus stderr.
import { describe, expect, it } from 'vitest';
import { assertStateDelta, appendedWith, setTo, unchanged } from '../../common/state-delta.mjs';
import { scenario } from './support/red-gate.mjs';
import {
  AN_OLD_ALERT_IN_THE_MAILBOX,
  BUILD_MERGED_LINE,
  FETCHED_DAY_LINE,
  NOTHING_NEW_LINE,
  NOW,
  Role,
  Search,
  STAGE_FAILED_PREFIX,
  SUMMARY_LINE,
  TODAY,
  WEEK_FILES_UNIVERSE,
  WEEK_UNIVERSE,
  YESTERDAY,
  YIELD_HEADING_PREFIX,
  anAlertOn,
  anOperatorsWeek,
  aScratchWorkspace,
  coveredDays,
  daysGmailWasAskedFor,
  includesLine,
  indexOfLineMatching,
  lastLineOf,
  linesOf,
  observeWeek,
  observeWeekFiles,
  operatorRuns,
  operatorRunsUpdate,
  summaryLineFor,
  theUsualWeek,
  useWorkspaceCleanup,
} from './support/update-domain-types.mjs';

useWorkspaceCleanup();

const SLOW = 30_000;
const holdsThat = (description, test) => ({ description, holds: (before, after) => test(before, after) });
const grew = (what) => holdsThat(what, (before, after) => after > before);
const allUnchanged = (names) => Object.fromEntries(names.map((name) => [name, unchanged()]));
const newOnesAppended = (keys) => holdsThat(`the adverts ${keys.join(', ')} appended after those already there`, (before, after) => after.length === before.length + keys.length && before.every((key) => after.includes(key)) && keys.every((key) => after.includes(key)));

describe('@driving_adapter harvest update brings the cache and the Google Sheet up to date in one command', () => {
  it('@walking_skeleton @driving_adapter @real-io Operator runs update and finds yesterday\'s alerts fetched and their Google Sheet brought up to date, both stages named on stdout', async () => {
    // Given the cache and ledger run to the 8th, the Sheet holds them, and yesterday's alert is waiting in the mailbox
    const week = theUsualWeek(aScratchWorkspace());
    const before = observeWeek(week);
    // When the operator runs update
    const result = await operatorRunsUpdate(week);
    // Then it succeeds, names the fetch and then the build, and closes with one summary line
    expect(result.status, result.stderr).toBe(0);
    expect(indexOfLineMatching(result.stdout, FETCHED_DAY_LINE(YESTERDAY))).toBeGreaterThanOrEqual(0);
    expect(indexOfLineMatching(result.stdout, FETCHED_DAY_LINE(YESTERDAY))).toBeLessThan(indexOfLineMatching(result.stdout, BUILD_MERGED_LINE));
    expect(lastLineOf(result.stdout)).toBe(summaryLineFor(1));
    // And the alert is cached, yesterday is covered, and the Sheet holds yesterday's adverts beside the ones it had
    assertStateDelta(before, observeWeek(week), {
      universe: WEEK_UNIVERSE,
      expected: {
        'cache.messageIds': setTo([...week.cachedIds, ...week.waitingIds].sort()),
        'ledger.coverage': setTo([{ source: 'linkedin', from: '2026-09-07', to: YESTERDAY }]),
        'sheet.jobKeys': newOnesAppended(week.waitingAdvertKeys),
        'sheet.writeRequests': grew('the data was written'),
        'gmail.requestCount': grew('Gmail was read'),
        'sheets.requestCount': grew('the Sheet was read and written'),
      },
    });
    // And Gmail was finished with before the Sheet was first touched, and was only ever read
    const trace = week.front.trace;
    expect(trace.findLastIndex((entry) => entry.service === 'gmail')).toBeLessThan(trace.findIndex((entry) => entry.service === 'sheets'));
    expect(week.gmail.requests.every((request) => request.method === 'GET' || request.route === 'token')).toBe(true);
  }, SLOW);

  it('@error nothing new: every day is already covered, so update says so in one line, asks Gmail nothing and still builds', async () => {
    // Given the cache and ledger already run to yesterday and the Sheet holds the cache
    const week = anOperatorsWeek({
      workspace: aScratchWorkspace(),
      cached: [anAlertOn('2026-09-07', { first: 1 }), anAlertOn('2026-09-08', { search: Search.REGIONAL, first: 2, titles: [Role.SCRUM] }), anAlertOn(YESTERDAY, { first: 3, titles: [Role.OWNER] })],
      covered: [{ from: '2026-09-07', to: YESTERDAY }],
    });
    const before = observeWeekFiles(week);
    // When the operator runs update
    const result = await operatorRunsUpdate(week);
    // Then it says nothing new from Gmail once, before the build, and closes with a summary of zero days
    expect(result.status, result.stderr).toBe(0);
    expect(linesOf(result.stdout).filter((line) => line === NOTHING_NEW_LINE)).toHaveLength(1);
    expect(indexOfLineMatching(result.stdout, NOTHING_NEW_LINE)).toBeLessThan(indexOfLineMatching(result.stdout, BUILD_MERGED_LINE));
    expect(lastLineOf(result.stdout)).toBe(summaryLineFor(0));
    // And Gmail never heard from it, the build read the Sheet and found nothing to send, and nothing on disk or in the Sheet moved
    expect(week.gmail.requests).toHaveLength(0);
    expect(week.sheets.requestsTo('batch-update')).toHaveLength(0);
    assertStateDelta(before, observeWeekFiles(week), {
      universe: WEEK_FILES_UNIVERSE,
      expected: { ...allUnchanged(WEEK_FILES_UNIVERSE), 'sheets.requestCount': grew('the Sheet was read') },
    });
  }, SLOW);

  it('@error a quiet day is progress, not nothing new: the day with no mail is fetched and covered, and the build still runs', async () => {
    // Given the ledger runs to the 8th, the Sheet holds the cache, and the mailbox holds no alert for yesterday, only an older one
    const week = theUsualWeek(aScratchWorkspace(), { waiting: [AN_OLD_ALERT_IN_THE_MAILBOX] });
    // When the operator runs update
    const result = await operatorRunsUpdate(week);
    // Then yesterday is reported with no messages, the run is not called quiet, and it covers one day
    expect(result.status, result.stderr).toBe(0);
    expect(includesLine(result.stdout, FETCHED_DAY_LINE(YESTERDAY))).toBe(true);
    expect(result.stdout).toContain('0 message(s)');
    expect(includesLine(result.stdout, NOTHING_NEW_LINE)).toBe(false);
    expect(lastLineOf(result.stdout)).toBe(summaryLineFor(1));
    expect(coveredDays(week)).toEqual([`2026-09-07..${YESTERDAY}`]);
  }, SLOW);

  it('@error a second update straight after a good one is quiet: nothing new, no Gmail request, no further data batch, nothing changed', async () => {
    // Given the operator has already run update once today
    const week = theUsualWeek(aScratchWorkspace());
    const first = await operatorRunsUpdate(week);
    expect(first.status, first.stderr).toBe(0);
    const gmailRequestsAfterFirst = week.gmail.requests.length;
    const batchesAfterFirst = week.sheets.requestsTo('batch-update').length;
    const before = observeWeekFiles(week);
    // When the operator runs it again
    const second = await operatorRunsUpdate(week);
    // Then it says nothing new, closes with zero days, and asks Gmail nothing
    expect(second.status, second.stderr).toBe(0);
    expect(includesLine(second.stdout, NOTHING_NEW_LINE)).toBe(true);
    expect(lastLineOf(second.stdout)).toBe(summaryLineFor(0));
    expect(week.gmail.requests).toHaveLength(gmailRequestsAfterFirst);
    expect(week.sheets.requestsTo('batch-update')).toHaveLength(batchesAfterFirst);
    assertStateDelta(before, observeWeekFiles(week), {
      universe: WEEK_FILES_UNIVERSE,
      expected: { ...allUnchanged(WEEK_FILES_UNIVERSE), 'sheets.requestCount': grew('the Sheet was read again') },
    });
  }, SLOW);

  it('@error update fetches every uncovered day up to yesterday in order, and the summary counts them', async () => {
    // Given the ledger runs to the 7th and alerts are waiting for the 8th and the 9th
    const week = theUsualWeek(aScratchWorkspace(), {
      cached: [anAlertOn('2026-09-07', { first: 1 })],
      waiting: [anAlertOn('2026-09-08', { search: Search.REGIONAL, first: 2, titles: [Role.SCRUM] }), anAlertOn(YESTERDAY, { first: 3, titles: [Role.OWNER] })],
      covered: [{ from: '2026-09-07', to: '2026-09-07' }],
    });
    // When the operator runs update
    const result = await operatorRunsUpdate(week);
    // Then both days are reported, the 8th before the 9th, and the summary says two days
    expect(result.status, result.stderr).toBe(0);
    expect(indexOfLineMatching(result.stdout, FETCHED_DAY_LINE('2026-09-08'))).toBeGreaterThanOrEqual(0);
    expect(indexOfLineMatching(result.stdout, FETCHED_DAY_LINE('2026-09-08'))).toBeLessThan(indexOfLineMatching(result.stdout, FETCHED_DAY_LINE(YESTERDAY)));
    expect(lastLineOf(result.stdout)).toBe(summaryLineFor(2));
    expect(coveredDays(week)).toEqual([`2026-09-07..${YESTERDAY}`]);
    expect(daysGmailWasAskedFor(week)).toEqual(['2026-09-08', YESTERDAY]);
  }, SLOW);

  it('@error update never fetches today: mail that arrived today waits for the next run', async () => {
    // Given yesterday's alert and an alert dated today are both in the mailbox
    const week = theUsualWeek(aScratchWorkspace(), {
      waiting: [anAlertOn(YESTERDAY, { first: 3, titles: [Role.COACH] }), anAlertOn(TODAY, { search: Search.REGIONAL, first: 4, titles: [Role.OWNER] })],
    });
    const todaysId = week.waitingIds[1];
    const yesterdaysId = week.waitingIds[0];
    // When the operator runs update at 07:30 UTC on the 10th
    const result = await operatorRunsUpdate(week);
    // Then only yesterday is fetched and covered; today's alert stays in the mailbox
    expect(result.status, result.stderr).toBe(0);
    const cache = observeWeek(week)['cache.messageIds'];
    expect(cache).toContain(yesterdaysId);
    expect(cache).not.toContain(todaysId);
    expect(coveredDays(week)).toEqual([`2026-09-07..${YESTERDAY}`]);
    expect(daysGmailWasAskedFor(week)).toEqual([YESTERDAY]);
    expect(lastLineOf(result.stdout)).toBe(summaryLineFor(1));
  }, SLOW);

  it('@error the new adverts reach the Sheet as rows appended after the ones it already held, and the existing rows are not rewritten', async () => {
    // Given the Sheet holds the two adverts of the cache and one more is waiting
    const week = theUsualWeek(aScratchWorkspace(), { waiting: [anAlertOn(YESTERDAY, { first: 3, titles: [Role.COACH] })] });
    const before = observeWeek(week);
    // When the operator runs update
    const result = await operatorRunsUpdate(week);
    // Then the Sheet's keys are the old ones followed by the new one
    expect(result.status, result.stderr).toBe(0);
    assertStateDelta(before, observeWeek(week), {
      universe: ['sheet.jobKeys'],
      expected: { 'sheet.jobKeys': appendedWith(...week.waitingAdvertKeys) },
    });
  }, SLOW);

  it('@error progress and the closing line are on stdout; refusals and the build\'s role-family and search-yield views are on stderr', async () => {
    // Given a run that fetches one day and builds
    const week = theUsualWeek(aScratchWorkspace());
    // When the operator runs update
    const result = await operatorRunsUpdate(week);
    // Then stdout carries the fetch progress, the build's merge summary and the closing line, and none of the views
    expect(result.status, result.stderr).toBe(0);
    expect(includesLine(result.stdout, FETCHED_DAY_LINE(YESTERDAY))).toBe(true);
    expect(includesLine(result.stdout, BUILD_MERGED_LINE)).toBe(true);
    expect(linesOf(result.stdout).filter((line) => SUMMARY_LINE.test(line))).toHaveLength(1);
    expect(result.stdout).not.toMatch(/role families|classified other|search yield|derived correction|update\.[a-z-]+:/);
    // And stderr carries the role-family view, the search-yield view and the change summary, and no update line
    expect(result.stderr).toMatch(/^harvest build: role families:/m);
    expect(result.stderr).toMatch(/classified other; most frequent:/);
    expect(result.stderr).toContain(YIELD_HEADING_PREFIX);
    expect(result.stderr).toMatch(/^harvest build: (no derived corrections|\d+ derived correction)/m);
    expect(result.stderr).not.toMatch(/^harvest update/m);
    expect(result.stderr).not.toContain(STAGE_FAILED_PREFIX);
  }, SLOW);

  it('@error the hour of the day does not matter: the same week run at 23:30 instead of 07:30 fetches the same days and prints the same lines', async () => {
    // Given two identical weeks
    const first = theUsualWeek(aScratchWorkspace());
    const second = theUsualWeek(aScratchWorkspace());
    // When one runs at 07:30 and the other at 23:30 the same day
    const early = await operatorRunsUpdate(first);
    const late = await operatorRuns(second, 'update', [], { clock: NOW.replace('07:30', '23:30') });
    // Then both fetch the same day and print the same stdout
    expect(early.status, early.stderr).toBe(0);
    expect(late.status, late.stderr).toBe(0);
    expect(late.stdout).toBe(early.stdout);
    expect(coveredDays(second)).toEqual(coveredDays(first));
  }, SLOW);
});
