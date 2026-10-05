// @contract-shape:pure-function
// DR-0015 as properties of the pure summary, its formatter and `harvest()` (layers 1 and 2 only: fast-check never reaches
// a subprocess). Sightings are generated across saved searches, adverts and a spread of days wider than the 28-day window,
// with unparsed and empty terms, long labels and more than twenty searches. Properties state the DESIGN's P1 to P7 and
// then pin the whole behaviour against an oracle that restates the DESIGN independently of src/ (support/yield-oracle.mjs).
// Order-invariance (P4) runs through `harvest()` with the DESIGN's generator constraint: every alert arrives at a distinct
// minute, so an advert's first sighting is never a tie. Each property first asserts a block is produced, so a scaffold
// that throws, or a harvest without the key, fails as RED.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { harvest } from '../../../src/core/harvest.mjs';
import { formatSearchYield, summariseSearchYield } from '../../../src/core/search-yield.mjs';
import {
  NO_SEARCH,
  ON_TARGET_TITLES,
  YIELD_LABEL_WIDTH,
  YIELD_NAMED_SEARCH_LIMIT,
  expectedSearchYield,
  messagesOf,
  rowOf,
  sightingsOf,
  summaryInputsOf,
  yieldBlocksIn,
} from './support/search-yield-domain-types.mjs';
import { alertPlanArb, compactSightingsArb, crowdedSightingsArb, idOfAdvert, shiftedBy, sightingsArb, titleOfAdvert } from './support/yield-generators.mjs';
import { dayOf, expectedStderrFor, percentOf, shiftDay } from './support/yield-oracle.mjs';
import { holds } from './support/property.mjs';
import { scenario } from './support/red-gate.mjs';

const summarise = (sightings) => {
  const { sightings: rows, adverts } = summaryInputsOf(sightings);
  return summariseSearchYield(rows, adverts);
};
const blocksOf = (summary) => [summary.allTime, summary.recent].filter(Boolean);
const isNamed = (search) => typeof search === 'string' && search !== '';
const distinct = (values) => new Set(values).size;
/** The block each scope produces for `sightings`, with the end date dropped: the figures alone. */
const figuresOnly = (summary) => JSON.parse(JSON.stringify(summary, (key, value) => (key === 'endDate' ? undefined : value)));
const HARVEST_RUNS = { numRuns: 40 };
/** A value together with one permutation of it. */
const withAShuffle = (arbitrary) => arbitrary.chain((items) => fc.tuple(fc.constant(items), fc.shuffledSubarray(items, { minLength: items.length, maxLength: items.length })));

describe('@property the counts of one block are consistent', () => {
  it('@property P1 other plus on-target is found, for every search, the unparsed row and the total, in both blocks', () => {
    holds(
      fc.property(sightingsArb, (sightings) => {
        for (const block of blocksOf(summarise(sightings))) {
          for (const row of [...block.searches, block.total, ...(block.unparsed ? [block.unparsed] : [])]) expect(row.other + row.onTarget).toBe(row.found);
        }
      }),
    );
  });

  it('@property P2 unique is at most on-target, which is at most found; every figure is a non-negative whole number', () => {
    holds(
      fc.property(sightingsArb, (sightings) => {
        for (const block of blocksOf(summarise(sightings))) {
          for (const { found, other, onTarget, unique } of block.searches) {
            expect(unique).toBeLessThanOrEqual(onTarget);
            expect(onTarget).toBeLessThanOrEqual(found);
            for (const figure of [found, other, onTarget, unique]) expect(Number.isInteger(figure) && figure >= 0).toBe(true);
          }
          expect(block.total.onTarget).toBeLessThanOrEqual(block.total.found);
        }
      }),
    );
  });

  it('@property every named search in a block has at least one advert, and the total is at least the largest search', () => {
    holds(
      fc.property(sightingsArb, (sightings) => {
        for (const block of blocksOf(summarise(sightings))) {
          expect(block.searches.every(({ found }) => found >= 1)).toBe(true);
          expect(block.total.found).toBeGreaterThanOrEqual(Math.max(...block.searches.map(({ found }) => found)));
        }
      }),
    );
  });

  it('@property the searches are ordered by found descending, then by search ascending in code-unit order', () => {
    holds(
      fc.property(sightingsArb, (sightings) => {
        for (const { searches } of blocksOf(summarise(sightings))) {
          searches.slice(1).forEach((row, index) => {
            const previous = searches[index];
            expect(previous.found > row.found || (previous.found === row.found && previous.search < row.search)).toBe(true);
          });
        }
      }),
    );
  });
});

