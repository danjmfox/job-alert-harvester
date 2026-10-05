// @contract-shape:bounded-change
// `harvest build` against an .xlsx tracker, as an operator runs it: a real subprocess through the production composition
// root, a synthetic cache of alerts (searches, titles and overlap invented here, parsed by the real parser), a real workbook
// in an isolated workspace and an empty HOME (the offline target needs no credential). The search yield is derived from the
// whole cache and printed to stderr beside the role-family view (DR-0015); the tracker's cells and columns, stdout and the
// --report file are exactly what they were without it. Subprocess layer: example-only, sad paths enumerated (Mandate 11);
// the pure properties live in search-yield-properties.test.mjs.
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { assertStateDelta, unchanged } from '../../common/state-delta.mjs';
import {
  ALL_TIME_HEADING,
  BLANK_SEARCH,
  COMPANIES_COLUMNS,
  FORTY_CHARACTER_SEARCH,
  JOBS_COLUMNS,
  LONG_SEARCH,
  LONG_SEARCH_AS_SHOWN,
  NO_SEARCH,
  Role,
  SOURCES_COLUMNS,
  Search,
  THE_COHORT_YIELD_LINES,
  THE_SPREAD_YIELD_LINES,
  TOTAL_ROW_LABEL,
  TRACKER_UNIVERSE,
  UNPARSED_SEARCH_LABEL,
  YIELD_HEADING_PREFIX,
  aCacheOfAlerts,
  aScratchWorkspace,
  aTrackerHoldingTheCache,
  anAlert,
  anEmptyTracker,
  expectedStderrFor,
  fileDigests,
  indexOfLine,
  jobCountIn,
  jobFamiliesIn,
  jobsFoundBySearch,
  manySearches,
  observeTracker,
  operatorBuildsNewWorkbook,
  operatorMerges,
  operatorMergesOnAnotherDay,
  operatorPreviews,
  operatorRebuildsFromTheCache,
  operatorRunsBuildWith,
  otherJobCountIn,
  recentHeadingTo,
  reportTextOf,
  rowOf,
  sightingsOf,
  stderrWithoutYield,
  theAdverts,
  theCohort,
  theSpreadCohort,
  trackerCells,
  useWorkspaceCleanup,
  yieldBlocksIn,
  yieldHeadingsIn,
  yieldLinesIn,
} from './support/search-yield-domain-types.mjs';
import { scenario } from './support/red-gate.mjs';

useWorkspaceCleanup();

const { BROAD, REGIONAL } = Search;
const holdsThat = (description, test) => ({ description, holds: (before, after) => test(before, after) });
const allUnchanged = (names) => Object.fromEntries(names.map((name) => [name, unchanged()]));

/** An operator whose cache holds `alerts` and whose tracker is `empty` (headers only) or `matching` (exactly what the harvest derives, notes typed in). */
function anOperatorWith(alerts, { tracker = 'empty' } = {}) {
  const workspace = aScratchWorkspace();
  aCacheOfAlerts(workspace, alerts);
  const path = join(workspace, 'tracker.xlsx');
  if (tracker === 'matching') aTrackerHoldingTheCache(path, workspace);
  else anEmptyTracker(path);
  return { workspace, tracker: path };
}
const CORRECTIONS_LINE = /^harvest build: (no derived corrections|\d+ derived correction)/;
/** Two searches sending two adverts each on the two given days, so the cache spans exactly those dates. */
const twoSearchesBetween = (earliest, latest) => {
  const [a, b, c, d] = theAdverts([Role.COACH, Role.SCRUM, Role.DELIVERY, Role.OWNER], 401);
  return [
    anAlert({ search: BROAD, on: earliest, adverts: [a] }),
    anAlert({ search: REGIONAL, on: earliest, adverts: [b] }),
    anAlert({ search: BROAD, on: latest, adverts: [c] }),
    anAlert({ search: REGIONAL, on: latest, adverts: [d] }),
  ];
};

