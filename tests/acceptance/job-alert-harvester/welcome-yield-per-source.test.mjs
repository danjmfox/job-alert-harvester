// @contract-shape:bounded-change
// welcome-to-the-jungle-source, slice 02 (US-02 yield stays truthful, DDD-11 per-source term-less row, DR-0015 search yield
// derived in harvest and printed never stored). With Welcome to the Jungle adverts in the cache, `harvest build --dry-run`
// prints LinkedIn's per-search figures exactly as before and shows the new source on its own labelled row, `unique` shown `-`;
// the total still equals the Jobs rows. Layer 2 (harvest() and the formatter, properties allowed, Mandate 9) and layer 3 (the
// real `build` as a subprocess over a synthetic cache; example-only, Mandate 11). Synthetic data only.
// Pinned here (the story left it open): the row is labelled `(no search term) Welcome to the Jungle` (DDD-11), sits after the
// named searches and before `all searches`, and is printed only inside a block that already prints (two or more named searches,
// DR-0015 rule 5). The data shape of `searchYield` for a second source is deliberately NOT pinned: these tests read the printed
// rows, and a baseline guard pins the LinkedIn-only shape, so the existing yield tests stay as they are (see the DISTILL R2 note).
// Not pinned, raised upstream: when the newest sighting in the cache is a Welcome to the Jungle one, DR-0015 rule 4's 28-day
// window ends on it, so LinkedIn's recent block would move; every digest here is dated inside LinkedIn's own window.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { holds } from '../gmail-api-source/support/property.mjs';
import { assertStateDelta, setTo, unchanged } from '../../common/state-delta.mjs';
import { harvest } from '../../../src/core/harvest.mjs';
import { formatSearchYield } from '../../../src/core/search-yield.mjs';
import { cacheAlert } from '../sheets-api-target/support/sheets-domain-types.mjs';
import {
  ALL_TIME_HEADING,
  Role,
  Search,
  TOTAL_ROW_LABEL,
  UNPARSED_SEARCH_LABEL,
  aCacheOfAlerts,
  aScratchWorkspace,
  anAlert,
  jobCountIn,
  messagesOf,
  operatorBuildsNewWorkbook,
  operatorPreviews,
  otherJobCountIn,
  rowOf,
  theAdverts,
  theCohort,
  theSpreadCohort,
  useWorkspaceCleanup,
  yieldBlocksIn,
  yieldHeadingsIn,
  yieldLinesIn,
} from '../search-yield-summary/support/search-yield-domain-types.mjs';
import { WELCOME_LABEL, WelcomeAlert, messagesIn, LINKEDIN_FIXTURES_DIR, LINKEDIN_VARIANT_FIXTURES_DIR } from './support/wttj-fixtures.mjs';
import { aDigest } from './support/wttj-fetch.mjs';
import BASELINE from './support/linkedin-yield-baseline.json' with { type: 'json' };

useWorkspaceCleanup();

const WELCOME_TERMLESS_LABEL = `${UNPARSED_SEARCH_LABEL} ${WELCOME_LABEL}`;
const ALL_WELCOME_ALERTS = Object.freeze(Object.values(WelcomeAlert).filter((alert) => alert !== WelcomeAlert.CARD_WITHOUT_TITLE));
const THREE_CARD_DIGEST_ON = (day) => aDigest(WelcomeAlert.THREE_CARDS, { on: day });
const welcomeJobsOf = (model) => model.jobs.rows.filter((row) => row.Source === WELCOME_LABEL);
const otherRowsOf = (rows) => rows.filter((row) => row['Role Family'] === 'other');
const linesOfModel = (model) => formatSearchYield(model.searchYield).join('\n');

/** A scratch workspace whose cache holds the LinkedIn `alerts` and the Welcome to the Jungle `digests`. */
function aCacheHolding({ alerts = [], digests = [] }) {
  const workspace = aScratchWorkspace();
  aCacheOfAlerts(workspace, alerts);
  digests.forEach((record) => cacheAlert(workspace, record));
  return workspace;
}

