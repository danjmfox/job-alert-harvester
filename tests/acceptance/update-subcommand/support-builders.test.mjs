// Test infrastructure for update-subcommand: not a scenario, and unskipped. It proves the builders hand the scenarios what
// they claim (so a scenario cannot fail, or pass, because of a fixture): the one origin routes Gmail and Sheets by path and
// the token endpoint by refresh token, the existing `fetch` and `build --target sheets` reach both services through it,
// the stopped clock reaches the subprocess, the week builder splits cache from mailbox and writes the ledger it is told
// to, the scripted faults act only where they say, the lock helpers speak in real process ids, and the generators reach
// the cases the properties are about.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { existsSync, readFileSync } from 'node:fs';
import { SENTINEL } from '../gmail-api-source/support/gmail-domain-types.mjs';
import { createGmailFake, json } from '../gmail-api-source/support/gmail-fake.mjs';
import { SHEETS_SENTINEL, SPREADSHEET_ID } from '../sheets-api-target/support/sheets-constants.mjs';
import { createSheetsFake } from '../sheets-api-target/support/sheets-fake.mjs';
import { createGoogleFront } from '../sheets-api-target/support/google-front.mjs';
import {
  AN_OLD_ALERT_IN_THE_MAILBOX,
  NOW,
  TODAY,
  USUAL_CACHED,
  USUAL_WAITING,
  WEEK_FILES_UNIVERSE,
  WEEK_UNIVERSE,
  YESTERDAY,
  aDeadPid,
  aLockHeldBy,
  aScratchWorkspace,
  anAlertOn,
  anOperatorsWeek,
  cacheRootOf,
  coveredDays,
  daysGmailWasAskedFor,
  gmailListingFailsFrom,
  ledgerPathOf,
  lockPathOf,
  observeWeek,
  observeWeekFiles,
  operatorRuns,
  pidIsAlive,
  sheetRejectsTheDataBatch,
  theLockHolder,
  theUsualWeek,
  useWorkspaceCleanup,
  fileDigests,
} from './support/update-domain-types.mjs';
import { dayOf, daysBetween, daysFrom, epochDayOf, isoDay, lastSettledDay, secondsAtStartOf, shiftDay } from './support/update-oracle.mjs';
import { dayArb, failedFetchArb, instantArb, ledgerArb, ledgerWithBaselineArb, outcomeArb, overrideArb, successfulFetchArb } from './support/update-generators.mjs';

useWorkspaceCleanup();

const form = (refreshToken) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_secret: SENTINEL.clientSecret }).toString(),
});
const BASE = 'http://127.0.0.1:1';
const aFront = () => {
  const gmail = createGmailFake();
  const sheets = createSheetsFake({ tabs: { Jobs: { header: ['Dedup Key'], rows: [] } } });
  return { gmail, sheets, front: createGoogleFront({ gmail, sheets }) };
};

