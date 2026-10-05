// Test infrastructure for search-yield-summary: not a scenario, and unskipped. It proves the builders hand the scenarios
// what they claim (so a scenario cannot fail, or pass, because of a fixture): synthetic alerts read back through the real
// parser, the cohort figures by hand against an oracle that shares no code with src/, the vocabulary's families against the
// production classifier, trackers that match the cache, and the clock that makes "another day" reproducible.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import fc from 'fast-check';
import { withLoopbackFake } from '../sheets-api-target/support/sheets-fake.mjs';
import { classifyRoleFamily } from '../../../src/core/role-families.mjs';
import { extractJobs } from '../../../src/core/parse-linkedin.mjs';
import { harvest } from '../../../src/core/harvest.mjs';
import {
  ALL_TIME_HEADING,
  THE_COHORT_YIELD_LINES,
  THE_SPREAD_YIELD_LINES,
  BLANK_SEARCH,
  FORTY_CHARACTER_SEARCH,
  FORTY_ONE_CHARACTER_SEARCH,
  LONG_SEARCH,
  LONG_SEARCH_AS_SHOWN,
  NO_SEARCH,
  ON_TARGET_TITLES,
  OTHER_TITLES,
  Role,
  Search,
  SHEET_UNIVERSE,
  TOTAL_ROW_LABEL,
  UNIQUE_NOT_SHOWN,
  UNPARSED_SEARCH_LABEL,
  YIELD_LABEL_WIDTH,
  YIELD_NAMED_SEARCH_LIMIT,
  YIELD_WINDOW_DAYS,
  aCacheOfAlerts,
  aScratchWorkspace,
  aSheetHoldingTheCache,
  aTrackerHoldingTheCache,
  anAlert,
  anEmptyHome,
  anEmptyTracker,
  expectedSearchYield,
  expectedStderrFor,
  manySearches,
  messagesOf,
  numberedSearch,
  observeSheet,
  observeTracker,
  operatorBuildsIntoTheSheet,
  operatorMerges,
  operatorMergesOnAnotherDay,
  parsedRowsOf,
  sightingsOf,
  summaryInputsOf,
  theAdverts,
  theCohort,
  theDataBatch,
  theHarvestOf,
  theSpreadCohort,
  useWorkspaceCleanup,
  yieldBlocksIn,
  yieldLinesIn,
  fileDigests,
  recentHeadingTo,
} from './support/search-yield-domain-types.mjs';
import { alertPlanArb, compactSightingsArb, crowdedSightingsArb, sightingsArb } from './support/yield-generators.mjs';
import { COLUMN_HEADER_LINE, ORACLE_LABEL_WIDTH, ORACLE_NAMED_LIMIT, ORACLE_NO_UNIQUE, ORACLE_TOTAL_LABEL, ORACLE_UNPARSED_LABEL, ORACLE_WINDOW_DAYS, labelOf, percentOf } from './support/yield-oracle.mjs';

useWorkspaceCleanup();

const COHORT_LINES = THE_COHORT_YIELD_LINES;