describe('@driving_adapter build --merge prints the search yield on stderr, beside the role-family view', () => {
  it('@real-io the merge prints the all-time yield per saved search: found, other, on-target and unique, ordered by found then search, in whole percentages', () => {
    // Given eleven adverts found by four overlapping saved searches and one alert that names no search, and a tracker that holds none of them
    const { workspace, tracker } = anOperatorWith(theCohort().alerts);
    // When the operator merges the cache into the tracker
    const result = operatorMerges(workspace, tracker);
    // Then stderr carries the all-time block, one row per search, and only that block (the cache spans six days)
    expect(result.status, result.stderr).toBe(0);
    expect(yieldLinesIn(result.stderr)).toEqual(THE_COHORT_YIELD_LINES);
    expect(yieldHeadingsIn(result.stderr)).toEqual([ALL_TIME_HEADING]);
    expect(result.stdout).toMatch(/Jobs: rows updated: 0, rows appended: 11/);
  });

  it('@error stdout and the --report file never carry a yield line, whatever the run changes', () => {
    // Given a cache of overlapping searches and a tracker that holds none of them
    const { workspace, tracker } = anOperatorWith(theCohort().alerts);
    const report = join(workspace, 'changes.txt');
    // When the operator merges and asks for the report
    const result = operatorMerges(workspace, tracker, '--report', report);
    // Then the yield is on stderr, and neither stdout nor the report mention it
    expect(result.status, result.stderr).toBe(0);
    expect(yieldLinesIn(result.stderr)).toEqual(THE_COHORT_YIELD_LINES);
    expect(`${result.stdout}\n${reportTextOf(report)}`).not.toMatch(/search yield|\(no search term\)|all searches|on-target/);
  });

  it('@error an empty report still means nothing changed: a build into a tracker that already holds everything prints the yield and writes an empty report', () => {
    // Given a tracker that already holds exactly what the cache derives
    const { workspace, tracker } = anOperatorWith(theCohort().alerts, { tracker: 'matching' });
    const report = join(workspace, 'changes.txt');
    // When the operator merges and asks for the report
    const result = operatorMerges(workspace, tracker, '--report', report);
    // Then the yield is printed, and the report exists and is empty
    expect(result.status, result.stderr).toBe(0);
    expect(yieldLinesIn(result.stderr)).toEqual(THE_COHORT_YIELD_LINES);
    expect(reportTextOf(report)).toBe('');
    expect(result.stderr).toMatch(/no derived corrections/);
  });

  it('@error the tracker is cell for cell what it was: a tracker already holding the cache is identical after a merge that prints the yield', () => {
    // Given a tracker holding what the cache derives, with the operator's notes typed in
    const { workspace, tracker } = anOperatorWith(theCohort().alerts, { tracker: 'matching' });
    const before = observeTracker(tracker);
    const cellsBefore = trackerCells(tracker);
    // When the operator merges
    const result = operatorMerges(workspace, tracker);
    // Then the yield was printed, and not one cell, header, tab or format moved
    expect(result.status, result.stderr).toBe(0);
    expect(yieldLinesIn(result.stderr)).toEqual(THE_COHORT_YIELD_LINES);
    assertStateDelta(before, observeTracker(tracker), { universe: TRACKER_UNIVERSE, expected: allUnchanged(TRACKER_UNIVERSE) });
    expect(trackerCells(tracker)).toEqual(cellsBefore);
    expect(result.stdout).toMatch(/Jobs: rows updated: 11, rows appended: 0, columns appended: 0, cell changes: 0/);
  });

  it('@error the merge adds only the three declared tabs and their declared columns: no yield tab, column or cell appears in the tracker', () => {
    // Given a tracker holding only its headers
    const { workspace, tracker } = anOperatorWith(theCohort().alerts);
    const before = observeTracker(tracker);
    // When the operator merges
    const result = operatorMerges(workspace, tracker);
    // Then the yield was printed, the tabs and headers are the declared ones, and rows arrived in the three tabs only
    expect(result.status, result.stderr).toBe(0);
    expect(yieldLinesIn(result.stderr)).toEqual(THE_COHORT_YIELD_LINES);
    assertStateDelta(before, observeTracker(tracker), {
      universe: TRACKER_UNIVERSE,
      expected: {
        'tracker.jobs': holdsThat('11 rows under the declared Jobs header', (b, a) => JSON.stringify(a.header) === JSON.stringify(JOBS_COLUMNS) && a.rows.length === 11),
        'tracker.companies': holdsThat('rows under the declared Companies header', (b, a) => JSON.stringify(a.header) === JSON.stringify(COMPANIES_COLUMNS) && a.rows.length > 0),
        'tracker.sources': holdsThat('4 rows under the declared Sources header', (b, a) => JSON.stringify(a.header) === JSON.stringify(SOURCES_COLUMNS) && a.rows.length === 4),
      },
    });
    expect(observeTracker(tracker)['tracker.tabNames']).toEqual(['Jobs', 'Companies', 'Sources']);
  });

  it('@error the yield comes after the change summary and the role-family view, since adverts fell through to other', () => {
    const { workspace, tracker } = anOperatorWith(theCohort().alerts);
    const result = operatorMerges(workspace, tracker);
    expect(result.status, result.stderr).toBe(0);
    const summary = indexOfLine(result.stderr, CORRECTIONS_LINE);
    const tuning = indexOfLine(result.stderr, /^harvest build: \d+ of \d+ advert\(s\) classified other; most frequent:/);
    const yielded = indexOfLine(result.stderr, new RegExp(`^${YIELD_HEADING_PREFIX}`));
    expect(summary).toBeGreaterThanOrEqual(0);
    expect(tuning).toBeGreaterThan(summary);
    expect(yielded).toBeGreaterThan(tuning);
  });

  it('@error a second merge prints the same yield and changes nothing: the figures come from the cache, not from the run before', () => {
    const { workspace, tracker } = anOperatorWith(theCohort().alerts);
    const first = operatorMerges(workspace, tracker);
    expect(first.status, first.stderr).toBe(0);
    const before = observeTracker(tracker);
    const second = operatorMerges(workspace, tracker);
    expect(second.status, second.stderr).toBe(0);
    expect(yieldLinesIn(second.stderr)).toEqual(yieldLinesIn(first.stderr));
    expect(yieldLinesIn(second.stderr)).toEqual(THE_COHORT_YIELD_LINES);
    assertStateDelta(before, observeTracker(tracker), { universe: TRACKER_UNIVERSE, expected: allUnchanged(TRACKER_UNIVERSE) });
  });

  it('@error the yield does not depend on what the tracker holds: an empty tracker and one the operator has filled in and extended give the same lines', () => {
    const empty = anOperatorWith(theCohort().alerts);
    const filled = anOperatorWith(theCohort().alerts, { tracker: 'matching' });
    const fromEmpty = operatorMerges(empty.workspace, empty.tracker);
    const fromFilled = operatorMerges(filled.workspace, filled.tracker);
    expect(fromEmpty.status, fromEmpty.stderr).toBe(0);
    expect(fromFilled.status, fromFilled.stderr).toBe(0);
    expect(yieldLinesIn(fromFilled.stderr)).toEqual(yieldLinesIn(fromEmpty.stderr));
    expect(yieldLinesIn(fromEmpty.stderr)).toEqual(THE_COHORT_YIELD_LINES);
  });
});

