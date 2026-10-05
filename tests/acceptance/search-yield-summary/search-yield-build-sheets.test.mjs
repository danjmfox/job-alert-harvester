// @contract-shape:bounded-change
// `harvest build --target sheets` as an operator runs it: an asynchronously spawned subprocess through the production
// composition root, a synthetic cache of alerts, real credential files under a temp HOME, and the loopback Sheets fake
// (Driven external) holding the operator's tracker. The existing fake and its helpers are reused unchanged (no parallel
// fake was written); this feature adds only builders and observers beside them. The search yield is derived from the whole
// cache and printed to stderr after the role-family view (DR-0015); the Sheet's tabs, columns and cells, the requests sent,
// stdout and the --report file are exactly what they were without it. Subprocess layer: example-only (Mandate 11).
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { assertStateDelta, unchanged } from '../../common/state-delta.mjs';
import { withLoopbackFake } from '../sheets-api-target/support/sheets-fake.mjs';
import {
  ALLOWED_REQUEST_TYPES,
  COMPANIES_COLUMNS,
  JOBS_COLUMNS,
  NO_SEARCH,
  Role,
  SHEET_UNIVERSE,
  SOURCES_COLUMNS,
  Search,
  THE_COHORT_YIELD_LINES,
  THE_SPREAD_YIELD_LINES,
  YIELD_HEADING_PREFIX,
  ALL_TIME_HEADING,
  aCacheOfAlerts,
  aScratchWorkspace,
  aSheetHoldingTheCache,
  anAlert,
  anEmptySheet,
  indexOfLine,
  observeSheet,
  operatorBuildsIntoTheSheet,
  reportTextOf,
  rowOf,
  theAdverts,
  theCohort,
  theDataBatch,
  theSpreadCohort,
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
const sameHeader = (tab, header) => JSON.stringify(tab.header) === JSON.stringify(header);
const noGridShrank = (before, after) => Object.entries(before).every(([title, grid]) => after[title].rowCount >= grid.rowCount && after[title].columnCount >= grid.columnCount);

/** An operator whose cache holds `alerts` and whose Sheet holds only its headers (`headers`) or exactly what the cache derives (`cache`). */
function anOperatorWith(alerts, { sheet = 'headers' } = {}) {
  const workspace = aScratchWorkspace();
  aCacheOfAlerts(workspace, alerts);
  return { workspace, fake: sheet === 'cache' ? aSheetHoldingTheCache(workspace) : anEmptySheet() };
}

/** Runs `build --target sheets` against the fake behind a real loopback socket, with the operator's credentials in a temp HOME. */
const operatorBuilds = (fake, workspace, ...args) => withLoopbackFake(fake, (baseUrl) => operatorBuildsIntoTheSheet(workspace, baseUrl, ...args));

describe('@driving_adapter harvest build --target sheets prints the search yield for the operator\'s Google Sheet', () => {
  it('@walking_skeleton @driving_adapter @real-io Operator builds into their Google Sheet and sees which saved searches earn their place: found, other, on-target and unique, all-time and the last 28 days', async () => {
    // Given the operator's Sheet holds only its headers, and the cache holds two months of alerts from three overlapping saved searches
    const { workspace, fake } = anOperatorWith(theSpreadCohort().alerts);
    const before = observeSheet(fake);
    // When the operator builds into the Sheet
    const result = await operatorBuilds(fake, workspace);
    // Then the adverts arrive in the declared tabs and columns, and nothing else is added to the Sheet
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('harvest build: merged');
    assertStateDelta(before, observeSheet(fake), {
      universe: SHEET_UNIVERSE,
      expected: {
        'sheet.jobs': holdsThat('8 rows under the declared Jobs header', (_b, a) => sameHeader(a, JOBS_COLUMNS) && a.rows.length === 8),
        'sheet.companies': holdsThat('rows under the declared Companies header', (_b, a) => sameHeader(a, COMPANIES_COLUMNS) && a.rows.length > 0),
        'sheet.sources': holdsThat('3 rows under the declared Sources header', (_b, a) => sameHeader(a, SOURCES_COLUMNS) && a.rows.length === 3),
        'sheet.grids': holdsThat('no grid shrank', noGridShrank),
        'sheet.writeRequests': holdsThat('the data was written', (b, a) => a > b),
      },
    });
    // And stderr shows both blocks, the second ending at the latest sighting date, after the role-family view
    expect(yieldLinesIn(result.stderr)).toEqual(THE_SPREAD_YIELD_LINES);
    expect(indexOfLine(result.stderr, /classified other; most frequent:/)).toBeLessThan(indexOfLine(result.stderr, new RegExp(`^${YIELD_HEADING_PREFIX}`)));
    expect(yieldHeadingsIn(result.stdout)).toEqual([]);
  });

  it('@error the yield is derived from the cache alone: a Sheet holding everything already and an empty one give the same lines', async () => {
    const empty = anOperatorWith(theCohort().alerts);
    const full = anOperatorWith(theCohort().alerts, { sheet: 'cache' });
    const fromEmpty = await operatorBuilds(empty.fake, empty.workspace);
    const fromFull = await operatorBuilds(full.fake, full.workspace);
    expect(fromEmpty.status, fromEmpty.stderr).toBe(0);
    expect(fromFull.status, fromFull.stderr).toBe(0);
    expect(yieldLinesIn(fromEmpty.stderr)).toEqual(THE_COHORT_YIELD_LINES);
    expect(yieldLinesIn(fromFull.stderr)).toEqual(THE_COHORT_YIELD_LINES);
  });

  it('@error an empty report still means nothing changed: a Sheet that already holds everything is built into with the yield printed, no data batch sent, and an empty report', async () => {
    // Given a Sheet holding exactly what the cache derives
    const { workspace, fake } = anOperatorWith(theCohort().alerts, { sheet: 'cache' });
    const before = observeSheet(fake);
    const report = join(workspace, 'changes.txt');
    // When the operator builds and asks for the report
    const result = await operatorBuilds(fake, workspace, '--report', report);
    // Then the yield is printed, the report is empty, stdout names no yield, and not one cell, tab, grid or file moved
    expect(result.status, result.stderr).toBe(0);
    expect(yieldLinesIn(result.stderr)).toEqual(THE_COHORT_YIELD_LINES);
    expect(reportTextOf(report)).toBe('');
    expect(`${result.stdout}`).not.toMatch(/search yield|\(no search term\)|all searches/);
    expect(theDataBatch(fake)).toBeNull();
    assertStateDelta(before, observeSheet(fake), { universe: SHEET_UNIVERSE, expected: allUnchanged(SHEET_UNIVERSE) });
  });

  it('@error the Sheet holds nothing the yield added: every request that wrote is inside the four allowed kinds, and only the declared columns were written', async () => {
    const { workspace, fake } = anOperatorWith(theCohort().alerts);
    const result = await operatorBuilds(fake, workspace);
    expect(result.status, result.stderr).toBe(0);
    expect(yieldLinesIn(result.stderr)).toEqual(THE_COHORT_YIELD_LINES);
    const batch = theDataBatch(fake);
    expect(batch.requestTypes.every((type) => ALLOWED_REQUEST_TYPES.includes(type))).toBe(true);
    expect(observeSheet(fake)['sheet.tabNames']).toEqual(['Jobs', 'Companies', 'Sources']);
    expect(observeSheet(fake)['sheet.jobs'].header).toEqual(JOBS_COLUMNS);
  });

  it('@error a second build into the Sheet prints the same yield, sends no further data batch and changes nothing', async () => {
    const { workspace, fake } = anOperatorWith(theCohort().alerts);
    const first = await operatorBuilds(fake, workspace);
    expect(first.status, first.stderr).toBe(0);
    const batchesAfterFirst = fake.requestsTo('batch-update').length;
    const before = observeSheet(fake);
    const second = await operatorBuilds(fake, workspace);
    expect(second.status, second.stderr).toBe(0);
    expect(yieldLinesIn(second.stderr)).toEqual(yieldLinesIn(first.stderr));
    expect(yieldLinesIn(second.stderr)).toEqual(THE_COHORT_YIELD_LINES);
    expect(fake.requestsTo('batch-update')).toHaveLength(batchesAfterFirst);
    assertStateDelta(before, observeSheet(fake), { universe: SHEET_UNIVERSE, expected: allUnchanged(SHEET_UNIVERSE) });
  });

  it('@error one named search prints nothing, and once a second search has sent an advert the next build prints both', async () => {
    const [a, b, c] = theAdverts([Role.COACH, Role.SCRUM, Role.DELIVERY], 1301);
    const lone = [anAlert({ search: BROAD, on: '2026-09-01', adverts: [a, b] }), anAlert({ search: NO_SEARCH, on: '2026-09-02', adverts: [b] })];
    const { workspace, fake } = anOperatorWith(lone);
    const first = await operatorBuilds(fake, workspace);
    expect(first.status, first.stderr).toBe(0);
    expect(yieldHeadingsIn(first.stderr)).toEqual([]);
    aCacheOfAlerts(workspace, [...lone, anAlert({ search: REGIONAL, on: '2026-09-03', adverts: [c] })]);
    const second = await operatorBuilds(fake, workspace);
    expect(second.status, second.stderr).toBe(0);
    expect(yieldHeadingsIn(second.stderr)).toEqual([ALL_TIME_HEADING]);
    expect(rowOf(yieldBlocksIn(second.stderr), BROAD)).toMatchObject({ found: 2, unique: 2 });
  });

  it('@error an empty cache prints no yield: the build refuses as it always did and writes nothing, and once alerts arrive the next build prints it', async () => {
    // Given an operator whose cache is empty
    const workspace = aScratchWorkspace();
    const fake = anEmptySheet();
    const before = observeSheet(fake);
    // When the operator builds into the Sheet
    const refused = await operatorBuilds(fake, workspace);
    // Then it refuses, prints no yield and writes nothing
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toMatch(/the cache is empty/);
    expect(yieldHeadingsIn(refused.stderr)).toEqual([]);
    assertStateDelta(before, observeSheet(fake), { universe: SHEET_UNIVERSE, expected: allUnchanged(SHEET_UNIVERSE) });
    // When alerts arrive and the operator builds again
    aCacheOfAlerts(workspace, theCohort().alerts);
    const arrived = await operatorBuilds(fake, workspace);
    expect(arrived.status, arrived.stderr).toBe(0);
    expect(yieldLinesIn(arrived.stderr)).toEqual(THE_COHORT_YIELD_LINES);
  });
});

describe('@driving_adapter harvest build --target sheets --dry-run prints the yield and sends no write request', () => {
  // @contract-shape:unbounded-preservation
  scenario('@error the preview prints the yield on stderr after its own plan, and the fake records no write request and no change', async () => {
    // Given a Sheet holding only headers, and a cache of overlapping searches
    const { workspace, fake } = anOperatorWith(theCohort().alerts);
    const before = observeSheet(fake);
    // When the operator previews
    const result = await operatorBuilds(fake, workspace, '--dry-run');
    // Then the yield is printed, the plan is on stdout, and the Sheet saw no write
    expect(result.status, result.stderr).toBe(0);
    expect(yieldLinesIn(result.stderr)).toEqual(THE_COHORT_YIELD_LINES);
    expect(result.stdout).toContain('harvest build --dry-run: plan for tab "Jobs"');
    expect(result.stdout).not.toMatch(/search yield/);
    expect(fake.writeRequests()).toEqual([]);
    expect(indexOfLine(result.stderr, /classified other; most frequent:/)).toBeLessThan(indexOfLine(result.stderr, new RegExp(`^${YIELD_HEADING_PREFIX}`)));
    assertStateDelta(before, observeSheet(fake), { universe: SHEET_UNIVERSE, expected: allUnchanged(SHEET_UNIVERSE) });
  });

  // @contract-shape:unbounded-preservation
  scenario('@error the preview shows exactly the yield the build then prints', async () => {
    const { workspace, fake } = anOperatorWith(theSpreadCohort().alerts);
    const previewed = await operatorBuilds(fake, workspace, '--dry-run');
    const built = await operatorBuilds(fake, workspace);
    expect(previewed.status, previewed.stderr).toBe(0);
    expect(built.status, built.stderr).toBe(0);
    expect(yieldLinesIn(previewed.stderr)).toEqual(THE_SPREAD_YIELD_LINES);
    expect(yieldLinesIn(built.stderr)).toEqual(yieldLinesIn(previewed.stderr));
  });

  // @contract-shape:unbounded-preservation
  scenario('@error a preview against an empty cache prints no yield and sends no write request, and once alerts arrive the preview prints it', async () => {
    const workspace = aScratchWorkspace();
    const fake = anEmptySheet();
    const empty = await operatorBuilds(fake, workspace, '--dry-run');
    expect(empty.status, empty.stderr).toBe(0);
    expect(yieldHeadingsIn(empty.stderr)).toEqual([]);
    aCacheOfAlerts(workspace, theCohort().alerts);
    const arrived = await operatorBuilds(fake, workspace, '--dry-run');
    expect(arrived.status, arrived.stderr).toBe(0);
    expect(yieldLinesIn(arrived.stderr)).toEqual(THE_COHORT_YIELD_LINES);
    expect(fake.writeRequests()).toEqual([]);
  });
});