describe('the vocabulary and the oracle', () => {
  it('names the families the production classifier gives: on-target titles are never other, other titles always are', () => {
    expect(ON_TARGET_TITLES.filter((title) => classifyRoleFamily(title) === 'other')).toEqual([]);
    expect(OTHER_TITLES.filter((title) => classifyRoleFamily(title) !== 'other')).toEqual([]);
  });

  it('keeps its constants equal to the production constants, so a renamed value is a recorded decision', () => {
    expect([ORACLE_WINDOW_DAYS, ORACLE_NAMED_LIMIT, ORACLE_LABEL_WIDTH]).toEqual([YIELD_WINDOW_DAYS, YIELD_NAMED_SEARCH_LIMIT, YIELD_LABEL_WIDTH]);
    expect([ORACLE_UNPARSED_LABEL, ORACLE_TOTAL_LABEL, ORACLE_NO_UNIQUE]).toEqual([UNPARSED_SEARCH_LABEL, TOTAL_ROW_LABEL, UNIQUE_NOT_SHOWN]);
    expect(YIELD_LABEL_WIDTH).toBe(40);
  });

  it('gives the figures worked out by hand for the cohort, and the exact lines the DESIGN rule prints for them', () => {
    const blocks = expectedSearchYield(sightingsOf(theCohort().alerts));
    expect(blocks.recent).toBeNull();
    expect(blocks.allTime.searches.map(({ search, found, other, onTarget, unique }) => [search, found, other, onTarget, unique])).toEqual([
      ['agile coach in Examplestan', 6, 1, 5, 1],
      ['engineering manager in Examplestan', 5, 3, 2, 1],
      ['scrum master in Exampleshire', 5, 2, 3, 1],
      ['agile coach (remote) in Examplestan', 2, 0, 2, 0],
    ]);
    expect([blocks.allTime.unparsed, blocks.allTime.total]).toEqual([{ found: 2, other: 0, onTarget: 2 }, { found: 11, other: 3, onTarget: 8 }]);
    expect(expectedStderrFor(sightingsOf(theCohort().alerts))).toEqual(COHORT_LINES);
  });

  it('gives the figures worked out by hand for the spread cohort in both scopes', () => {
    const { allTime, recent } = expectedSearchYield(sightingsOf(theSpreadCohort().alerts));
    expect(allTime.searches.map(({ search, found, other, onTarget, unique }) => [search, found, other, onTarget, unique])).toEqual([
      [Search.BROAD, 4, 1, 3, 2],
      [Search.REGIONAL, 4, 1, 3, 2],
      [Search.NEWCOMER, 1, 0, 1, 1],
    ]);
    expect(allTime.total).toEqual({ found: 8, other: 2, onTarget: 6 });
    expect(recent.endDate).toBe('2026-09-30');
    expect(recent.searches.map(({ search, found, other, onTarget, unique }) => [search, found, other, onTarget, unique])).toEqual([
      [Search.REGIONAL, 3, 0, 3, 3],
      [Search.BROAD, 2, 1, 1, 1],
      [Search.NEWCOMER, 1, 0, 1, 1],
    ]);
    expect(recent.total).toEqual({ found: 6, other: 1, onTarget: 5 });
    expect(expectedStderrFor(sightingsOf(theSpreadCohort().alerts))).toEqual(THE_SPREAD_YIELD_LINES);
    expect(THE_SPREAD_YIELD_LINES.filter((line) => line.startsWith('harvest build:'))).toEqual([ALL_TIME_HEADING, recentHeadingTo('2026-09-30')]);
  });

  it('rounds half up, cuts a 41-character label to 37 plus ..., and leaves a 40-character label whole', () => {
    expect([percentOf(1, 8), percentOf(3, 8), percentOf(1, 3), percentOf(2, 3), percentOf(0, 5), percentOf(7, 7)]).toEqual([13, 38, 33, 67, 0, 100]);
    expect(FORTY_CHARACTER_SEARCH).toHaveLength(40);
    expect(FORTY_ONE_CHARACTER_SEARCH).toHaveLength(41);
    expect(labelOf(FORTY_CHARACTER_SEARCH)).toBe(FORTY_CHARACTER_SEARCH);
    expect(labelOf(FORTY_ONE_CHARACTER_SEARCH)).toBe(`${FORTY_ONE_CHARACTER_SEARCH.slice(0, 37)}...`);
    expect(labelOf(FORTY_ONE_CHARACTER_SEARCH)).toHaveLength(40);
    expect(labelOf(LONG_SEARCH)).toBe(LONG_SEARCH_AS_SHOWN);
  });

  it('prints at most twenty named searches and says how many more there are, keeping the total row last', () => {
    const lines = expectedStderrFor(sightingsOf(manySearches(23)));
    expect(lines.filter((line) => /^ {2}search \d\d in Examplestan/.test(line))).toHaveLength(20);
    expect(lines).toContain('  ... and 3 more search(es) not shown');
    expect(lines.at(-1)).toMatch(/^ {2}all searches\s+2\s+1 \(50%\)\s+1\s+-$/);
  });

  it('reads its own rendering back: the figures an observer takes from a printed block equal the oracle\'s', () => {
    const [block] = yieldBlocksIn(`harvest build: no derived corrections\n${COHORT_LINES.join('\n')}\n`);
    expect(block.heading).toBe(ALL_TIME_HEADING);
    expect(block.rows.map(({ label, found, other, otherShare, onTarget, unique }) => [label, found, other, otherShare, onTarget, unique])).toEqual([
      ['agile coach in Examplestan', 6, 1, 17, 5, 1],
      ['engineering manager in Examplestan', 5, 3, 60, 2, 1],
      ['scrum master in Exampleshire', 5, 2, 40, 3, 1],
      ['agile coach (remote) in Examplestan', 2, 0, 0, 2, 0],
      [UNPARSED_SEARCH_LABEL, 2, 0, 0, 2, null],
      [TOTAL_ROW_LABEL, 11, 3, 27, 8, null],
    ]);
    expect(yieldLinesIn('harvest build: no derived corrections\n  3  data analyst\n')).toEqual([]);
    expect(COLUMN_HEADER_LINE).toBe(COHORT_LINES[1]);
  });
});