describe('@property every advert is counted under every search that sent it', () => {
  it('@property P3 the sum of found over the named searches is the number of distinct (advert, search) pairs; the total is the number of distinct adverts', () => {
    holds(
      fc.property(compactSightingsArb, (sightings) => {
        const { allTime } = summarise(sightings);
        const named = sightings.filter(({ search }) => isNamed(search));
        const pairs = distinct(named.map(({ id, search }) => `${search}\u0000${id}`));
        if (distinct(named.map(({ search }) => search)) < 2) {
          expect(allTime).toBeNull();
          return;
        }
        expect(allTime.searches.reduce((sum, { found }) => sum + found, 0)).toBe(pairs);
        expect(allTime.total.found).toBe(distinct(sightings.map(({ id }) => id)));
        expect(allTime.unparsed?.found ?? 0).toBe(distinct(sightings.filter(({ search }) => !isNamed(search)).map(({ id }) => id)));
      }),
    );
  });

  it('@property a block is present exactly when the scope holds two or more named searches', () => {
    holds(
      fc.property(sightingsArb, (sightings) => {
        const { allTime } = summarise(sightings);
        const names = distinct(sightings.filter(({ search }) => isNamed(search)).map(({ search }) => search));
        expect(allTime === null).toBe(names < 2);
        if (allTime) expect(allTime.searches.map(({ search }) => search).sort()).toEqual([...new Set(sightings.filter(({ search }) => isNamed(search)).map(({ search }) => search))].sort());
      }),
    );
  });

  it('@property an advert counts as unique to a search only when that search alone sent it and its title is on-target', () => {
    holds(
      fc.property(compactSightingsArb, (sightings) => {
        const { allTime } = summarise(sightings);
        if (!allTime) return;
        const titleById = new Map(sightings.map(({ id, title }) => [id, title]));
        for (const { search, unique } of allTime.searches) {
          const mine = new Set(sightings.filter((s) => s.search === search).map(({ id }) => id));
          const sentByAnother = new Set(sightings.filter((s) => isNamed(s.search) && s.search !== search).map(({ id }) => id));
          expect(unique).toBe([...mine].filter((id) => !sentByAnother.has(id) && ON_TARGET_TITLES.includes(titleById.get(id))).length);
        }
      }),
    );
  });

  it('@property @error sightings that name no search never change any named search\'s found or unique', () => {
    holds(
      fc.property(compactSightingsArb, fc.integer({ min: 0, max: 13 }), (sightings, advert) => {
        const withExtra = [...sightings, { search: NO_SEARCH, id: idOfAdvert(advert), title: titleOfAdvert(advert), at: '2026-07-05T10:00:00Z' }];
        const before = summarise(sightings).allTime;
        const after = summarise(withExtra).allTime;
        expect(after === null).toBe(before === null);
        if (before) expect(after.searches).toEqual(before.searches);
      }),
    );
  });
});

describe('@property the recent block is the all-time figures restricted to a window', () => {
  it('@property P5 per search, and in total, the recent found is at most the all-time found; every recent search is an all-time search', () => {
    holds(
      fc.property(sightingsArb, (sightings) => {
        const { allTime, recent } = summarise(sightings);
        if (!recent) return;
        expect(allTime).not.toBeNull();
        const found = new Map(allTime.searches.map(({ search, found: count }) => [search, count]));
        for (const row of recent.searches) {
          expect(found.has(row.search)).toBe(true);
          expect(row.found).toBeLessThanOrEqual(found.get(row.search));
        }
        expect(recent.total.found).toBeLessThanOrEqual(allTime.total.found);
        expect(recent.total.other).toBeLessThanOrEqual(allTime.total.other);
      }),
    );
  });

  it('@property the recent block ends at the latest sighting date, and exists only when the cache spans more than 28 dates', () => {
    holds(
      fc.property(sightingsArb, (sightings) => {
        const { recent } = summarise(sightings);
        const days = sightings.map(({ at }) => dayOf(at)).sort();
        if (!recent) return;
        expect(recent.endDate).toBe(days.at(-1));
        const spanInDays = (Date.parse(`${days.at(-1)}T00:00:00Z`) - Date.parse(`${days[0]}T00:00:00Z`)) / 86_400_000;
        expect(spanInDays).toBeGreaterThanOrEqual(28);
      }),
    );
  });

  it('@property @error moving every sighting by the same number of days never changes a figure: only the window\'s end date moves with them', () => {
    holds(
      fc.property(sightingsArb, fc.integer({ min: -400, max: 400 }), (sightings, days) => {
        const original = summarise(sightings);
        const moved = summarise(shiftedBy(sightings, days));
        expect(figuresOnly(moved)).toEqual(figuresOnly(original));
        if (original.recent) expect(moved.recent.endDate).toBe(shiftDay(original.recent.endDate, days));
      }),
    );
  });
});