describe('@driving_adapter build --dry-run prints the same yield and writes nothing', () => {
  // @contract-shape:unbounded-preservation
  scenario('@error a preview against a tracker prints the yield on stderr, the plan on stdout, and the workspace is byte-identical afterwards', () => {
    const { workspace, tracker } = anOperatorWith(theCohort().alerts);
    const before = { 'workspace.files': fileDigests(workspace) };
    const result = operatorPreviews(workspace, '--merge', tracker);
    expect(result.status, result.stderr).toBe(0);
    expect(yieldLinesIn(result.stderr)).toEqual(THE_COHORT_YIELD_LINES);
    expect(result.stdout).toMatch(/rows to append: 11/);
    expect(result.stdout).not.toMatch(/search yield/);
    assertStateDelta(before, { 'workspace.files': fileDigests(workspace) }, { universe: ['workspace.files'] });
  });

  // @contract-shape:unbounded-preservation
  scenario('@error a preview with no tracker prints the yield too, and creates no file', () => {
    const workspace = aScratchWorkspace();
    aCacheOfAlerts(workspace, theCohort().alerts);
    const before = { 'workspace.files': fileDigests(workspace) };
    const result = operatorPreviews(workspace);
    expect(result.status, result.stderr).toBe(0);
    expect(yieldLinesIn(result.stderr)).toEqual(THE_COHORT_YIELD_LINES);
    assertStateDelta(before, { 'workspace.files': fileDigests(workspace) }, { universe: ['workspace.files'] });
  });

  // @contract-shape:unbounded-preservation
  scenario('@error a preview shows exactly the yield the build then prints, and the build leaves nothing more behind than the tracker', () => {
    const { workspace, tracker } = anOperatorWith(theSpreadCohort().alerts);
    const previewed = operatorPreviews(workspace, '--merge', tracker);
    const built = operatorMerges(workspace, tracker);
    expect(previewed.status, previewed.stderr).toBe(0);
    expect(built.status, built.stderr).toBe(0);
    expect(yieldLinesIn(previewed.stderr)).toEqual(THE_SPREAD_YIELD_LINES);
    expect(yieldLinesIn(built.stderr)).toEqual(yieldLinesIn(previewed.stderr));
  });

  // @contract-shape:unbounded-preservation
  scenario('@error the preview prints the yield after its own plan summary and role-family view', () => {
    const { workspace, tracker } = anOperatorWith(theCohort().alerts);
    const result = operatorPreviews(workspace, '--merge', tracker);
    expect(result.status, result.stderr).toBe(0);
    const summary = indexOfLine(result.stderr, CORRECTIONS_LINE);
    const tuning = indexOfLine(result.stderr, /classified other; most frequent:/);
    const yielded = indexOfLine(result.stderr, new RegExp(`^${YIELD_HEADING_PREFIX}`));
    expect([summary >= 0, tuning > summary, yielded > tuning]).toEqual([true, true, true]);
  });
});