describe('the alert builders', () => {
  it('cache the cohort so that the real parser reads every sighting back: the term, the advert and the day', () => {
    const { alerts } = theCohort();
    const rows = parsedRowsOf(alerts);
    expect(rows).toHaveLength(sightingsOf(alerts).length);
    expect(rows.map(({ searchTerm, dedupKey }) => [searchTerm, dedupKey.replace('linkedin:', '')])).toEqual(sightingsOf(alerts).map(({ search, id }) => [search, id]));
    expect(rows.map(({ seenAt }) => seenAt)).toEqual(sightingsOf(alerts).map(({ at }) => at));
    expect(new Set(rows.map(({ seenAt }) => seenAt)).size).toBe(alerts.length);
  });

  it('hand the parser an alert naming no search as a null term, a blank search as an empty term, and still yield its adverts', () => {
    const [advert] = theAdverts([Role.SCRUM]);
    const [none, blank] = messagesOf([anAlert({ search: NO_SEARCH, on: '2026-09-01', adverts: [advert] }), anAlert({ search: BLANK_SEARCH, on: '2026-09-01', adverts: [advert] })]);
    expect(extractJobs(none).map(({ searchTerm, title }) => [searchTerm, title])).toEqual([[null, Role.SCRUM]]);
    expect(extractJobs(blank).map(({ searchTerm, title }) => [searchTerm, title])).toEqual([['', Role.SCRUM]]);
  });

  it('give every alert a distinct arrival time, in plan order, so the first sighting of an advert is never a tie', () => {
    const alerts = manySearches(70);
    const times = messagesOf(alerts).map(({ date }) => date);
    expect(new Set(times).size).toBe(70);
    expect([...times].sort()).toEqual(times);
  });

  it('write the plan where the harvest reads it, and the harvest derives eleven adverts and the Sources figures the DESIGN reconciles to', () => {
    const workspace = aScratchWorkspace();
    aCacheOfAlerts(workspace, theCohort().alerts);
    const model = theHarvestOf(workspace);
    expect(model.jobs.rows).toHaveLength(11);
    expect(Object.fromEntries(model.sources.rows.map((row) => [row['Search Term'], row['Jobs Found']]))).toEqual({
      [Search.BROAD]: 6,
      [Search.NOISY]: 5,
      [Search.REGIONAL]: 5,
      [Search.REDUNDANT]: 2,
    });
    expect(model.jobs.rows.filter((row) => row['Role Family'] === 'other')).toHaveLength(3);
  });

  it('hand the pure summary the rows the real parser gives, with the collapsed adverts titled by their first sighting', () => {
    const { alerts } = theCohort();
    const { sightings, adverts } = summaryInputsOf(sightingsOf(alerts));
    expect(adverts).toHaveLength(11);
    expect(sightings.every(({ searchTerm, dedupKey, seenAt, title }) => (searchTerm === null || typeof searchTerm === 'string') && dedupKey.startsWith('linkedin:') && seenAt.length > 0 && title.length > 0)).toBe(true);
    expect(new Set(adverts.map(({ dedupKey }) => dedupKey))).toEqual(new Set(harvest(messagesOf(alerts)).jobs.rows.map((row) => row['Dedup Key'])));
  });

  it('build numbered searches whose names sort in number order, all under the column width', () => {
    const names = [1, 2, 9, 10, 23].map(numberedSearch);
    expect([...names].sort()).toEqual(names);
    expect(names.every((name) => name.length <= 40)).toBe(true);
  });
});