describe('@property the summary equals the DESIGN oracle', () => {
  it('@property every figure of both blocks equals what the oracle derives from the sightings', () => {
    holds(
      fc.property(sightingsArb, (sightings) => {
        expect(summarise(sightings)).toEqual(expectedSearchYield(sightings));
      }),
    );
  });

  it('@property the same sightings give the same summary, and the order of the sightings never changes it', () => {
    holds(
      fc.property(withAShuffle(sightingsArb), ([sightings, shuffled]) => {
        expect(summarise(shuffled)).toEqual(summarise(sightings));
        expect(summarise(sightings)).toEqual(summarise(sightings));
      }),
    );
  });
});

describe('@property harvest carries the summary, whatever the order the messages arrive in', () => {
  scenario('@property P4 shuffling the messages leaves harvest().searchYield unchanged (every alert at a distinct minute: the DESIGN\'s generator constraint)', () => {
    holds(
      fc.property(withAShuffle(alertPlanArb.map(messagesOf)), ([messages, shuffled]) => {
        const forwards = harvest(messages).searchYield;
        expect(forwards).toBeDefined();
        expect(harvest(shuffled).searchYield).toEqual(forwards);
        expect(harvest([...messages].reverse()).searchYield).toEqual(forwards);
      }),
      HARVEST_RUNS,
    );
  });

  scenario('@property harvest().searchYield equals the oracle for generated alerts, adverts retitled between sightings included: the family is the first sighting\'s', () => {
    holds(
      fc.property(alertPlanArb, (alerts) => {
        expect(harvest(messagesOf(alerts)).searchYield).toEqual(expectedSearchYield(sightingsOf(alerts)));
      }),
      HARVEST_RUNS,
    );
  });

  scenario('@property found equals the Sources tab Jobs Found for every named search, and the all-time total equals the Jobs row count', () => {
    holds(
      fc.property(alertPlanArb, (alerts) => {
        const { searchYield, sources, jobs } = harvest(messagesOf(alerts));
        expect(searchYield).toBeDefined();
        if (!searchYield.allTime) return;
        const jobsFound = Object.fromEntries(sources.rows.map((row) => [row['Search Term'], row['Jobs Found']]));
        expect(Object.fromEntries(searchYield.allTime.searches.map(({ search, found }) => [search, found]))).toEqual(jobsFound);
        expect(searchYield.allTime.total.found).toBe(jobs.rows.length);
        expect(searchYield.allTime.total.other).toBe(jobs.rows.filter((row) => row['Role Family'] === 'other').length);
      }),
      HARVEST_RUNS,
    );
  });
});

describe('@property the summary is total', () => {
  const odd = fc.oneof({ weight: 3, arbitrary: fc.string() }, { weight: 1, arbitrary: fc.constant('') }, { weight: 3, arbitrary: fc.constantFrom('2026-09-30T10:00:00Z', '2026-02-29', '2026-13-45T00:00:00Z', 'yesterday', '0000-00-00', '9999-12-31T23:59:59Z') });
  const term = fc.oneof(fc.constant(null), fc.constant(''), fc.string(), fc.constantFrom('a', 'b', 'c'));
  const oddSightings = fc.array(fc.record({ searchTerm: term, key: fc.integer({ min: 0, max: 5 }), seenAt: odd, title: fc.string() }), { maxLength: 30 });

  it('@property P6 any sightings, null or empty terms, unreadable dates and odd titles included, give a summary and never throw', () => {
    holds(
      fc.property(oddSightings, (records) => {
        const sightings = records.map(({ searchTerm, key, seenAt, title }) => ({ searchTerm, dedupKey: `linkedin:${key}`, seenAt, title }));
        const adverts = [...new Set(sightings.map(({ dedupKey }) => dedupKey))].map((dedupKey) => ({ dedupKey, title: sightings.find((s) => s.dedupKey === dedupKey).title }));
        const summary = summariseSearchYield(sightings, adverts);
        expect(Object.keys(summary).sort()).toEqual(['allTime', 'recent']);
        expect(() => formatSearchYield(summary)).not.toThrow();
        expect(formatSearchYield(summary).every((line) => typeof line === 'string' && !line.includes('\n'))).toBe(true);
      }),
    );
  });

  it('@property P6 an empty list of sightings gives no block', () => {
    expect(summariseSearchYield([], [])).toEqual({ allTime: null, recent: null });
  });
});