describe('the one origin in front of the two fakes', () => {
  it('sends /token to the fake whose refresh token the form carries, and every other path to the service it belongs to', async () => {
    const { gmail, sheets, front } = aFront();
    const gmailToken = await (await front.handle(`${BASE}/token`, form(SENTINEL.refreshToken))).json();
    const sheetsToken = await (await front.handle(`${BASE}/token`, form(SHEETS_SENTINEL.refreshToken))).json();
    expect(gmailToken.access_token).toBe(SENTINEL.accessToken);
    expect(sheetsToken.access_token).toBe(SHEETS_SENTINEL.accessToken);
    expect(gmail.requests.map((request) => request.route)).toEqual(['token']);
    expect(sheets.tokenRequests()).toHaveLength(1);
    const profile = await front.handle(`${BASE}/gmail/v1/users/me/profile`, { headers: { authorization: `Bearer ${gmailToken.access_token}` } });
    const spreadsheet = await front.handle(`${BASE}/sheets/v4/spreadsheets/${SPREADSHEET_ID}`, { headers: { authorization: `Bearer ${sheetsToken.access_token}` } });
    const file = await front.handle(`${BASE}/drive/v3/files/${SPREADSHEET_ID}?fields=id`, { headers: { authorization: `Bearer ${sheetsToken.access_token}` } });
    expect([profile.status, spreadsheet.status, file.status]).toEqual([200, 200, 200]);
    expect(gmail.requests.map((request) => request.route)).toEqual(['token', 'profile']);
    expect(sheets.apiRequests().map((request) => request.route)).toEqual(['get', 'drive-get']);
    expect(front.trace.map((entry) => `${entry.service}:${entry.route}`)).toEqual(['gmail:token', 'sheets:token', 'gmail:profile', 'sheets:get', 'sheets:drive-get']);
  });

  it('answers 404 to a path that belongs to neither service, traces it as none, and sends an unknown refresh token to Gmail, which refuses it', async () => {
    const { gmail, sheets, front } = aFront();
    expect((await front.handle(`${BASE}/somewhere/else`, {})).status).toBe(404);
    const unknown = await front.handle(`${BASE}/token`, form('1//not-a-token'));
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toBe('invalid_grant');
    expect(front.trace.map((entry) => entry.service)).toEqual(['none', 'gmail']);
    expect(gmail.requests).toHaveLength(1);
    expect(sheets.requests).toHaveLength(0);
  });

  it('keeps the two services\' credentials apart: a Gmail access token is not accepted by Sheets', async () => {
    const { front } = aFront();
    const gmailToken = await (await front.handle(`${BASE}/token`, form(SENTINEL.refreshToken))).json();
    await front.handle(`${BASE}/token`, form(SHEETS_SENTINEL.refreshToken));
    const refused = await front.handle(`${BASE}/sheets/v4/spreadsheets/${SPREADSHEET_ID}`, { headers: { authorization: `Bearer ${gmailToken.access_token}` } });
    expect(refused.status).toBe(401);
  });

  it('serves a binary body unchanged, as the loopback server hands it over', async () => {
    const { sheets, front } = aFront();
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff]);
    await front.handle(`${BASE}/upload/drive/v3/files?uploadType=multipart`, { method: 'POST', headers: { 'content-type': 'multipart/related; boundary=x' }, body: bytes });
    expect(sheets.requests[0].raw.equals(bytes)).toBe(true);
  });
});

describe('the week an operator has', () => {
  it('splits the plan into a cache and a mailbox with distinct message ids, and writes the ledger it is told to, counting the cached messages inside each interval', () => {
    const week = theUsualWeek(aScratchWorkspace());
    expect(week.cachedIds).toEqual(['alert-0000', 'alert-0001']);
    expect(week.waitingIds).toEqual(['alert-0002']);
    expect(new Set([...week.cachedIds, ...week.waitingIds]).size).toBe(3);
    const ledger = JSON.parse(readFileSync(ledgerPathOf(week), 'utf8'));
    expect(ledger).toEqual([expect.objectContaining({ source: 'linkedin', from: '2026-09-07', to: '2026-09-08', messageCount: 2 })]);
    expect(observeWeek(week)['cache.messageIds']).toEqual(week.cachedIds);
    expect(week.gmail.requests).toHaveLength(0);
    expect(week.sheets.requests).toHaveLength(0);
  });

  it('leaves no ledger file for null, an empty ledger for an empty list, and another source\'s interval when told', () => {
    const none = anOperatorsWeek({ workspace: aScratchWorkspace(), cached: [...USUAL_CACHED], covered: null });
    const empty = anOperatorsWeek({ workspace: aScratchWorkspace(), cached: [...USUAL_CACHED], covered: [] });
    const other = anOperatorsWeek({ workspace: aScratchWorkspace(), cached: [...USUAL_CACHED], covered: [{ from: '2026-09-01', to: '2026-09-08', source: 'glassdoor' }] });
    expect(existsSync(ledgerPathOf(none))).toBe(false);
    expect(JSON.parse(readFileSync(ledgerPathOf(empty), 'utf8'))).toEqual([]);
    expect(coveredDays(other)).toEqual([]);
    expect(JSON.parse(readFileSync(ledgerPathOf(other), 'utf8'))[0].source).toBe('glassdoor');
  });

  it('gives a Sheet that holds the cache by default, so a run with nothing new sends no data batch, and one with headers only when asked', () => {
    const holding = theUsualWeek(aScratchWorkspace());
    const headersOnly = theUsualWeek(aScratchWorkspace(), { sheet: 'headers-only' });
    expect(observeWeek(holding)['sheet.jobKeys']).toEqual(holding.cachedAdvertKeys);
    expect(observeWeek(headersOnly)['sheet.jobKeys']).toEqual([]);
  });

  it('names the adverts of the waiting alerts as the dedup keys the Sheet will carry', () => {
    const week = theUsualWeek(aScratchWorkspace());
    expect(week.waitingAdvertKeys).toHaveLength(USUAL_WAITING[0].adverts.length);
    expect(week.waitingAdvertKeys.every((key) => key.startsWith('linkedin:'))).toBe(true);
  });
});