describe('the trackers and the runners', () => {
  it('shape a tracker that matches what the harvest derives, so a merge into it changes no cell', () => {
    const workspace = aScratchWorkspace();
    aCacheOfAlerts(workspace, theCohort().alerts);
    const tracker = join(workspace, 'tracker.xlsx');
    aTrackerHoldingTheCache(tracker, workspace);
    const result = operatorMerges(workspace, tracker);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Jobs: rows updated: 11, rows appended: 0, columns appended: 0, cell changes: 0/);
    expect(result.stdout).toMatch(/Sources: rows updated: 4, rows appended: 0, columns appended: 0, cell changes: 0/);
    expect(result.stdout).toMatch(/Companies: rows updated: \d+, rows appended: 0, columns appended: 0, cell changes: 0/);
  });

  it('shape a tracker that holds only headers, so a merge appends every advert', () => {
    const workspace = aScratchWorkspace();
    aCacheOfAlerts(workspace, theCohort().alerts);
    const tracker = join(workspace, 'tracker.xlsx');
    anEmptyTracker(tracker);
    const result = operatorMerges(workspace, tracker);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Jobs: rows updated: 0, rows appended: 11/);
    expect(observeTracker(tracker)['tracker.jobs'].rows).toHaveLength(11);
  });

  it('shape a Sheet that matches what the harvest derives, so a build into it sends no data batch', async () => {
    const workspace = aScratchWorkspace();
    aCacheOfAlerts(workspace, theCohort().alerts);
    const fake = aSheetHoldingTheCache(workspace);
    const before = observeSheet(fake);
    const result = await withLoopbackFake(fake, (baseUrl) => operatorBuildsIntoTheSheet(workspace, baseUrl));
    expect(result.status, result.stderr).toBe(0);
    expect(theDataBatch(fake)).toBeNull();
    expect(observeSheet(fake)).toEqual(before);
    expect(Object.keys(before)).toEqual(SHEET_UNIVERSE);
  });

  it('run the real command with an empty HOME and no credential, and stop the clock when asked', () => {
    const workspace = aScratchWorkspace();
    aCacheOfAlerts(workspace, theCohort().alerts);
    const tracker = join(workspace, 'tracker.xlsx');
    anEmptyTracker(tracker);
    const result = operatorMergesOnAnotherDay(workspace, tracker, '2031-01-02T03:04:05Z');
    expect(result.status, result.stderr).toBe(0);
    expect(anEmptyHome()).not.toBe(anEmptyHome());
    const probe = spawnSync(process.execPath, ['--import', new URL('./support/fixed-clock.mjs', import.meta.url).href, '-e', 'console.log(new Date().toISOString(), Date.now(), new Date(0).getTime())'], { encoding: 'utf8', env: { ...process.env, FIXED_CLOCK_ISO: '2031-01-02T03:04:05Z' } });
    expect(probe.stdout.trim()).toBe(`2031-01-02T03:04:05.000Z ${Date.parse('2031-01-02T03:04:05Z')} 0`);
  });

  it('read a workspace as digests, so a preview that writes nothing can be proved byte-identical', () => {
    const workspace = aScratchWorkspace();
    aCacheOfAlerts(workspace, theCohort().alerts);
    expect(Object.keys(fileDigests(workspace)).length).toBe(6);
  });
});

describe('the generators', () => {
  const share = (samples, test) => samples.filter(test).length / samples.length;

  it('reach the interesting cases: two or more named searches, a recent block, more than twenty searches, retitled adverts', () => {
    const spread = fc.sample(sightingsArb, { numRuns: 300, seed: 7 }).map((sightings) => expectedSearchYield(sightings));
    expect(share(spread, ({ allTime }) => allTime !== null)).toBeGreaterThan(0.5);
    expect(share(spread, ({ recent }) => recent !== null)).toBeGreaterThan(0.15);
    expect(share(fc.sample(compactSightingsArb, { numRuns: 300, seed: 7 }).map((s) => expectedSearchYield(s)), ({ allTime, recent }) => allTime !== null && recent === null)).toBeGreaterThan(0.4);
    const crowded = fc.sample(crowdedSightingsArb, { numRuns: 200, seed: 7 }).map((sightings) => expectedSearchYield(sightings));
    expect(share(crowded, ({ allTime }) => allTime !== null && allTime.searches.length > 20)).toBeGreaterThan(0.05);
    const plans = fc.sample(alertPlanArb, { numRuns: 300, seed: 7 });
    const retitled = (alerts) => {
      const titles = new Map();
      return alerts.flatMap(({ adverts }) => adverts).some(({ id, title }) => (titles.has(id) && titles.get(id) !== title) || (titles.set(id, title), false));
    };
    expect(share(plans, retitled)).toBeGreaterThan(0.15);
    expect(share(plans, (alerts) => alerts.some(({ search }) => search === NO_SEARCH))).toBeGreaterThan(0.3);
  });
});
