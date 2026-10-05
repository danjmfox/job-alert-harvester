// @contract-shape:pure-function
// The pure core of search-yield-summary (DR-0015), exercised in memory (layers 1 and 2: no subprocess, no file). The
// summary takes the sightings and the collapsed adverts and returns `{ allTime, recent }` blocks; the formatter turns
// blocks into stderr lines; `harvest()` carries the summary as `searchYield`. Every figure is stated by hand or by an
// oracle that restates the DESIGN independently of src/ (support/yield-oracle.mjs). The properties live in
// search-yield-properties.test.mjs; the same behaviour through the real CLI lives in the two build files.
import { afterEach, describe, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { harvest } from '../../../src/core/harvest.mjs';
import { OPTION_TABLES } from '../../../src/core/cli-options.mjs';
import { formatSearchYield, summariseSearchYield } from '../../../src/core/search-yield.mjs';
import {
  ALL_TIME_HEADING,
  FORTY_CHARACTER_SEARCH,
  FORTY_ONE_CHARACTER_SEARCH,
  NO_SEARCH,
  Role,
  Search,
  TOTAL_ROW_LABEL,
  UNPARSED_SEARCH_LABEL,
  YIELD_LABEL_WIDTH,
  YIELD_NAMED_SEARCH_LIMIT,
  YIELD_WINDOW_DAYS,
  UNIQUE_NOT_SHOWN,
  expectedSearchYield,
  expectedStderrFor,
  manySearches,
  messagesOf,
  recentHeadingTo,
  rowOf,
  sightingsOf,
  summaryInputsOf,
  theAdverts,
  theCohort,
  theSpreadCohort,
  yieldBlocksIn,
} from './support/search-yield-domain-types.mjs';
import { scenario } from './support/red-gate.mjs';

const at = (day, time = '09:00') => `${day}T${time}:00Z`;
/** One sighting: the search that sent the advert (null: none), the advert, the day and the minute. */
const sighting = (search, advert, day, time = '09:00') => ({ search, id: advert.id, title: advert.title, at: at(day, time) });
const summarise = (sightings) => {
  const { sightings: rows, adverts } = summaryInputsOf(sightings);
  return summariseSearchYield(rows, adverts);
};
const figuresOf = (block) => block.searches.map(({ search, found, other, onTarget, unique }) => [search, found, other, onTarget, unique]);
const linesOf = (sightings) => formatSearchYield(summarise(sightings));
const deepFreeze = (value) => {
  if (value !== null && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

afterEach(() => vi.useRealTimers());

const [coach1, coach2, scrum1, scrum2, delivery1, analyst1, developer1] = theAdverts([Role.COACH, Role.COACH, Role.SCRUM, Role.SCRUM, Role.DELIVERY, Role.ANALYST, Role.DEVELOPER], 1);
const { BROAD, REGIONAL, NOISY, NEWCOMER } = Search;

describe('@pure the summary counts distinct adverts per saved search, over every cached alert', () => {
  scenario('the cohort gives each search its found, other, on-target and unique figures, ordered by found then search, with the unparsed row and the total', () => {
    // Given eleven adverts found by four overlapping searches, and one alert that names no search
    const blocks = summarise(sightingsOf(theCohort().alerts));
    // Then the all-time block lists the searches by found descending, ties by search ascending
    expect(blocks.recent).toBeNull();
    expect(blocks.allTime.scope).toBe('all');
    expect(figuresOf(blocks.allTime)).toEqual([
      [BROAD, 6, 1, 5, 1],
      [NOISY, 5, 3, 2, 1],
      [REGIONAL, 5, 2, 3, 1],
      [Search.REDUNDANT, 2, 0, 2, 0],
    ]);
    // And the unparsed adverts and the distinct total are counted beside them
    expect(blocks.allTime.unparsed).toEqual({ found: 2, other: 0, onTarget: 2 });
    expect(blocks.allTime.total).toEqual({ found: 11, other: 3, onTarget: 8 });
  });

  scenario('@error an advert found by two searches counts under both for found and on-target, and under neither for unique', () => {
    const blocks = summarise([sighting(BROAD, coach1, '2026-09-01'), sighting(REGIONAL, coach1, '2026-09-02', '09:05'), sighting(BROAD, scrum1, '2026-09-01', '09:10')]);
    expect(figuresOf(blocks.allTime)).toEqual([
      [BROAD, 2, 0, 2, 1],
      [REGIONAL, 1, 0, 1, 0],
    ]);
    expect(blocks.allTime.total).toEqual({ found: 2, other: 0, onTarget: 2 });
  });

  scenario('@error an advert resent by the same search again and again counts once', () => {
    const resent = Array.from({ length: 9 }, (_, index) => sighting(BROAD, coach1, `2026-09-0${index + 1}`));
    const blocks = summarise([...resent, sighting(REGIONAL, scrum1, '2026-09-02', '10:00')]);
    expect(figuresOf(blocks.allTime)).toEqual([
      [BROAD, 1, 0, 1, 1],
      [REGIONAL, 1, 0, 1, 1],
    ]);
  });

  scenario('@error a repost under a new advert id is a second advert, counted twice', () => {
    const blocks = summarise([sighting(BROAD, coach1, '2026-09-01'), sighting(BROAD, coach2, '2026-09-02'), sighting(REGIONAL, scrum1, '2026-09-03')]);
    expect(figuresOf(blocks.allTime)[0]).toEqual([BROAD, 2, 0, 2, 2]);
    expect(blocks.allTime.total.found).toBe(3);
  });

  scenario('@error the family counted is the first sighting\'s title, whatever a later sighting is called, and it holds under every search that found the advert', () => {
    // Given one advert first sighted as a Scrum Master by one search, then retitled when another search sent it
    const retitled = { ...scrum1, title: Role.ANALYST };
    const sightings = [sighting(BROAD, scrum1, '2026-09-01'), sighting(REGIONAL, retitled, '2026-09-05'), sighting(REGIONAL, delivery1, '2026-09-05', '09:30')];
    const { sightings: rows } = summaryInputsOf(sightings);
    const blocks = summariseSearchYield(rows, [{ dedupKey: rows[0].dedupKey, title: Role.SCRUM }, { dedupKey: rows[2].dedupKey, title: Role.DELIVERY }]);
    // Then it is on-target under both searches: the later title was never read
    expect(figuresOf(blocks.allTime)).toEqual([
      [REGIONAL, 2, 0, 2, 1],
      [BROAD, 1, 0, 1, 0],
    ]);
  });

  scenario('@error an advert first sighted as other stays other under every search, even when a later sighting is titled as a family', () => {
    const retitled = { ...analyst1, title: Role.SCRUM };
    const sightings = [sighting(BROAD, analyst1, '2026-09-01'), sighting(REGIONAL, retitled, '2026-09-05')];
    const { sightings: rows } = summaryInputsOf(sightings);
    const blocks = summariseSearchYield(rows, [{ dedupKey: rows[0].dedupKey, title: Role.ANALYST }]);
    expect(figuresOf(blocks.allTime)).toEqual([
      [BROAD, 1, 1, 0, 0],
      [REGIONAL, 1, 1, 0, 0],
    ]);
  });

  scenario('@error the total counts distinct adverts, not the sum of the searches that found them', () => {
    const { total } = summarise(sightingsOf(theCohort().alerts)).allTime;
    expect(total.found).toBe(11);
    expect(6 + 5 + 5 + 2).toBeGreaterThan(total.found);
  });

  scenario('@error the unparsed bucket is a row of its own, never a rival search: an advert found by one search and an unparsed alert is still unique to that search', () => {
    const blocks = summarise([sighting(BROAD, coach1, '2026-09-01'), sighting(NO_SEARCH, coach1, '2026-09-02', '09:05'), sighting(REGIONAL, scrum1, '2026-09-03'), sighting(NO_SEARCH, delivery1, '2026-09-04')]);
    expect(figuresOf(blocks.allTime)).toEqual([
      [BROAD, 1, 0, 1, 1],
      [REGIONAL, 1, 0, 1, 1],
    ]);
    expect(blocks.allTime.unparsed).toEqual({ found: 2, other: 0, onTarget: 2 });
    expect(blocks.allTime.total.found).toBe(3);
  });

  scenario('@error a search name that is empty counts as no search term, the same as a missing one', () => {
    const blocks = summarise([sighting(BROAD, coach1, '2026-09-01'), sighting(REGIONAL, scrum1, '2026-09-02'), sighting('', delivery1, '2026-09-03'), sighting(NO_SEARCH, analyst1, '2026-09-04')]);
    expect(blocks.allTime.unparsed).toEqual({ found: 2, other: 1, onTarget: 1 });
    expect(blocks.allTime.searches.map(({ search }) => search)).toEqual([BROAD, REGIONAL]);
  });

  scenario('@error a block needs two named searches: one named search, or none, gives no block', () => {
    const one = summarise([sighting(BROAD, coach1, '2026-09-01'), sighting(BROAD, coach2, '2026-09-02'), sighting(NO_SEARCH, scrum1, '2026-09-03')]);
    const two = summarise([sighting(BROAD, coach1, '2026-09-01'), sighting(REGIONAL, coach2, '2026-09-02')]);
    const none = summarise([sighting(NO_SEARCH, coach1, '2026-09-01'), sighting(NO_SEARCH, coach2, '2026-09-02')]);
    expect(one).toEqual({ allTime: null, recent: null });
    expect(none).toEqual({ allTime: null, recent: null });
    expect(two.allTime.searches).toHaveLength(2);
  });

  scenario('@error an empty cache gives no block at all, and does not throw', () => {
    expect(summariseSearchYield([], [])).toEqual({ allTime: null, recent: null });
  });

  scenario('@error it never changes the sightings or the adverts it is handed', () => {
    const { sightings, adverts } = summaryInputsOf(sightingsOf(theSpreadCohort().alerts));
    deepFreeze(sightings);
    deepFreeze(adverts);
    expect(() => summariseSearchYield(sightings, adverts)).not.toThrow();
    expect(summariseSearchYield(sightings, adverts)).toEqual(summariseSearchYield(sightings, adverts));
  });
});

describe('@pure the recent block counts the 28 calendar dates that end at the latest sighting date', () => {
  scenario('the spread cohort gives a recent block ending at its latest sighting date, with figures that differ from all-time', () => {
    const { allTime, recent } = summarise(sightingsOf(theSpreadCohort().alerts));
    expect(figuresOf(allTime)).toEqual([
      [BROAD, 4, 1, 3, 2],
      [REGIONAL, 4, 1, 3, 2],
      [NEWCOMER, 1, 0, 1, 1],
    ]);
    expect(recent.scope).toBe('recent');
    expect(recent.endDate).toBe('2026-09-30');
    expect(figuresOf(recent)).toEqual([
      [REGIONAL, 3, 0, 3, 3],
      [BROAD, 2, 1, 1, 1],
      [NEWCOMER, 1, 0, 1, 1],
    ]);
    expect(recent.total).toEqual({ found: 6, other: 1, onTarget: 5 });
  });

  scenario('@error the window is inclusive at both ends: the 27th day before the latest counts, the 28th does not', () => {
    // Given the latest sighting on 30 September, one on 3 September (27 days before) and one on 2 September (28 days before)
    const sightings = [
      sighting(BROAD, coach1, '2026-09-30'),
      sighting(REGIONAL, scrum1, '2026-09-30', '09:05'),
      sighting(BROAD, delivery1, '2026-09-03'),
      sighting(REGIONAL, scrum2, '2026-09-02'),
    ];
    const { allTime, recent } = summarise(sightings);
    // Then the 3 September advert is in the recent block and the 2 September advert is not
    expect(figuresOf(recent)).toEqual([
      [BROAD, 2, 0, 2, 2],
      [REGIONAL, 1, 0, 1, 1],
    ]);
    expect(recent.total.found).toBe(3);
    expect(allTime.total.found).toBe(4);
  });

  scenario('@error a cache that fits inside the window prints no recent block: exactly 28 dates fit, 29 do not', () => {
    const spanning = (earliest) => [sighting(BROAD, coach1, earliest), sighting(REGIONAL, scrum1, earliest, '09:05'), sighting(BROAD, delivery1, '2026-09-30'), sighting(REGIONAL, scrum2, '2026-09-30', '09:05')];
    expect(summarise(spanning('2026-09-03')).recent).toBeNull();
    expect(summarise(spanning('2026-09-02')).recent).not.toBeNull();
    expect(summarise(spanning('2026-09-03')).allTime).not.toBeNull();
  });

  scenario('@error the window ends at the latest sighting date, not at the clock: the same cache gives the same blocks on any day it is read', () => {
    const sightings = sightingsOf(theSpreadCohort().alerts);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
    const readToday = summarise(sightings);
    vi.setSystemTime(new Date('2031-03-01T00:00:00Z'));
    const readYearsLater = summarise(sightings);
    expect(readYearsLater).toEqual(readToday);
    expect(readToday.recent.endDate).toBe('2026-09-30');
  });

  scenario('@error a recent window holding fewer than two named searches gives no recent block, though all-time has several', () => {
    const sightings = [sighting(BROAD, coach1, '2026-08-01'), sighting(REGIONAL, scrum1, '2026-08-02'), sighting(BROAD, delivery1, '2026-09-30')];
    const { allTime, recent } = summarise(sightings);
    expect(allTime.searches).toHaveLength(2);
    expect(recent).toBeNull();
  });

  scenario('@error unique is counted inside the scope: an advert two searches found, one of them before the window, is unique to the later search in the recent block only', () => {
    const sightings = [
      sighting(BROAD, delivery1, '2026-08-01'),
      sighting(REGIONAL, delivery1, '2026-09-30'),
      sighting(BROAD, coach1, '2026-09-30', '09:05'),
    ];
    const { allTime, recent } = summarise(sightings);
    expect(figuresOf(allTime)).toEqual([
      [BROAD, 2, 0, 2, 1],
      [REGIONAL, 1, 0, 1, 0],
    ]);
    expect(figuresOf(recent)).toEqual([
      [BROAD, 1, 0, 1, 1],
      [REGIONAL, 1, 0, 1, 1],
    ]);
  });

  scenario('@error an advert first seen long ago and resent in the window counts under the resending search, with its original family', () => {
    const resentLater = { ...scrum1, title: Role.ANALYST };
    const sightings = [sighting(BROAD, scrum1, '2026-07-01'), sighting(REGIONAL, resentLater, '2026-09-30'), sighting(BROAD, coach1, '2026-09-30', '09:05')];
    const { sightings: rows } = summaryInputsOf(sightings);
    const { recent } = summariseSearchYield(rows, [{ dedupKey: rows[0].dedupKey, title: Role.SCRUM }, { dedupKey: rows[2].dedupKey, title: Role.COACH }]);
    expect(figuresOf(recent)).toEqual([
      [BROAD, 1, 0, 1, 1],
      [REGIONAL, 1, 0, 1, 1],
    ]);
  });

  scenario('@error a search that appears only inside the window has the same found in both blocks', () => {
    const { allTime, recent } = summarise(sightingsOf(theSpreadCohort().alerts));
    const found = (block) => block.searches.find(({ search }) => search === NEWCOMER).found;
    expect(found(allTime)).toBe(found(recent));
  });

  scenario('@error a sighting whose date cannot be read is counted all-time, is outside the window, and never throws', () => {
    const sightings = [
      sighting(BROAD, coach1, '2026-09-30'),
      sighting(REGIONAL, scrum1, '2026-09-30', '09:05'),
      sighting(BROAD, delivery1, '2026-08-01'),
      { ...sighting(BROAD, coach2, '2026-09-01'), at: 'not a date' },
      { ...sighting(REGIONAL, scrum2, '2026-09-01'), at: '' },
    ];
    const blocks = summarise(sightings);
    expect(blocks.allTime.total.found).toBe(5);
    expect(blocks.recent.total.found).toBe(2);
  });

  scenario('@error the unparsed row is counted in a scope too, and omitted from the recent block when no sighting there lacks a term', () => {
    const sightings = [
      sighting(NO_SEARCH, coach2, '2026-07-01'),
      sighting(BROAD, coach1, '2026-09-30'),
      sighting(REGIONAL, scrum1, '2026-09-30', '09:05'),
    ];
    const { allTime, recent } = summarise(sightings);
    expect(allTime.unparsed).toEqual({ found: 1, other: 0, onTarget: 1 });
    expect(recent.unparsed).toBeNull();
  });
});

describe('@pure the summary agrees with the DESIGN oracle, and harvest carries it beside the three tabs', () => {
  scenario('@error the cohort and the spread cohort equal what the oracle restates from the DESIGN', () => {
    for (const { alerts } of [theCohort(), theSpreadCohort()]) expect(summarise(sightingsOf(alerts))).toEqual(expectedSearchYield(sightingsOf(alerts)));
  });

  scenario('@driving_port harvest() returns searchYield as a fourth key beside sources, companies and jobs, and the tabs keep their columns', () => {
    const model = harvest(messagesOf(theCohort().alerts));
    expect(Object.keys(model).sort()).toEqual(['companies', 'jobs', 'searchYield', 'sources']);
    expect(model.jobs.rows).toHaveLength(11);
    expect(model.searchYield).toEqual(expectedSearchYield(sightingsOf(theCohort().alerts)));
  });

  scenario('@error found equals the Sources tab Jobs Found for every named search, all-time', () => {
    const { searchYield, sources } = harvest(messagesOf(theCohort().alerts));
    expect(searchYield, 'harvest returns searchYield').toBeDefined();
    const jobsFound = Object.fromEntries(sources.rows.map((row) => [row['Search Term'], row['Jobs Found']]));
    expect(searchYield.allTime.searches.length).toBeGreaterThan(0);
    expect(Object.fromEntries(searchYield.allTime.searches.map(({ search, found }) => [search, found]))).toEqual(jobsFound);
  });

  scenario('@error the total counts the Jobs rows and the other figure counts the Jobs rows whose Role Family is other, in the all-time block', () => {
    const { searchYield, jobs } = harvest(messagesOf(theCohort().alerts));
    expect(searchYield, 'harvest returns searchYield').toBeDefined();
    expect(searchYield.allTime.total.found).toBe(jobs.rows.length);
    expect(searchYield.allTime.total.other).toBe(jobs.rows.filter((row) => row['Role Family'] === 'other').length);
  });

  scenario('@error the family harvest counts is the one the Jobs row carries, for an advert retitled between sightings', () => {
    const [retitled, filler] = theAdverts([Role.SCRUM, Role.COACH], 301);
    const alerts = [
      { search: BROAD, on: '2026-07-01', adverts: [retitled, filler] },
      { search: REGIONAL, on: '2026-07-20', adverts: [{ ...retitled, title: Role.ANALYST }] },
    ];
    const { searchYield, jobs } = harvest(messagesOf(alerts));
    expect(searchYield, 'harvest returns searchYield').toBeDefined();
    expect(jobs.rows.map((row) => row.Job).sort()).toEqual([Role.COACH, Role.SCRUM]);
    expect(searchYield.allTime.total).toEqual({ found: 2, other: 0, onTarget: 2 });
    expect(figuresOf(searchYield.allTime)).toEqual([
      [BROAD, 2, 0, 2, 1],
      [REGIONAL, 1, 0, 1, 0],
    ]);
  });

  scenario('@error harvest of no messages has no blocks and three empty tabs', () => {
    const model = harvest([]);
    expect(model.searchYield).toEqual({ allTime: null, recent: null });
    expect([model.jobs.rows, model.sources.rows, model.companies.rows]).toEqual([[], [], []]);
  });
});

describe('@pure the formatter prints a block as the stderr lines the DESIGN pins', () => {
  scenario('the cohort prints heading, column header, one row per search, the unparsed row and the total, in fixed widths', () => {
    expect(formatSearchYield(summarise(sightingsOf(theCohort().alerts)))).toEqual([
      'harvest build: search yield, all cached alerts (distinct adverts per saved search)',
      '  search                                    found      other  on-target  unique',
      '  agile coach in Examplestan                    6    1 (17%)          5       1',
      '  engineering manager in Examplestan            5    3 (60%)          2       1',
      '  scrum master in Exampleshire                  5    2 (40%)          3       1',
      '  agile coach (remote) in Examplestan           2     0 (0%)          2       0',
      '  (no search term)                              2     0 (0%)          2       -',
      '  all searches                                 11    3 (27%)          8       -',
    ]);
  });

  scenario('the spread cohort prints both blocks, the recent heading naming the end date and the window', () => {
    expect(formatSearchYield(summarise(sightingsOf(theSpreadCohort().alerts)))).toEqual([
      ALL_TIME_HEADING,
      '  search                                    found      other  on-target  unique',
      '  agile coach in Examplestan                    4    1 (25%)          3       2',
      '  scrum master in Exampleshire                  4    1 (25%)          3       2',
      '  change manager in Examplestan                 1     0 (0%)          1       1',
      '  all searches                                  8    2 (25%)          6       -',
      'harvest build: search yield, last 28 days to 2026-09-30',
      '  search                                    found      other  on-target  unique',
      '  scrum master in Exampleshire                  3     0 (0%)          3       3',
      '  agile coach in Examplestan                    2    1 (50%)          1       1',
      '  change manager in Examplestan                 1     0 (0%)          1       1',
      '  all searches                                  6    1 (17%)          5       -',
    ]);
    expect(recentHeadingTo('2026-09-30')).toBe(`harvest build: search yield, last ${YIELD_WINDOW_DAYS} days to 2026-09-30`);
  });

  scenario('@error a label of exactly 40 characters is printed whole and one of 41 is cut to its first 37 characters then ...', () => {
    const lines = linesOf([sighting(FORTY_CHARACTER_SEARCH, coach1, '2026-09-01'), sighting(FORTY_ONE_CHARACTER_SEARCH, scrum1, '2026-09-01', '09:05'), sighting(BROAD, delivery1, '2026-09-02')]);
    expect(YIELD_LABEL_WIDTH).toBe(40);
    expect(lines.some((line) => line.startsWith(`  ${FORTY_CHARACTER_SEARCH}  `))).toBe(true);
    expect(lines.some((line) => line.startsWith('  delivery manager in Examplestan and n...  '))).toBe(true);
    expect(lines.some((line) => line.includes('near!'))).toBe(false);
    expect(new Set(lines.slice(1).map((line) => line.length)).size).toBe(1);
  });

  scenario('@error exactly twenty named searches print no more-line; twenty-one print one more; twenty-three print three more; the total still counts them all', () => {
    const shown = (count) => linesOf(sightingsOf(manySearches(count))).filter((line) => /^ {2}search \d\d in Examplestan /.test(line)).length;
    expect(YIELD_NAMED_SEARCH_LIMIT).toBe(20);
    expect(linesOf(sightingsOf(manySearches(20)))).not.toContainEqual(expect.stringMatching(/more search\(es\) not shown/));
    expect(linesOf(sightingsOf(manySearches(21)))).toContain('  ... and 1 more search(es) not shown');
    const twentyThree = linesOf(sightingsOf(manySearches(23)));
    expect(twentyThree).toContain('  ... and 3 more search(es) not shown');
    expect([shown(20), shown(21), shown(23)]).toEqual([20, 20, 20]);
    expect(twentyThree.at(-1)).toMatch(/^ {2}all searches\s+2\s+1 \(50%\)\s+1\s+-$/);
    expect(twentyThree.indexOf('  ... and 3 more search(es) not shown')).toBeGreaterThan(twentyThree.findIndex((line) => line.startsWith('  search 20 in Examplestan')));
  });

  scenario('@error the unparsed row and the total row stay after the cap line, and the unparsed row is absent when every sighting named its search', () => {
    const withUnparsed = linesOf([...sightingsOf(manySearches(22)), sighting(NO_SEARCH, scrum1, '2026-09-11')]);
    expect(withUnparsed.slice(-3)).toEqual([withUnparsed.at(-3), expect.stringMatching(/^ {2}\(no search term\)\s+1\s+0 \(0%\)\s+1\s+-$/), expect.stringMatching(/^ {2}all searches/)]);
    expect(withUnparsed.at(-3)).toBe('  ... and 2 more search(es) not shown');
    expect(linesOf(sightingsOf(theSpreadCohort().alerts)).join('\n')).not.toContain(UNPARSED_SEARCH_LABEL);
    expect(UNPARSED_SEARCH_LABEL).toBe('(no search term)');
    expect(TOTAL_ROW_LABEL).toBe('all searches');
    expect(UNIQUE_NOT_SHOWN).toBe('-');
  });

  scenario('@error nothing is printed when both blocks are omitted', () => {
    expect(formatSearchYield({ allTime: null, recent: null })).toEqual([]);
    expect(linesOf([sighting(BROAD, coach1, '2026-09-01')])).toEqual([]);
  });

  scenario('@error a figure wider than its column is printed in full, never cut', () => {
    const wide = {
      scope: 'all',
      searches: [
        { search: 'a very busy search', found: 123456, other: 12345, onTarget: 111111, unique: 100000 },
        { search: 'a quiet search', found: 1, other: 0, onTarget: 1, unique: 0 },
      ],
      unparsed: null,
      total: { found: 123457, other: 12345, onTarget: 111112 },
    };
    const lines = formatSearchYield({ allTime: wide, recent: null });
    expect(lines).toContain(`  ${'a very busy search'.padEnd(40)}  ${'123456'.padStart(5)}  ${'12345 (10%)'.padStart(9)}  ${'111111'.padStart(9)}  ${'100000'.padStart(6)}`);
    expect(lines.every((line) => !line.includes('\n'))).toBe(true);
  });

  scenario('@error a search with every advert other shows 100%, and one with none shows 0%', () => {
    const lines = linesOf([sighting(BROAD, analyst1, '2026-09-01'), sighting(BROAD, developer1, '2026-09-01', '09:05'), sighting(REGIONAL, coach1, '2026-09-02')]);
    const blocks = yieldBlocksIn(lines.join('\n'));
    expect([rowOf(blocks, BROAD).otherShare, rowOf(blocks, REGIONAL).otherShare]).toEqual([100, 0]);
  });

  const SHARES = [
    [1, 8, 13],
    [3, 8, 38],
    [1, 3, 33],
    [2, 3, 67],
    [1, 6, 17],
    [5, 6, 83],
    [1, 200, 1],
  ];
  for (const [other, found, share] of SHARES) {
    scenario(`@error ${other} other of ${found} found shows ${share}%, rounded half up to a whole number`, () => {
      const others = theAdverts(Array.from({ length: other }, () => Role.ANALYST), 1000);
      const targeted = theAdverts(Array.from({ length: found - other }, () => Role.COACH), 2000);
      const filler = theAdverts([Role.SCRUM], 3000);
      const blocks = yieldBlocksIn(
        linesOf([...[...others, ...targeted].map((advert, index) => sighting(BROAD, advert, '2026-09-01', `09:${String(index % 60).padStart(2, '0')}`)), sighting(REGIONAL, filler[0], '2026-09-02')]).join('\n'),
      );
      expect(rowOf(blocks, BROAD)).toMatchObject({ found, other, otherShare: share });
    });
  }

  scenario('@error the printed lines equal the oracle\'s for the cohorts', () => {
    for (const { alerts } of [theCohort(), theSpreadCohort()]) expect(formatSearchYield(summarise(sightingsOf(alerts)))).toEqual(expectedStderrFor(sightingsOf(alerts)));
  });
});

describe('@structural the module stays pure and the build option table stays as it was', () => {
  scenario('@structural search-yield.mjs imports only core modules, uses no node: builtin and declares no class', () => {
    const source = readFileSync(new URL('../../../src/core/search-yield.mjs', import.meta.url), 'utf8');
    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map(([, specifier]) => specifier);
    expect(specifiers.every((specifier) => specifier.startsWith('./'))).toBe(true);
    expect(source).not.toMatch(/from\s+'node:/);
    expect(source).not.toMatch(/^\s*class\s/m);
    expect(source).not.toMatch(/new Date\(\)|Date\.now\(/);
  });

  scenario('@structural build still accepts exactly its five options: this feature adds none', () => {
    expect(Object.keys(OPTION_TABLES.build).sort()).toEqual(['dry-run', 'merge', 'out', 'report', 'target']);
    expect(Object.keys(OPTION_TABLES.rebuild).sort()).toEqual(['in', 'out']);
  });
});