describe('@driving_adapter build prints no yield when it creates a workbook or rebuilds from a directory', () => {
  it('@error creating a new workbook prints no yield and neither does the rebuild form, and a merge into the new workbook then does', () => {
    // Given a cache of overlapping searches
    const workspace = aScratchWorkspace();
    aCacheOfAlerts(workspace, theCohort().alerts);
    const created = join(workspace, 'new.xlsx');
    const rebuilt = join(workspace, 'rebuilt.xlsx');
    // When the operator creates a workbook, and rebuilds one from the cache directory
    const create = operatorBuildsNewWorkbook(workspace, created);
    const rebuild = operatorRebuildsFromTheCache(workspace, rebuilt);
    // Then neither prints a yield
    expect(create.status, create.stderr).toBe(0);
    expect(rebuild.status, rebuild.stderr).toBe(0);
    expect(yieldHeadingsIn(create.stderr)).toEqual([]);
    expect(yieldHeadingsIn(rebuild.stderr)).toEqual([]);
    // And the next run, a merge into the workbook just created, prints it
    const merge = operatorMerges(workspace, created);
    expect(merge.status, merge.stderr).toBe(0);
    expect(yieldLinesIn(merge.stderr)).toEqual(THE_COHORT_YIELD_LINES);
  });

  it('@error build refuses an option the yield might have wanted: there is no --since, and nothing is written', () => {
    const { workspace, tracker } = anOperatorWith(theCohort().alerts);
    const before = { 'workspace.files': fileDigests(workspace) };
    const result = operatorRunsBuildWith(workspace, '--dry-run', '--merge', tracker, '--since', '2026-09-01');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/cli\.unknown-option: --since is not an option of build/);
    expect(yieldHeadingsIn(result.stderr)).toEqual([]);
    assertStateDelta(before, { 'workspace.files': fileDigests(workspace) }, { universe: ['workspace.files'] });
  });
});