describe('the existing commands, reaching both services through the one origin', () => {
  it('fetch reads Gmail and build --target sheets then writes the Sheet, both through the front, leaving what update must compose: the alert cached, the day covered, the adverts in the Sheet', async () => {
    const week = theUsualWeek(aScratchWorkspace());
    const fetched = await operatorRuns(week, 'fetch', ['--source', 'linkedin', '--from', '2026-09-07', '--to', TODAY]);
    expect(fetched.status, fetched.stderr).toBe(0);
    expect(fetched.stdout).toContain(`harvest fetch: ${YESTERDAY}..${YESTERDAY} — 1 message(s)`);
    expect(week.sheets.requests).toHaveLength(0);
    const built = await operatorRuns(week, 'build', ['--target', 'sheets']);
    expect(built.status, built.stderr).toBe(0);
    expect(built.stdout).toContain('harvest build: merged');
    expect(built.stderr).toMatch(/classified other; most frequent:/);
    expect(coveredDays(week)).toEqual([`2026-09-07..${YESTERDAY}`]);
    expect(observeWeek(week)['sheet.jobKeys']).toEqual(expect.arrayContaining([...week.cachedAdvertKeys, ...week.waitingAdvertKeys]));
    const services = week.front.trace.map((entry) => entry.service);
    expect(services.indexOf('sheets')).toBeGreaterThan(services.lastIndexOf('gmail'));
  });

  it('reports a covered range as already covered without contacting Gmail, and a day that has not ended as nothing settled', async () => {
    const week = theUsualWeek(aScratchWorkspace());
    const covered = await operatorRuns(week, 'fetch', ['--source', 'linkedin', '--from', '2026-09-07', '--to', '2026-09-08']);
    const today = await operatorRuns(week, 'fetch', ['--source', 'linkedin', '--from', TODAY, '--to', TODAY]);
    expect(covered.stdout).toContain('is already covered');
    expect(today.stdout).toContain('nothing settled to fetch');
    expect(week.gmail.requests).toHaveLength(0);
  });

  it('stops the clock in the subprocess: the same fetch covers one more day an instant after midnight', async () => {
    const early = theUsualWeek(aScratchWorkspace(), { waiting: [AN_OLD_ALERT_IN_THE_MAILBOX] });
    const later = theUsualWeek(aScratchWorkspace(), { waiting: [AN_OLD_ALERT_IN_THE_MAILBOX] });
    await operatorRuns(early, 'fetch', ['--source', 'linkedin', '--from', '2026-09-07', '--to', '2026-09-30']);
    await operatorRuns(later, 'fetch', ['--source', 'linkedin', '--from', '2026-09-07', '--to', '2026-09-30'], { clock: '2026-09-11T00:00:01.000Z' });
    expect(coveredDays(early)).toEqual([`2026-09-07..${YESTERDAY}`]);
    expect(coveredDays(later)).toEqual([`2026-09-07..${TODAY}`]);
  });

  it('records the days Gmail was asked for, in order, from each listing\'s query', async () => {
    const week = anOperatorsWeek({
      workspace: aScratchWorkspace(),
      cached: [anAlertOn('2026-09-05', { first: 1 })],
      waiting: [anAlertOn('2026-09-07', { first: 2 }), anAlertOn(YESTERDAY, { first: 3 })],
      covered: [{ from: '2026-09-05', to: '2026-09-06' }],
    });
    await operatorRuns(week, 'fetch', ['--source', 'linkedin', '--from', '2026-09-05', '--to', TODAY]);
    expect(daysGmailWasAskedFor(week)).toEqual(['2026-09-07', '2026-09-08', YESTERDAY]);
  });
});

