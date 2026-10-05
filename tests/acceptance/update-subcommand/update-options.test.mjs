// @contract-shape:bounded-change
// The options of `harvest update [--from <d>] [--dry-run]` (DR-0016 decisions 1, 6 and 7): `--from` as the override of the
// default start (the earliest covered day), its validation and the refusals the option table gives, the empty ledger that
// refuses `update.no-baseline`, and `--dry-run`, which plans, previews and holds no fetch capability. The refusals are
// `unbounded-preservation`: whatever else the run might have touched, the workspace and both services are exactly as
// they were. Subprocess layer: each sad path is a named example (Mandate 11).
import { describe, expect, it } from 'vitest';
import { assertStateDelta, unchanged } from '../../common/state-delta.mjs';
import { scenario } from './support/red-gate.mjs';
import {
  BUILD_DRY_RUN_HEADING,
  BUILD_MERGED_LINE,
  CliRefusal,
  DRY_RUN_LINE,
  NOTHING_NEW_LINE,
  Role,
  Search,
  SUMMARY_LINE,
  TODAY,
  UpdateRefusal,
  WEEK_FILES_UNIVERSE,
  YESTERDAY,
  YIELD_HEADING_PREFIX,
  anAlertOn,
  anOperatorsWeek,
  aScratchWorkspace,
  coveredDays,
  daysGmailWasAskedFor,
  dryRunLineFor,
  includesLine,
  lastLineOf,
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
const grew = (what) => ({ description: what, holds: (before, after) => after > before });
const allUnchanged = (names) => Object.fromEntries(names.map((name) => [name, unchanged()]));

/** The ledger runs 5th to 8th, an alert from the 2nd (before any covered day) and yesterday's are waiting. */
const aWeekWithAnOlderGap = () =>
  anOperatorsWeek({
    workspace: aScratchWorkspace(),
    cached: [anAlertOn('2026-09-05', { first: 1 }), anAlertOn('2026-09-08', { search: Search.REGIONAL, first: 2, titles: [Role.SCRUM] })],
    waiting: [anAlertOn('2026-09-02', { first: 3, titles: [Role.OWNER] }), anAlertOn(YESTERDAY, { first: 4, titles: [Role.COACH] })],
    covered: [{ from: '2026-09-05', to: '2026-09-08' }],
  });

/** A run that must change nothing and reach no service: exit 1, the refusal named on stderr, the workspace byte-identical. */
async function expectARefusalThatChangesNothing(week, args, expectedCode, { extra = [] } = {}) {
  const before = observeWeekFiles(week);
  const result = await operatorRunsUpdate(week, ...args);
  expect(result.status).toBe(1);
  expect(lastLineOf(result.stderr)).toContain(expectedCode);
  for (const fragment of extra) expect(result.stderr).toContain(fragment);
  expect(result.stdout).toBe('');
  expect(week.gmail.requests).toHaveLength(0);
  expect(week.sheets.requests).toHaveLength(0);
  assertStateDelta(before, observeWeekFiles(week), { universe: WEEK_FILES_UNIVERSE, expected: allUnchanged(WEEK_FILES_UNIVERSE) });
}

describe('@driving_adapter harvest update --from chooses where the fetch starts', () => {
  it('@error by default update starts at the earliest covered day, so a gap before it is not noticed', async () => {
    // Given the ledger runs 5th to 8th, with an alert from the 2nd waiting beyond its start
    const week = aWeekWithAnOlderGap();
    const [olderId] = week.waitingIds;
    // When the operator runs update without --from
    const result = await operatorRunsUpdate(week);
    // Then only yesterday is asked for; the older alert stays in the mailbox
    expect(result.status, result.stderr).toBe(0);
    expect(daysGmailWasAskedFor(week)).toEqual([YESTERDAY]);
    expect(observeWeek(week)['cache.messageIds']).not.toContain(olderId);
    expect(coveredDays(week)).toEqual([`2026-09-05..${YESTERDAY}`]);
  }, SLOW);

  it('@error --from reaches back before the earliest covered day: the gap is fetched, covered and built', async () => {
    // Given an update has already run without --from and left the older gap alone
    const week = aWeekWithAnOlderGap();
    const [olderId] = week.waitingIds;
    const first = await operatorRunsUpdate(week);
    expect(first.status, first.stderr).toBe(0);
    const askedBefore = daysGmailWasAskedFor(week).length;
    // When the operator runs update --from 1 September
    const result = await operatorRunsUpdate(week, '--from', '2026-09-01');
    // Then the four uncovered days before the 5th are asked for, in order, the older alert is cached, and coverage is one run
    expect(result.status, result.stderr).toBe(0);
    expect(daysGmailWasAskedFor(week).slice(askedBefore)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
    expect(observeWeek(week)['cache.messageIds']).toContain(olderId);
    expect(coveredDays(week)).toEqual([`2026-09-01..${YESTERDAY}`]);
    expect(lastLineOf(result.stdout)).toBe(summaryLineFor(4));
    expect(observeWeek(week)['sheet.jobKeys']).toEqual(expect.arrayContaining(week.waitingAdvertKeys));
  }, SLOW);

  it('@error --from inside the covered range changes nothing about the fetch: covered days are skipped, so only the uncovered day is asked for', async () => {
    // Given the ledger runs to the 8th and yesterday's alert is waiting
    const week = theUsualWeek(aScratchWorkspace());
    // When the operator runs update --from 8 September
    const result = await operatorRunsUpdate(week, '--from', '2026-09-08');
    // Then Gmail is asked for yesterday alone
    expect(result.status, result.stderr).toBe(0);
    expect(daysGmailWasAskedFor(week)).toEqual([YESTERDAY]);
    expect(coveredDays(week)).toEqual([`2026-09-07..${YESTERDAY}`]);
  }, SLOW);

  for (const [label, day] of [
    ['today', TODAY],
    ['tomorrow', '2026-09-11'],
    ['a year ahead', '2027-09-10'],
  ]) {
    it(`@error --from ${label} has nothing settled to fetch: update says nothing new, makes no Gmail request and still builds`, async () => {
      // Given yesterday's alert is waiting in the mailbox
      const week = theUsualWeek(aScratchWorkspace());
      // When the operator runs update --from ${day}
      const result = await operatorRunsUpdate(week, '--from', day);
      // Then nothing new is reported, Gmail is never asked, the build runs, and yesterday stays unfetched
      expect(result.status, result.stderr).toBe(0);
      expect(includesLine(result.stdout, NOTHING_NEW_LINE)).toBe(true);
      expect(includesLine(result.stdout, BUILD_MERGED_LINE)).toBe(true);
      expect(lastLineOf(result.stdout)).toBe(summaryLineFor(0));
      expect(week.gmail.requests).toHaveLength(0);
      expect(coveredDays(week)).toEqual(['2026-09-07..2026-09-08']);
    }, SLOW);
  }
});

describe('@driving_adapter harvest update refuses a command line the option table does not allow', () => {
  for (const value of ['2026-02-30', '2026-13-01', 'yesterday', '10/09/2026', '2026-9-1']) {
    it(`@error --from ${value} is refused as cli.invalid-date, and nothing is read, fetched or written`, async () => {
      await expectARefusalThatChangesNothing(theUsualWeek(aScratchWorkspace()), ['--from', value], CliRefusal.INVALID_DATE, { extra: ['--from', value] });
    }, SLOW);
  }

  it('@error --from with nothing after it is refused as cli.missing-value', async () => {
    await expectARefusalThatChangesNothing(theUsualWeek(aScratchWorkspace()), ['--from'], CliRefusal.MISSING_VALUE);
  }, SLOW);

  it('@error --from followed by another option is refused as cli.missing-value, not read as a date', async () => {
    await expectARefusalThatChangesNothing(theUsualWeek(aScratchWorkspace()), ['--from', '--dry-run'], CliRefusal.MISSING_VALUE);
  }, SLOW);

  it('@error --from given twice is refused as cli.duplicate-option', async () => {
    await expectARefusalThatChangesNothing(theUsualWeek(aScratchWorkspace()), ['--from', '2026-09-01', '--from', '2026-09-02'], CliRefusal.DUPLICATE_OPTION);
  }, SLOW);

  it('@error --dry-run given twice is refused as cli.duplicate-option', async () => {
    await expectARefusalThatChangesNothing(theUsualWeek(aScratchWorkspace()), ['--dry-run', '--dry-run'], CliRefusal.DUPLICATE_OPTION);
  }, SLOW);

  for (const [option, args] of [
    ['--to', ['--to', '2026-09-09']],
    ['--source', ['--source', 'linkedin']],
    ['--report', ['--report', 'changes.txt']],
    ['--target', ['--target', 'sheets']],
    ['--wat', ['--wat']],
  ]) {
    it(`@error ${option} is not an option of update: refused as cli.unknown-option, and nothing is read, fetched or written`, async () => {
      await expectARefusalThatChangesNothing(theUsualWeek(aScratchWorkspace()), args, CliRefusal.UNKNOWN_OPTION, { extra: [option, '--from', '--dry-run'] });
    }, SLOW);
  }

  it('@error a misspelt --dry-run is refused as cli.unknown-option and the refusal suggests --dry-run', async () => {
    await expectARefusalThatChangesNothing(theUsualWeek(aScratchWorkspace()), ['--dryrun'], CliRefusal.UNKNOWN_OPTION, { extra: ['did you mean --dry-run?'] });
  }, SLOW);

  it('@error a bare word after update is refused as cli.unexpected-argument', async () => {
    await expectARefusalThatChangesNothing(theUsualWeek(aScratchWorkspace()), ['now'], CliRefusal.UNEXPECTED_ARGUMENT, { extra: ['now is not expected here'] });
  }, SLOW);
});

describe('@driving_adapter harvest update refuses to guess where to start from an empty ledger', () => {
  it('@error with no ledger at all update refuses update.no-baseline, points to fetch --from, and reaches no service', async () => {
    const week = anOperatorsWeek({ workspace: aScratchWorkspace(), cached: [anAlertOn('2026-09-07', { first: 1 })], waiting: [anAlertOn(YESTERDAY, { first: 2 })], covered: null });
    await expectARefusalThatChangesNothing(week, [], UpdateRefusal.NO_BASELINE, { extra: ['fetch --from'] });
  }, SLOW);

  it('@error a ledger that exists and is empty refuses the same way', async () => {
    const week = anOperatorsWeek({ workspace: aScratchWorkspace(), cached: [anAlertOn('2026-09-07', { first: 1 })], waiting: [anAlertOn(YESTERDAY, { first: 2 })], covered: [] });
    await expectARefusalThatChangesNothing(week, [], UpdateRefusal.NO_BASELINE, { extra: ['fetch --from'] });
  }, SLOW);

  it('@error a ledger that covers only another source gives linkedin no baseline', async () => {
    const week = anOperatorsWeek({
      workspace: aScratchWorkspace(),
      cached: [anAlertOn('2026-09-07', { first: 1 })],
      waiting: [anAlertOn(YESTERDAY, { first: 2 })],
      covered: [{ from: '2026-09-01', to: '2026-09-08', source: 'glassdoor' }],
    });
    await expectARefusalThatChangesNothing(week, [], UpdateRefusal.NO_BASELINE, { extra: ['fetch --from'] });
  }, SLOW);

  it('@error a preview refuses the same way: update --dry-run with an empty ledger is update.no-baseline', async () => {
    const week = anOperatorsWeek({ workspace: aScratchWorkspace(), cached: [anAlertOn('2026-09-07', { first: 1 })], covered: [] });
    await expectARefusalThatChangesNothing(week, ['--dry-run'], UpdateRefusal.NO_BASELINE, { extra: ['fetch --from'] });
  }, SLOW);

  it('@error once the operator has backfilled with fetch --from, update has a baseline and runs', async () => {
    // Given an operator whose first update was refused for want of a baseline
    const week = anOperatorsWeek({ workspace: aScratchWorkspace(), cached: [anAlertOn('2026-09-07', { first: 1 })], waiting: [anAlertOn(YESTERDAY, { first: 2 })], covered: [] });
    const refused = await operatorRunsUpdate(week);
    expect(refused.status).toBe(1);
    // When the operator runs the fetch the refusal pointed to, for the 7th and 8th, and then update again
    const fetched = await operatorRuns(week, 'fetch', ['--source', 'linkedin', '--from', '2026-09-07', '--to', '2026-09-08']);
    expect(fetched.status, fetched.stderr).toBe(0);
    const result = await operatorRunsUpdate(week);
    // Then update fetches yesterday and builds
    expect(result.status, result.stderr).toBe(0);
    expect(lastLineOf(result.stdout)).toBe(summaryLineFor(1));
  }, SLOW);
});

describe('@driving_adapter harvest update --dry-run shows what a run would do and does none of it', () => {
  it('@error --dry-run prints the range a run would fetch and its uncovered days, then the build\'s own preview, and makes no Gmail request and no write', async () => {
    // Given the ledger runs to the 8th and yesterday's alert is waiting in the mailbox
    const week = theUsualWeek(aScratchWorkspace());
    const before = observeWeekFiles(week);
    // When the operator runs update --dry-run
    const result = await operatorRunsUpdate(week, '--dry-run');
    // Then stdout says what a run would fetch, followed by the build's preview of the Sheet
    expect(result.status, result.stderr).toBe(0);
    expect(includesLine(result.stdout, dryRunLineFor('2026-09-07', YESTERDAY, 1))).toBe(true);
    expect(includesLine(result.stdout, BUILD_DRY_RUN_HEADING)).toBe(true);
    expect(includesLine(result.stdout, BUILD_MERGED_LINE)).toBe(false);
    expect(result.stdout.split('\n').some((line) => SUMMARY_LINE.test(line))).toBe(false);
    // And Gmail was never contacted, not even for a token, and the Sheet was read but never written
    expect(week.gmail.requests).toHaveLength(0);
    expect(week.sheets.writeRequests()).toHaveLength(0);
    expect(week.sheets.requestsTo('batch-update')).toHaveLength(0);
    assertStateDelta(before, observeWeekFiles(week), {
      universe: WEEK_FILES_UNIVERSE,
      expected: { ...allUnchanged(WEEK_FILES_UNIVERSE), 'sheets.requestCount': grew('the Sheet was read for the preview') },
    });
  }, SLOW);

  it('@error --dry-run prints the build\'s role-family and search-yield views on stderr, as the build does', async () => {
    const week = theUsualWeek(aScratchWorkspace());
    const result = await operatorRunsUpdate(week, '--dry-run');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain(YIELD_HEADING_PREFIX);
    expect(result.stdout).not.toContain(YIELD_HEADING_PREFIX);
    expect(result.stderr).not.toMatch(/^harvest update/m);
  }, SLOW);

  it('@error --dry-run --from counts every uncovered day from that start to yesterday: 1 September on a ledger covering 5th to 8th is five days', async () => {
    // Given the ledger runs 5th to 8th
    const week = aWeekWithAnOlderGap();
    // When the operator previews from 1 September
    const result = await operatorRunsUpdate(week, '--dry-run', '--from', '2026-09-01');
    // Then the line names 1 to 9 September and five uncovered days (the 1st to the 4th, and the 9th)
    expect(result.status, result.stderr).toBe(0);
    expect(includesLine(result.stdout, dryRunLineFor('2026-09-01', YESTERDAY, 5))).toBe(true);
    expect(week.gmail.requests).toHaveLength(0);
  }, SLOW);

  it('@error --dry-run on a ledger that already covers yesterday says zero uncovered days', async () => {
    const week = anOperatorsWeek({
      workspace: aScratchWorkspace(),
      cached: [anAlertOn('2026-09-07', { first: 1 }), anAlertOn('2026-09-08', { search: Search.REGIONAL, first: 2, titles: [Role.SCRUM] }), anAlertOn(YESTERDAY, { first: 3 })],
      covered: [{ from: '2026-09-07', to: YESTERDAY }],
    });
    const result = await operatorRunsUpdate(week, '--dry-run');
    expect(result.status, result.stderr).toBe(0);
    expect(includesLine(result.stdout, dryRunLineFor('2026-09-07', YESTERDAY, 0))).toBe(true);
  }, SLOW);

  it('@error the real run does what the preview said: one uncovered day previewed, one day fetched, and the preview left the cache alone', async () => {
    // Given the operator has previewed an update
    const week = theUsualWeek(aScratchWorkspace());
    const preview = await operatorRunsUpdate(week, '--dry-run');
    expect(preview.status, preview.stderr).toBe(0);
    const previewed = preview.stdout.split('\n').map((line) => DRY_RUN_LINE.exec(line)).find(Boolean);
    expect(Number(previewed[3])).toBe(1);
    const cacheAfterPreview = observeWeek(week)['cache.messageIds'];
    expect(cacheAfterPreview).toEqual(week.cachedIds);
    // When the operator runs it for real
    const result = await operatorRunsUpdate(week);
    // Then it fetches exactly the days the preview counted, and the Sheet gets the adverts the preview did not write
    expect(result.status, result.stderr).toBe(0);
    expect(lastLineOf(result.stdout)).toBe(summaryLineFor(Number(previewed[3])));
    expect(observeWeek(week)['sheet.jobKeys']).toEqual(expect.arrayContaining(week.waitingAdvertKeys));
  }, SLOW);
});