describe('@driving_adapter the yield agrees with the tracker it sits beside', () => {
  it('@error found equals the Sources tab Jobs Found for every named search, and the total row matches the Jobs tab', () => {
    // Given a workbook created from the cache, and the same cache merged into it
    const workspace = aScratchWorkspace();
    aCacheOfAlerts(workspace, theCohort().alerts);
    const tracker = join(workspace, 'tracker.xlsx');
    expect(operatorBuildsNewWorkbook(workspace, tracker).status).toBe(0);
    const result = operatorMerges(workspace, tracker);
    expect(result.status, result.stderr).toBe(0);
    // Then each named search's found is the Sources tab's Jobs Found
    const [block] = yieldBlocksIn(result.stderr);
    expect(block, 'a yield block was printed').toBeDefined();
    const named = block.rows.filter(({ label }) => ![UNPARSED_SEARCH_LABEL, TOTAL_ROW_LABEL].includes(label));
    expect(named).toHaveLength(4);
    expect(Object.fromEntries(named.map(({ label, found }) => [label, found]))).toEqual(jobsFoundBySearch(tracker));
    // And the total row counts the Jobs rows, and its other figure counts the Jobs rows whose Role Family is other
    expect(rowOf([block], TOTAL_ROW_LABEL)).toMatchObject({ found: jobCountIn(tracker), other: otherJobCountIn(tracker) });
    expect(Object.keys(jobsFoundBySearch(tracker))).not.toContain(UNPARSED_SEARCH_LABEL);
  });

  it('@error an advert two searches found counts under both for found, other and on-target, and under neither for unique', () => {
    // Given a Scrum Master found by two searches, one other advert beside it in each
    const [shared, onlyBroad, onlyRegional] = theAdverts([Role.SCRUM, Role.ANALYST, Role.PROGRAMME], 501);
    const alerts = [anAlert({ search: BROAD, on: '2026-09-01', adverts: [shared, onlyBroad] }), anAlert({ search: REGIONAL, on: '2026-09-01', adverts: [shared, onlyRegional] })];
    const { workspace, tracker } = anOperatorWith(alerts);
    // When the operator merges
    const result = operatorMerges(workspace, tracker);
    // Then the shared advert is in both rows and unique to neither
    expect(result.status, result.stderr).toBe(0);
    const blocks = yieldBlocksIn(result.stderr);
    expect(rowOf(blocks, BROAD)).toMatchObject({ found: 2, other: 1, onTarget: 1, unique: 0 });
    expect(rowOf(blocks, REGIONAL)).toMatchObject({ found: 2, other: 0, onTarget: 2, unique: 1 });
    expect(rowOf(blocks, TOTAL_ROW_LABEL)).toMatchObject({ found: 3, other: 1, onTarget: 2, unique: null });
  });

  it('@error an advert one search resends on five days counts once, and a repost under a new job id counts twice, as the Jobs tab holds two rows for it', () => {
    const [advert, repost, other] = theAdverts([Role.COACH, Role.COACH, Role.SCRUM], 601);
    const resends = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'].map((on) => anAlert({ search: BROAD, on, adverts: [advert] }));
    const alerts = [...resends, anAlert({ search: BROAD, on: '2026-09-06', adverts: [repost] }), anAlert({ search: REGIONAL, on: '2026-09-06', adverts: [other] })];
    const { workspace, tracker } = anOperatorWith(alerts);
    const result = operatorMerges(workspace, tracker);
    expect(result.status, result.stderr).toBe(0);
    const blocks = yieldBlocksIn(result.stderr);
    expect(rowOf(blocks, BROAD)).toMatchObject({ found: 2, onTarget: 2, unique: 2 });
    expect(rowOf(blocks, TOTAL_ROW_LABEL).found).toBe(3);
    expect(jobCountIn(tracker)).toBe(3);
  });

  const RETITLED = [
    ['Scrum Master', 'Data Analyst', 'scrum master', 0],
    ['Data Analyst', 'Scrum Master', 'other', 1],
  ];
  for (const [firstTitle, laterTitle, family, otherCount] of RETITLED) {
    it(`@error an advert first sighted as ${firstTitle} and later titled ${laterTitle} counts as ${family} under both searches, as its Jobs row does`, () => {
      // Given one advert sighted in May by one search and in July, retitled, by another
      const [first, filler] = theAdverts([firstTitle, Role.COACH], 701);
      const alerts = [
        anAlert({ search: REGIONAL, on: '2026-07-20', adverts: [{ ...first, title: laterTitle }] }),
        anAlert({ search: BROAD, on: '2026-05-12', adverts: [first] }),
        anAlert({ search: BROAD, on: '2026-07-21', adverts: [filler] }),
      ];
      const { workspace, tracker } = anOperatorWith(alerts);
      // When the operator merges
      const result = operatorMerges(workspace, tracker);
      // Then the row keeps the first sighting's title and the yield agrees with its Role Family cell
      expect(result.status, result.stderr).toBe(0);
      expect(jobFamiliesIn(tracker)[`linkedin:${first.id}`]).toEqual({ Job: firstTitle, 'Role Family': family });
      const blocks = yieldBlocksIn(result.stderr);
      expect(rowOf(blocks, REGIONAL)).toMatchObject({ found: 1, other: otherCount, onTarget: 1 - otherCount });
      expect(rowOf(blocks, BROAD)).toMatchObject({ found: 2, other: otherCount, onTarget: 2 - otherCount });
    });
  }

  it('@error alerts that name no search form the (no search term) row with unique shown as -, and never reduce another search\'s unique count', () => {
    // Given the cohort, where an advert one search found is also in an alert that names no search
    const { workspace, tracker } = anOperatorWith(theCohort().alerts);
    // When the operator merges
    const result = operatorMerges(workspace, tracker);
    // Then the row exists, its unique is not shown, and the broad search's unique still counts the shared advert
    expect(result.status, result.stderr).toBe(0);
    const blocks = yieldBlocksIn(result.stderr);
    expect(rowOf(blocks, UNPARSED_SEARCH_LABEL)).toEqual({ label: UNPARSED_SEARCH_LABEL, found: 2, other: 0, otherShare: 0, onTarget: 2, unique: null });
    expect(rowOf(blocks, BROAD).unique).toBe(1);
    expect(rowOf(blocks, TOTAL_ROW_LABEL).found).toBe(11);
    expect(observeTracker(tracker)['tracker.sources'].rows).toHaveLength(4);
  });

  it('@error a search name that is only blank space is no search term, and its adverts join the (no search term) row', () => {
    const [blankAdvert, namedA, namedB] = theAdverts([Role.OWNER, Role.COACH, Role.SCRUM], 801);
    const alerts = [anAlert({ search: BLANK_SEARCH, on: '2026-09-01', adverts: [blankAdvert] }), anAlert({ search: BROAD, on: '2026-09-02', adverts: [namedA] }), anAlert({ search: REGIONAL, on: '2026-09-02', adverts: [namedB] })];
    const { workspace, tracker } = anOperatorWith(alerts);
    const result = operatorMerges(workspace, tracker);
    expect(result.status, result.stderr).toBe(0);
    expect(rowOf(yieldBlocksIn(result.stderr), UNPARSED_SEARCH_LABEL)).toMatchObject({ found: 1, onTarget: 1, unique: null });
    expect(Object.keys(jobsFoundBySearch(tracker)).sort()).toEqual([BROAD, REGIONAL]);
  });
});