describe('the scripted faults', () => {
  it('refuses listings only from the day it is told, only while it is on, and a switched-off fault lets the same run succeed', async () => {
    const week = anOperatorsWeek({
      workspace: aScratchWorkspace(),
      cached: [anAlertOn('2026-09-06', { first: 1 })],
      waiting: [anAlertOn('2026-09-07', { first: 2 }), anAlertOn('2026-09-08', { first: 3 })],
      covered: [{ from: '2026-09-06', to: '2026-09-06' }],
    });
    const failing = gmailListingFailsFrom(week, '2026-09-08', () => json(403, { error: { code: 403, message: 'no', errors: [{ reason: 'forbidden' }] } }));
    const args = ['--source', 'linkedin', '--from', '2026-09-06', '--to', '2026-09-08'];
    const stopped = await operatorRuns(week, 'fetch', args);
    expect(stopped.status).toBe(1);
    expect(coveredDays(week)).toEqual(['2026-09-06..2026-09-07']);
    failing.on = false;
    const resumed = await operatorRuns(week, 'fetch', args);
    expect(resumed.status, resumed.stderr).toBe(0);
    expect(coveredDays(week)).toEqual(['2026-09-06..2026-09-08']);
  });

  it('refuses the Sheet\'s data batch only while it is on, and the build then succeeds and writes', async () => {
    const week = theUsualWeek(aScratchWorkspace());
    await operatorRuns(week, 'fetch', ['--source', 'linkedin', '--from', '2026-09-07', '--to', TODAY]);
    const failing = sheetRejectsTheDataBatch(week, () => json(400, { error: { code: 400, message: 'no', status: 'INVALID_ARGUMENT' } }));
    const refused = await operatorRuns(week, 'build', ['--target', 'sheets']);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('sheets.request-rejected');
    expect(observeWeek(week)['sheet.jobKeys']).toEqual(week.cachedAdvertKeys);
    failing.on = false;
    const built = await operatorRuns(week, 'build', ['--target', 'sheets']);
    expect(built.status, built.stderr).toBe(0);
    expect(observeWeek(week)['sheet.jobKeys']).toEqual(expect.arrayContaining(week.waitingAdvertKeys));
  });
});

describe('the lock helpers', () => {
  it('finds a process id that really is dead, and knows the test\'s own is alive', () => {
    const dead = aDeadPid();
    expect(Number.isInteger(dead)).toBe(true);
    expect(pidIsAlive(dead)).toBe(false);
    expect(pidIsAlive(process.pid)).toBe(true);
  });

  it('leaves the lock as a running update would: the pid as digits at .cache/update.lock, and nothing else under .cache/ changes', () => {
    const week = theUsualWeek(aScratchWorkspace());
    const before = fileDigests(`${week.workspace}/.cache`);
    aLockHeldBy(week, 4242);
    expect(theLockHolder(week)).toBe('4242');
    expect(lockPathOf(week)).toBe(`${week.workspace}/.cache/update.lock`);
    const after = fileDigests(`${week.workspace}/.cache`);
    expect(Object.keys(after).filter((name) => !(name in before))).toEqual(['update.lock']);
  });

  it('reads a week\'s files as digests, so a run that changes nothing is provably byte-identical', () => {
    const week = theUsualWeek(aScratchWorkspace());
    expect(observeWeekFiles(week)).toEqual(observeWeekFiles(week));
    expect(Object.keys(observeWeekFiles(week))).toEqual([...WEEK_FILES_UNIVERSE]);
    expect(Object.keys(observeWeek(week))).toEqual([...WEEK_UNIVERSE]);
    expect(cacheRootOf(week)).toBe(`${week.workspace}/.cache/messages`);
  });
});