/** What Dan can read of the yield on stderr: headings, every row except the total and the new source's, that row, and the total's found. */
function observedYield(stderr) {
  const blocks = yieldBlocksIn(stderr);
  const rowsOf = (block) => block.rows.filter((row) => row.label !== TOTAL_ROW_LABEL && row.label !== WELCOME_TERMLESS_LABEL);
  return {
    'yield.headings': yieldHeadingsIn(stderr),
    'yield.linkedinRows': blocks.map(rowsOf),
    'yield.welcomeRows': blocks.map((block) => block.rows.find((row) => row.label === WELCOME_TERMLESS_LABEL) ?? null),
    'yield.totalFound': blocks.map((block) => rowOf([block], TOTAL_ROW_LABEL)?.found ?? null),
  };
}
const YIELD_UNIVERSE = ['yield.headings', 'yield.linkedinRows', 'yield.welcomeRows', 'yield.totalFound'];
const grewBy = (count) => ({ description: `each found figure grew by ${count}`, holds: (before, after) => after.length === before.length && after.every((found, index) => found === before[index] + count) });

describe('@driving_adapter the build shows Welcome to the Jungle on its own term-less row and leaves LinkedIn\'s rows as they were (US-02 yield stays truthful, AC-1, AC-2, DDD-11)', () => {
  it.skip('prints a row labelled for Welcome to the Jungle with found 3 and unique "-", after the named searches and before the total', () => {
    // Given a cache of LinkedIn searches and one three-card Welcome to the Jungle digest
    const digest = THREE_CARD_DIGEST_ON('2026-09-04');
    const workspace = aCacheHolding({ alerts: theCohort().alerts, digests: [digest] });
    const model = harvest([...messagesOf(theCohort().alerts), digest]);

    // When Dan runs a dry-run build
    const result = operatorPreviews(workspace);

    // Then the all-time block has the new source's row: three adverts, no unique figure, split other and on-target as the Jobs rows say
    expect(result.status, result.stderr).toBe(0);
    const [block] = yieldBlocksIn(result.stderr);
    const row = rowOf([block], WELCOME_TERMLESS_LABEL);
    expect(row).not.toBeNull();
    expect(WELCOME_TERMLESS_LABEL).toHaveLength(38);
    expect(row).toMatchObject({ found: 3, unique: null, other: otherRowsOf(welcomeJobsOf(model)).length });
    expect(row.other + row.onTarget).toBe(3);
    const labels = block.rows.map(({ label }) => label);
    expect(labels.indexOf(WELCOME_TERMLESS_LABEL)).toBeGreaterThan(labels.indexOf(Search.REDUNDANT));
    expect(labels.indexOf(WELCOME_TERMLESS_LABEL)).toBeLessThan(labels.indexOf(TOTAL_ROW_LABEL));
  }, 20_000);

  it.skip('every LinkedIn row, term-less row included, prints the same figures before and after the digest is cached; the total grows by 3', () => {
    // Given a cache of LinkedIn searches, built on its own
    const alone = operatorPreviews(aCacheHolding({ alerts: theCohort().alerts }));
    expect(alone.status, alone.stderr).toBe(0);

    // When a three-card digest is cached beside them and Dan runs the dry-run build again
    const withDigest = operatorPreviews(aCacheHolding({ alerts: theCohort().alerts, digests: [THREE_CARD_DIGEST_ON('2026-09-04')] }));

    // Then only the new source's row appears, and the total counts its three adverts
    expect(withDigest.status, withDigest.stderr).toBe(0);
    assertStateDelta(observedYield(alone.stderr), observedYield(withDigest.stderr), {
      universe: YIELD_UNIVERSE,
      expected: {
        'yield.headings': unchanged(),
        'yield.linkedinRows': unchanged(),
        'yield.welcomeRows': { description: 'the new source has a row of 3 in the all-time block', holds: (_before, after) => after[0]?.found === 3 && after.slice(1).every((row) => row === null || row.found > 0) },
        'yield.totalFound': grewBy(3),
      },
    });
  }, 30_000);

  it.skip('keeps both blocks of a two-month cache the same for LinkedIn when a digest dated inside the window is added', () => {
    // Given the two-month LinkedIn cache, which prints an all-time and a last-28-days block
    const alone = operatorPreviews(aCacheHolding({ alerts: theSpreadCohort().alerts }));
    expect(yieldHeadingsIn(alone.stderr)).toHaveLength(2);

    // When a digest dated 2026-09-15, inside that window and before its newest sighting, is cached beside it
    const withDigest = operatorPreviews(aCacheHolding({ alerts: theSpreadCohort().alerts, digests: [THREE_CARD_DIGEST_ON('2026-09-15')] }));

    // Then both blocks still print, LinkedIn's rows are identical in each, and each block has the new source's row
    expect(withDigest.status, withDigest.stderr).toBe(0);
    assertStateDelta(observedYield(alone.stderr), observedYield(withDigest.stderr), {
      universe: YIELD_UNIVERSE,
      expected: {
        'yield.headings': unchanged(),
        'yield.linkedinRows': unchanged(),
        'yield.welcomeRows': { description: 'both blocks show the new source with found 3', holds: (_before, after) => after.length === 2 && after.every((row) => row?.found === 3 && row.unique === null) },
        'yield.totalFound': grewBy(3),
      },
    });
  }, 30_000);

  it.skip('@error keeps LinkedIn\'s own unparsed alerts in their own row, apart from the new source\'s', () => {
    // Given the cohort, whose one alert with no readable search line carries two adverts, and a three-card digest
    const workspace = aCacheHolding({ alerts: theCohort().alerts, digests: [THREE_CARD_DIGEST_ON('2026-09-04')] });

    // When Dan runs a dry-run build
    const result = operatorPreviews(workspace);

    // Then the two are different rows with their own counts
    expect(result.status, result.stderr).toBe(0);
    const [block] = yieldBlocksIn(result.stderr);
    expect(rowOf([block], UNPARSED_SEARCH_LABEL)).toMatchObject({ found: 2, unique: null });
    expect(rowOf([block], WELCOME_TERMLESS_LABEL)).toMatchObject({ found: 3, unique: null });
  }, 20_000);
});