describe('@driving_adapter the yield says nothing when there is nothing to compare', () => {
  it('@error one named search prints nothing, until a second search joins the cache and the next merge prints both', () => {
    // Given a cache in which only one saved search, and one alert naming none, have sent adverts
    const [a, b, c, d] = theAdverts([Role.COACH, Role.SCRUM, Role.DELIVERY, Role.OWNER], 901);
    const lone = [anAlert({ search: BROAD, on: '2026-09-01', adverts: [a, b] }), anAlert({ search: BROAD, on: '2026-09-02', adverts: [c] }), anAlert({ search: NO_SEARCH, on: '2026-09-02', adverts: [b] })];
    const { workspace, tracker } = anOperatorWith(lone);
    // When the operator merges
    const first = operatorMerges(workspace, tracker);
    // Then nothing is printed, and the merge itself is as ever
    expect(first.status, first.stderr).toBe(0);
    expect(yieldHeadingsIn(first.stderr)).toEqual([]);
    expect(first.stdout).toMatch(/Jobs: rows updated: 0, rows appended: 3/);
    // When a second saved search sends an advert, and the operator merges again
    aCacheOfAlerts(workspace, [...lone, anAlert({ search: REGIONAL, on: '2026-09-03', adverts: [d] })]);
    const second = operatorMerges(workspace, tracker);
    // Then both searches are compared
    expect(second.status, second.stderr).toBe(0);
    expect(yieldHeadingsIn(second.stderr)).toEqual([ALL_TIME_HEADING]);
    expect(rowOf(yieldBlocksIn(second.stderr), BROAD)).toMatchObject({ found: 3, unique: 3 });
    expect(rowOf(yieldBlocksIn(second.stderr), REGIONAL)).toMatchObject({ found: 1, unique: 1 });
  });

  it('@error a cache whose alerts all name no search prints nothing, until two named searches arrive', () => {
    const [a, b, c, d] = theAdverts([Role.COACH, Role.SCRUM, Role.DELIVERY, Role.ANALYST], 1001);
    const unnamed = [anAlert({ search: NO_SEARCH, on: '2026-09-01', adverts: [a, b] }), anAlert({ search: NO_SEARCH, on: '2026-09-02', adverts: [c] })];
    const { workspace, tracker } = anOperatorWith(unnamed);
    const first = operatorMerges(workspace, tracker);
    expect(first.status, first.stderr).toBe(0);
    expect(yieldHeadingsIn(first.stderr)).toEqual([]);
    aCacheOfAlerts(workspace, [...unnamed, anAlert({ search: BROAD, on: '2026-09-03', adverts: [a] }), anAlert({ search: REGIONAL, on: '2026-09-03', adverts: [d] })]);
    const second = operatorMerges(workspace, tracker);
    expect(second.status, second.stderr).toBe(0);
    expect(rowOf(yieldBlocksIn(second.stderr), UNPARSED_SEARCH_LABEL)).toMatchObject({ found: 3, unique: null });
  });

  it('@error an empty cache prints no yield: the merge refuses as it always did, the preview prints no yield, and once alerts arrive both print', () => {
    // Given an operator whose cache is empty
    const workspace = aScratchWorkspace();
    const tracker = join(workspace, 'tracker.xlsx');
    anEmptyTracker(tracker);
    const before = { 'workspace.files': fileDigests(workspace) };
    // When the operator merges, and previews
    const merge = operatorMerges(workspace, tracker);
    const preview = operatorPreviews(workspace, '--merge', tracker);
    // Then the merge refuses, the preview shows no yield, and nothing was written
    expect(merge.status).not.toBe(0);
    expect(merge.stderr).toMatch(/the cache is empty/);
    expect(preview.status, preview.stderr).toBe(0);
    expect(yieldHeadingsIn(`${merge.stderr}\n${preview.stderr}`)).toEqual([]);
    assertStateDelta(before, { 'workspace.files': fileDigests(workspace) }, { universe: ['workspace.files'] });
    // When alerts arrive and the operator merges
    aCacheOfAlerts(workspace, theCohort().alerts);
    const arrived = operatorMerges(workspace, tracker);
    expect(arrived.status, arrived.stderr).toBe(0);
    expect(yieldLinesIn(arrived.stderr)).toEqual(THE_COHORT_YIELD_LINES);
  });

  it('@error a cache that fits inside 28 dates prints only the all-time block; one date more and the recent block appears', () => {
    const exactly28 = anOperatorWith(twoSearchesBetween('2026-09-03', '2026-09-30'));
    const twentyNine = anOperatorWith(twoSearchesBetween('2026-09-02', '2026-09-30'));
    const within = operatorMerges(exactly28.workspace, exactly28.tracker);
    const beyond = operatorMerges(twentyNine.workspace, twentyNine.tracker);
    expect(within.status, within.stderr).toBe(0);
    expect(beyond.status, beyond.stderr).toBe(0);
    expect(yieldHeadingsIn(within.stderr)).toEqual([ALL_TIME_HEADING]);
    expect(yieldHeadingsIn(beyond.stderr)).toEqual([ALL_TIME_HEADING, recentHeadingTo('2026-09-30')]);
  });
});