describe('@property the printed lines follow the DESIGN rule', () => {
  scenario('@property the lines equal the oracle\'s for generated sightings, labels at and beyond 40 characters included', () => {
    holds(
      fc.property(sightingsArb, (sightings) => {
        expect(formatSearchYield(summarise(sightings))).toEqual(expectedStderrFor(sightings));
      }),
    );
  });

  scenario('@property with up to 26 searches at most twenty are listed, the rest are counted in one line, and the total still counts every advert', () => {
    holds(
      fc.property(crowdedSightingsArb, (sightings) => {
        const summary = summarise(sightings);
        if (!summary.allTime) {
          expect(distinct(sightings.map(({ search }) => search))).toBeLessThan(2);
          return;
        }
        const lines = formatSearchYield(summary);
        expect(YIELD_NAMED_SEARCH_LIMIT).toBe(20);
        const printed = yieldBlocksIn(lines.join('\n'));
        const blocks = [summary.allTime, summary.recent].filter(Boolean);
        expect(printed).toHaveLength(blocks.length);
        printed.forEach((block, index) => {
          const named = blocks[index].searches.length;
          expect(block.rows.filter(({ label }) => label.startsWith('search '))).toHaveLength(Math.min(named, 20));
          expect(block.more).toBe(named > 20 ? named - 20 : null);
          expect(block.rows.at(-1).label).toBe('all searches');
        });
        expect(lines).toEqual(expectedStderrFor(sightings));
        expect(summary.allTime.total.found).toBe(distinct(sightings.map(({ id }) => id)));
      }),
    );
  });

  scenario('@property P7 the share of a search is a whole number from 0 to 100, rounded half up, 100 when every advert is other and 0 when none is', () => {
    holds(
      fc.property(sightingsArb, (sightings) => {
        const blocks = yieldBlocksIn(formatSearchYield(summarise(sightings)).join('\n'));
        for (const { rows } of blocks) {
          for (const { found, other, otherShare } of rows) {
            expect(Number.isInteger(otherShare) && otherShare >= 0 && otherShare <= 100).toBe(true);
            expect(otherShare).toBe(percentOf(other, found));
            if (other === found) expect(otherShare).toBe(100);
            if (other === 0) expect(otherShare).toBe(0);
          }
        }
      }),
    );
  });

  scenario('@property @error a search whose every advert is other shows 100%, and one with none shows 0%', () => {
    holds(
      fc.property(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 6 }), (others, targeted) => {
        const sightings = [
          ...Array.from({ length: others }, (_, index) => ({ search: 'only others', id: idOfAdvert(100 + index), title: 'Data Analyst', at: '2026-09-01T09:00:00Z' })),
          ...Array.from({ length: targeted }, (_, index) => ({ search: 'only targets', id: idOfAdvert(200 + index), title: 'Scrum Master', at: '2026-09-01T09:00:00Z' })),
        ];
        const blocks = yieldBlocksIn(formatSearchYield(summarise(sightings)).join('\n'));
        expect([rowOf(blocks, 'only others').otherShare, rowOf(blocks, 'only targets').otherShare]).toEqual([100, 0]);
      }),
    );
  });

  scenario('@property every table line has the same width and no label is wider than the column', () => {
    holds(
      fc.property(sightingsArb, (sightings) => {
        const lines = formatSearchYield(summarise(sightings)).filter((line) => line.startsWith('  ') && !line.includes('more search(es)'));
        for (const line of lines) expect(line.length).toBe(2 + YIELD_LABEL_WIDTH + 2 + 5 + 2 + 9 + 2 + 9 + 2 + 6);
        for (const { rows } of yieldBlocksIn(formatSearchYield(summarise(sightings)).join('\n'))) for (const { label } of rows) expect(label.length).toBeLessThanOrEqual(YIELD_LABEL_WIDTH);
      }),
    );
  });
});