describe('the calendar oracle', () => {
  it('does day arithmetic across a month, a year and a leap day', () => {
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-09-01', '2026-09-10')).toBe(9);
    expect(daysFrom('2026-09-01', '2026-09-04')).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
    expect(daysFrom('2026-09-04', '2026-09-01')).toEqual([]);
    expect(isoDay(epochDayOf('2026-09-10T23:59:59Z'))).toBe('2026-09-10');
  });

  it('names the day of the stopped clock and the last day that has ended before it', () => {
    expect(dayOf(NOW)).toBe(TODAY);
    expect(lastSettledDay(NOW)).toBe(YESTERDAY);
    expect(lastSettledDay('2026-09-10T00:00:00.000Z')).toBe(YESTERDAY);
    expect(secondsAtStartOf('2026-09-10')).toBe(Date.parse('2026-09-10T00:00:00Z') / 1000);
  });
});

describe('the generators reach the cases the properties are about', () => {
  const sample = (arbitrary, count = 400) => fc.sample(arbitrary, { numRuns: count, seed: 7 });

  it('reach a ledger with no baseline, a baseline, an override, and an override later than today', () => {
    const cases = sample(fc.tuple(ledgerArb, instantArb, overrideArb));
    expect(cases.some(([ledger, , override]) => override === undefined && !ledger.some((interval) => interval.source === 'linkedin'))).toBe(true);
    expect(cases.some(([ledger, , override]) => override === undefined && ledger.some((interval) => interval.source === 'linkedin'))).toBe(true);
    expect(cases.some(([, , override]) => override !== undefined)).toBe(true);
    expect(cases.some(([, now, override]) => override !== undefined && override > dayOf(now))).toBe(true);
    expect(sample(ledgerWithBaselineArb).every((ledger) => ledger.some((interval) => interval.source === 'linkedin'))).toBe(true);
  });

  it('reach the first and the last millisecond of a day, a leap day and a year end', () => {
    const instants = sample(instantArb, 2000);
    expect(instants.some((iso) => iso.endsWith('T00:00:00.000Z'))).toBe(true);
    expect(instants.some((iso) => iso.endsWith('T23:59:59.999Z'))).toBe(true);
    expect(sample(dayArb, 6000).some((day) => day.endsWith('-02-29'))).toBe(true);
    expect(sample(dayArb, 6000).some((day) => day.endsWith('-12-31'))).toBe(true);
  });

  it('reach every stage outcome: a good fetch with no windows, a good fetch with some, a failure with and without a code, a failure that committed days, and a failed build', () => {
    const successes = sample(successfulFetchArb);
    expect(successes.some((fetch) => fetch.windowsCommitted === 0)).toBe(true);
    expect(successes.some((fetch) => fetch.windowsCommitted > 0)).toBe(true);
    const failures = sample(failedFetchArb);
    expect(failures.some((fetch) => fetch.code === null)).toBe(true);
    expect(failures.some((fetch) => fetch.code !== null)).toBe(true);
    expect(failures.some((fetch) => fetch.windowsCommitted > 0)).toBe(true);
    const outcomes = sample(outcomeArb);
    expect(outcomes.some((outcome) => outcome.fetch.ok && outcome.build?.ok)).toBe(true);
    expect(outcomes.some((outcome) => outcome.fetch.ok && outcome.build && !outcome.build.ok)).toBe(true);
    expect(outcomes.some((outcome) => !outcome.fetch.ok && outcome.build === null)).toBe(true);
  });
});