describe('@driving_adapter the recent block counts the 28 dates ending at the latest sighting date in the cache', () => {
  it('@real-io a cache spread over two months prints both blocks: the recent heading names the end date, and the figures are the window\'s', () => {
    // Given sightings from 10 August to 30 September, a search that began only on 25 September, and an advert first seen in August and resent on 20 September
    const { workspace, tracker } = anOperatorWith(theSpreadCohort().alerts);
    // When the operator merges
    const result = operatorMerges(workspace, tracker);
    // Then both blocks print, the second ending at the latest sighting date
    expect(result.status, result.stderr).toBe(0);
    expect(yieldLinesIn(result.stderr)).toEqual(THE_SPREAD_YIELD_LINES);
    const [allTime, recent] = yieldBlocksIn(result.stderr);
    expect(rowOf([recent], BROAD)).toMatchObject({ found: 2, other: 1, onTarget: 1, unique: 1 });
    expect(rowOf([allTime], BROAD)).toMatchObject({ found: 4, unique: 2 });
    expect(rowOf([allTime], Search.NEWCOMER).found).toBe(rowOf([recent], Search.NEWCOMER).found);
  });

  it('@error the window ends at the latest sighting date, not at the clock: the same cache merged on two different days prints the same lines', () => {
    // Given two identical operators with the same cache
    const today = anOperatorWith(theSpreadCohort().alerts);
    const yearsLater = anOperatorWith(theSpreadCohort().alerts);
    // When one merges with the clock stopped in October 2026 and the other in March 2031
    const first = operatorMergesOnAnotherDay(today.workspace, today.tracker, '2026-10-05T12:00:00Z');
    const second = operatorMergesOnAnotherDay(yearsLater.workspace, yearsLater.tracker, '2031-03-01T08:00:00Z');
    // Then both print the lines the cache gives
    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    expect(yieldLinesIn(first.stderr)).toEqual(THE_SPREAD_YIELD_LINES);
    expect(yieldLinesIn(second.stderr)).toEqual(yieldLinesIn(first.stderr));
  });

  it('@error a stale cache shows its own end date, so an old cache is visibly old', () => {
    const [a, b, c, d] = theAdverts([Role.COACH, Role.SCRUM, Role.DELIVERY, Role.OWNER], 1101);
    const alerts = [
      anAlert({ search: BROAD, on: '2025-11-01', adverts: [a] }),
      anAlert({ search: REGIONAL, on: '2025-11-02', adverts: [b] }),
      anAlert({ search: BROAD, on: '2026-01-10', adverts: [c] }),
      anAlert({ search: REGIONAL, on: '2026-01-12', adverts: [d] }),
    ];
    const { workspace, tracker } = anOperatorWith(alerts);
    const result = operatorMerges(workspace, tracker);
    expect(result.status, result.stderr).toBe(0);
    expect(yieldHeadingsIn(result.stderr)).toEqual([ALL_TIME_HEADING, recentHeadingTo('2026-01-12')]);
  });
});