describe('@pure the total still equals the Jobs rows with a second source cached (US-02, AC-3, DR-0015 Y4 reconciliation)', () => {
  it('@property the all-searches total is the number of Jobs rows, and its other share is the number of Jobs rows whose Role Family is other (guard)', () => {
    holds(
      fc.property(fc.subarray([...ALL_WELCOME_ALERTS]), (alerts) => {
        const model = harvest([...messagesOf(theCohort().alerts), ...alerts.map((alert) => aDigest(alert))]);
        const [allTime] = yieldBlocksIn(linesOfModel(model));

        expect(allTime.heading).toBe(ALL_TIME_HEADING);
        const total = rowOf([allTime], TOTAL_ROW_LABEL);
        expect(total.found).toBe(model.jobs.rows.length);
        expect(total.other).toBe(otherRowsOf(model.jobs.rows).length);
      }),
      { numRuns: 60 },
    );
  });

  it.skip('@property the new source\'s row counts exactly the Welcome to the Jungle Jobs rows, splits them as their Role Families say, and is absent when none is cached', () => {
    holds(
      fc.property(fc.subarray([...ALL_WELCOME_ALERTS]), (alerts) => {
        const model = harvest([...messagesOf(theCohort().alerts), ...alerts.map((alert) => aDigest(alert))]);
        const [allTime] = yieldBlocksIn(linesOfModel(model));
        const mine = welcomeJobsOf(model);

        const row = rowOf([allTime], WELCOME_TERMLESS_LABEL);

        if (mine.length === 0) {
          expect(row).toBeNull();
          return;
        }
        expect(row).toMatchObject({ found: mine.length, other: otherRowsOf(mine).length, unique: null });
      }),
      { numRuns: 60 },
    );
  });

  it('@error the total on the printed block equals the Jobs rows of the workbook the build writes, both sources cached', () => {
    // Given both sources in the cache
    const workspace = aCacheHolding({ alerts: theCohort().alerts, digests: [THREE_CARD_DIGEST_ON('2026-09-04')] });
    const out = join(workspace, 'tracker.xlsx');

    // When Dan previews the build and then builds a new workbook from the same cache
    const preview = operatorPreviews(workspace);
    const built = operatorBuildsNewWorkbook(workspace, out);

    // Then the all-searches row agrees with the workbook: found with its Jobs rows, other with those whose family is other
    expect(preview.status, preview.stderr).toBe(0);
    expect(built.status, built.stderr).toBe(0);
    const total = rowOf(yieldBlocksIn(preview.stderr), TOTAL_ROW_LABEL);
    expect(total).not.toBeNull();
    expect(total.found).toBe(jobCountIn(out));
    expect(total.other).toBe(otherJobCountIn(out));
  }, 30_000);
});