describe('@driving_adapter long labels and many searches keep stderr bounded', () => {
  it('@error a label over 40 characters is cut to 37 plus ..., a label of exactly 40 is printed whole, and the lines are the DESIGN\'s', () => {
    const [a, b, c] = theAdverts([Role.COACH, Role.SCRUM, Role.DELIVERY], 1201);
    const alerts = [anAlert({ search: LONG_SEARCH, on: '2026-09-01', adverts: [a] }), anAlert({ search: FORTY_CHARACTER_SEARCH, on: '2026-09-01', adverts: [b] }), anAlert({ search: BROAD, on: '2026-09-02', adverts: [c] })];
    const { workspace, tracker } = anOperatorWith(alerts);
    const result = operatorMerges(workspace, tracker);
    expect(result.status, result.stderr).toBe(0);
    const blocks = yieldBlocksIn(result.stderr);
    expect(rowOf(blocks, LONG_SEARCH_AS_SHOWN)).toMatchObject({ found: 1 });
    expect(rowOf(blocks, FORTY_CHARACTER_SEARCH)).toMatchObject({ found: 1 });
    expect(result.stderr).not.toContain(LONG_SEARCH);
    expect(yieldLinesIn(result.stderr)).toEqual(expectedStderrFor(sightingsOf(alerts)));
  });

  it('@error twenty-three saved searches print twenty rows and "... and 3 more search(es) not shown", the total still counts every advert, and the tracker still lists all twenty-three', () => {
    const { workspace, tracker } = anOperatorWith(manySearches(23));
    const result = operatorMerges(workspace, tracker);
    expect(result.status, result.stderr).toBe(0);
    const [block] = yieldBlocksIn(result.stderr);
    expect(block, 'a yield block was printed').toBeDefined();
    expect(block.rows.filter(({ label }) => label.startsWith('search '))).toHaveLength(20);
    expect(block.more).toBe(3);
    expect(rowOf([block], TOTAL_ROW_LABEL)).toMatchObject({ found: 2, other: 1, onTarget: 1 });
    expect(result.stderr).toContain('  ... and 3 more search(es) not shown');
    expect(observeTracker(tracker)['tracker.sources'].rows).toHaveLength(23);
  });

  it('@error exactly twenty saved searches print every row and no "more not shown" line', () => {
    const { workspace, tracker } = anOperatorWith(manySearches(20));
    const result = operatorMerges(workspace, tracker);
    expect(result.status, result.stderr).toBe(0);
    const [block] = yieldBlocksIn(result.stderr);
    expect(block, 'a yield block was printed').toBeDefined();
    expect(block.rows.filter(({ label }) => label.startsWith('search '))).toHaveLength(20);
    expect(block.more).toBeNull();
    expect(stderrWithoutYield(result.stderr).join('\n')).not.toMatch(/more search\(es\)/);
  });
});