describe('@driving_adapter nothing new is printed where the existing rules say nothing is (US-02, AC-4, DR-0015 rules 3 and 5)', () => {
  it('@error prints no yield block for a cache holding only Welcome to the Jungle, as for any cache with fewer than two named searches (guard)', () => {
    // Given a cache of three-card and one-card digests and no LinkedIn mail
    const digests = [THREE_CARD_DIGEST_ON('2026-09-04'), aDigest(WelcomeAlert.ONE_CARD, { on: '2026-09-05' })];
    const workspace = aCacheHolding({ digests });

    // When Dan runs a dry-run build
    const result = operatorPreviews(workspace);

    // Then no yield line is printed
    expect(result.status, result.stderr).toBe(0);
    expect(yieldLinesIn(result.stderr)).toEqual([]);
    expect(formatSearchYield(harvest(digests).searchYield)).toEqual([]);
  }, 20_000);

  it('@error prints no yield block for one named LinkedIn search beside a digest, however many adverts the digest holds (guard)', () => {
    // Given a single LinkedIn search and a three-card digest
    const alerts = [anAlert({ search: Search.BROAD, on: '2026-09-01', adverts: theAdverts([Role.COACH, Role.SCRUM]) })];
    const model = harvest([...messagesOf(alerts), THREE_CARD_DIGEST_ON('2026-09-04')]);

    // When the yield is formatted
    // Then nothing is printed
    expect(formatSearchYield(model.searchYield)).toEqual([]);
  });

  it('@error keeps the yield off stdout and out of the --report file, with the new source cached (guard)', () => {
    // Given both sources in the cache and a report file asked for
    const workspace = aCacheHolding({ alerts: theCohort().alerts, digests: [THREE_CARD_DIGEST_ON('2026-09-04')] });
    const report = join(workspace, 'changes.txt');

    // When Dan runs a dry-run build with --report
    const result = operatorPreviews(workspace, '--report', report);

    // Then the yield is on stderr only
    expect(result.status, result.stderr).toBe(0);
    expect(yieldLinesIn(result.stderr).length).toBeGreaterThan(0);
    for (const text of [result.stdout, readFileSync(report, 'utf8')]) {
      expect(text).not.toContain(WELCOME_TERMLESS_LABEL);
      expect(text).not.toContain(TOTAL_ROW_LABEL);
      expect(text).not.toContain('search yield');
    }
  }, 20_000);
});

describe('@pure a LinkedIn-only cache yields exactly what it did before the second source existed (US-02, AC-1, guard for DR-0015)', () => {
  const linkedinOnly = {
    'linkedin fixtures and variants': () => [...messagesIn(LINKEDIN_FIXTURES_DIR), ...messagesIn(LINKEDIN_VARIANT_FIXTURES_DIR)],
    'the cohort': () => messagesOf(theCohort().alerts),
    'the spread cohort': () => messagesOf(theSpreadCohort().alerts),
  };

  it.each(Object.keys(linkedinOnly))('gives %s the same blocks, key for key, as the code did when this baseline was captured', (name) => {
    const { searchYield } = harvest(linkedinOnly[name]());

    expect(JSON.parse(JSON.stringify(searchYield))).toEqual(BASELINE[name]);
    for (const block of [searchYield.allTime, searchYield.recent].filter((candidate) => candidate !== null)) {
      expect(Object.keys(block).sort()).toEqual(block.scope === 'recent' ? ['endDate', 'scope', 'searches', 'total', 'unparsed'] : ['scope', 'searches', 'total', 'unparsed']);
    }
  });

  it('adding a digest changes none of LinkedIn\'s named-search figures in the data the build holds', () => {
    // Given the cohort on its own and with a digest dated inside it
    const alone = harvest(messagesOf(theCohort().alerts)).searchYield.allTime.searches;
    const withDigest = harvest([...messagesOf(theCohort().alerts), THREE_CARD_DIGEST_ON('2026-09-04')]).searchYield.allTime.searches;

    // Then every named search carries the same figures
    expect(withDigest).toEqual(alone);
  });
});
