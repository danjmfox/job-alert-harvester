// @contract-shape:bounded-change
// `harvest build --target sheets` as an operator runs it: an asynchronously spawned subprocess through the production
// composition root, a synthetic cache, real credential files under a temp HOME, and the loopback Sheets fake (Driven
// external) holding a tracker that predates Role Family. The existing fake and its helpers are reused unchanged; this
// feature adds only builders and observers beside them. Role Family is appended at the header's old width (widening the
// grid when it is full), written inside the four-kind allow-list in one batch, never touches an operator cell, and the
// first population is not itemised while a later re-classification is. Subprocess layer: example-only (Mandate 11).
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { assertStateDelta, appendedWith, setTo, unchanged } from '../../common/state-delta.mjs';
import { MAX_BATCH_BYTES } from '../../../src/core/sheets-requests.mjs';
import { withLoopbackFake } from '../sheets-api-target/support/sheets-fake.mjs';
import { GOLDEN_TITLES } from './support/golden-titles.mjs';
import {
  ALLOWED_REQUEST_TYPES,
  FamilyName,
  LEGACY_GRID_WIDTH,
  LEGACY_JOBS_HEADER,
  ROLE_FAMILY_COLUMN,
  SHEET_UNIVERSE,
  STANDARD_COHORT,
  SheetsRefusal,
  aCohortCached,
  aScratchWorkspace,
  aSheetHoldingTheTracker,
  aSheetsCredentialHome,
  columnsWidenedBy,
  columnsWrittenBy,
  familyCountsLineOf,
  headerCellsWrittenBy,
  jobsCellsWrittenBy,
  observeSheet,
  operatorBuildsIntoTheSheet,
  reportTextOf,
  roleFamilyCorrectionsIn,
  theDataBatch,
  tuningViewOf,
  useWorkspaceCleanup,
} from './support/role-family-domain-types.mjs';

useWorkspaceCleanup();

const FOUR_KINDS = Object.freeze(['addSheet', 'appendCells', 'appendDimension', 'updateCells']);
const [SCRUM, PRODUCT_OWNER, DATA_ANALYST] = STANDARD_COHORT;
const holdsThat = (description, test) => ({ description, holds: (before, after) => test(before, after) });
const allUnchanged = (names) => Object.fromEntries(names.map((name) => [name, unchanged()]));

/** The operator's Sheet as it stands in Drive, holding the cohort as the harvester last wrote it. */
function aSheetHolding(workspace, cohort, { header = LEGACY_JOBS_HEADER, held, grid } = {}) {
  const { cached, expected, rows } = aCohortCached(workspace, cohort, { held });
  return { fake: aSheetHoldingTheTracker({ header, rows, grid }), cached, expected };
}

/** Runs `build --target sheets` against the fake behind a real loopback socket, with the operator's credentials in a temp HOME. */
const operatorBuilds = (fake, workspace, ...args) => withLoopbackFake(fake, (baseUrl) => operatorBuildsIntoTheSheet(workspace, aSheetsCredentialHome(), baseUrl, ...args));
const headerAfter = (fake) => observeSheet(fake)['jobs.header'];

describe('@driving_adapter harvest build --target sheets adds Role Family to the operator\'s Google Sheet', () => {
  it('@walking_skeleton @driving_adapter @real-io Operator builds into their Google Sheet and finds every advert grouped under a role family, their notes untouched', async () => {
    // Given the operator's Sheet predates the column and holds their Status and qualifications, and four adverts are cached
    const workspace = aScratchWorkspace();
    const { fake, expected } = aSheetHolding(workspace, STANDARD_COHORT);
    const before = observeSheet(fake);

    // When the operator builds into the Sheet
    const result = await operatorBuilds(fake, workspace);

    // Then Role Family arrives after the last column, each advert carries its family, the grid grew to hold it, and nothing the operator typed moved
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('harvest build: merged');
    assertStateDelta(before, observeSheet(fake), {
      universe: SHEET_UNIVERSE,
      expected: {
        'jobs.header': appendedWith(ROLE_FAMILY_COLUMN),
        'jobs.roleFamilyByKey': setTo(expected),
        'jobs.gridColumns': holdsThat('the grid grew by at least the one column', (b, a) => a >= b + 1),
      },
    });
    // And the run names the one advert that fell through, and itemises no correction for the first population
    expect(tuningViewOf(result.stderr)).toEqual({ other: 1, total: 4, entries: [{ count: 1, title: 'data analyst' }] });
    expect(result.stderr).toMatch(/no derived corrections/);
  });

  it('@error the grid is exactly as wide as the old header, so the build widens it and writes the header at the old width', async () => {
    // Given a Sheet whose header is the old 26 columns in a grid of exactly 26
    const workspace = aScratchWorkspace();
    const { fake } = aSheetHolding(workspace, STANDARD_COHORT);
    expect(observeSheet(fake)['jobs.gridColumns']).toBe(LEGACY_GRID_WIDTH);
    // When the operator builds
    const result = await operatorBuilds(fake, workspace);
    // Then the grid is widened, and the new header cell is written in the first column past the old header
    expect(result.status, result.stderr).toBe(0);
    const batch = theDataBatch(fake);
    expect(batch.requestTypes).toContain('appendDimension');
    expect(columnsWidenedBy(batch)).toBeGreaterThanOrEqual(1);
    expect(headerCellsWrittenBy(batch)).toEqual([{ columnIndex: LEGACY_GRID_WIDTH, value: ROLE_FAMILY_COLUMN }]);
    expect(observeSheet(fake)['jobs.gridColumns']).toBeGreaterThanOrEqual(LEGACY_GRID_WIDTH + 1);
  });

  it('@error a column the operator added lies between the old header and the new one, so Role Family goes after it, widening the grid', async () => {
    const workspace = aScratchWorkspace();
    const { fake } = aSheetHolding(workspace, STANDARD_COHORT, { header: [...LEGACY_JOBS_HEADER, 'My Notes'] });
    const before = observeSheet(fake);
    const result = await operatorBuilds(fake, workspace);
    expect(result.status, result.stderr).toBe(0);
    expect(headerCellsWrittenBy(theDataBatch(fake))).toEqual([{ columnIndex: LEGACY_GRID_WIDTH + 1, value: ROLE_FAMILY_COLUMN }]);
    expect(columnsWidenedBy(theDataBatch(fake))).toBeGreaterThanOrEqual(1);
    assertStateDelta(before, observeSheet(fake), {
      universe: SHEET_UNIVERSE,
      expected: { 'jobs.header': appendedWith(ROLE_FAMILY_COLUMN), 'jobs.roleFamilyByKey': holdsThat('every advert has a family', (_b, a) => Object.values(a).every((family) => typeof family === 'string')), 'jobs.gridColumns': holdsThat('the grid grew', (b, a) => a > b) },
    });
    expect(headerAfter(fake).slice(-2)).toEqual(['My Notes', ROLE_FAMILY_COLUMN]);
  });

  it('@error a Sheet with a spare column needs no widening: the header cell is written in the first free column', async () => {
    // Given a Sheet whose operator deleted a human-owned column, leaving room in the grid
    const workspace = aScratchWorkspace();
    const withoutDayRate = LEGACY_JOBS_HEADER.filter((column) => column !== 'Day Rate');
    const { fake } = aSheetHolding(workspace, STANDARD_COHORT, { header: withoutDayRate });
    const before = observeSheet(fake);
    // When the operator builds
    const result = await operatorBuilds(fake, workspace);
    // Then the grid is left as it was
    expect(result.status, result.stderr).toBe(0);
    const batch = theDataBatch(fake);
    expect(batch.requestTypes).not.toContain('appendDimension');
    expect(headerCellsWrittenBy(batch)).toEqual([{ columnIndex: withoutDayRate.length, value: ROLE_FAMILY_COLUMN }]);
    assertStateDelta(before, observeSheet(fake), {
      universe: SHEET_UNIVERSE,
      expected: { 'jobs.header': appendedWith(ROLE_FAMILY_COLUMN), 'jobs.roleFamilyByKey': holdsThat('every advert has a family', (_b, a) => Object.values(a).every((family) => typeof family === 'string')) },
    });
  });

  it('@error the whole change is one batch, every request is one of the four allowed kinds, and the only column it writes is Role Family', async () => {
    const workspace = aScratchWorkspace();
    const { fake } = aSheetHolding(workspace, STANDARD_COHORT);
    const result = await operatorBuilds(fake, workspace);
    expect(result.status, result.stderr).toBe(0);
    expect(fake.requestsTo('batch-update')).toHaveLength(1);
    expect(fake.writeRequests().every((request) => request.route === 'batch-update')).toBe(true);
    const batch = theDataBatch(fake);
    expect([...new Set(batch.requestTypes)].every((kind) => FOUR_KINDS.includes(kind))).toBe(true);
    expect([...ALLOWED_REQUEST_TYPES].sort()).toEqual([...FOUR_KINDS]);
    expect(columnsWrittenBy(batch, headerAfter(fake))).toEqual([ROLE_FAMILY_COLUMN]);
  });

  it('@error about 3,050 adverts are written in one batch within the limit, and none is refused as too large', async () => {
    // Given a Sheet holding 3,050 adverts that predates the column, and a cache of the same 3,050
    const workspace = aScratchWorkspace();
    const cohort = Array.from({ length: 3050 }, (_, index) => GOLDEN_TITLES[index % GOLDEN_TITLES.length]);
    const { fake, expected } = aSheetHolding(workspace, cohort);
    const before = observeSheet(fake);
    // When the operator builds
    const result = await operatorBuilds(fake, workspace);
    // Then one batch within the limit writes every family
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toContain(SheetsRefusal.PLAN_TOO_LARGE);
    expect(fake.requestsTo('batch-update')).toHaveLength(1);
    expect(theDataBatch(fake).bytes).toBeLessThan(MAX_BATCH_BYTES);
    assertStateDelta(before, observeSheet(fake), {
      universe: SHEET_UNIVERSE,
      expected: { 'jobs.header': appendedWith(ROLE_FAMILY_COLUMN), 'jobs.roleFamilyByKey': setTo(expected), 'jobs.gridColumns': holdsThat('the grid grew', (b, a) => a > b) },
    });
  }, 120_000);
});

describe('@driving_adapter harvest build --target sheets reports the column as the design settled', () => {
  it('@error the first population is not itemised: stdout counts the appended column, stderr says no derived corrections, the report holds nothing about it', async () => {
    const workspace = aScratchWorkspace();
    const { fake } = aSheetHolding(workspace, STANDARD_COHORT);
    const report = join(workspace, 'changes.txt');
    const result = await operatorBuilds(fake, workspace, '--report', report);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Jobs: rows updated: 4, rows appended: 0, columns appended: 1, cell changes: 4/);
    expect(result.stderr).toMatch(/no derived corrections/);
    expect(roleFamilyCorrectionsIn(result.stderr)).toEqual([]);
    expect(roleFamilyCorrectionsIn(reportTextOf(report))).toEqual([]);
  });

  it('@error a later re-classification is itemised, one line per changed advert, and only those cells are written', async () => {
    // Given a Sheet whose Role Family column holds two stale families and two right ones
    const workspace = aScratchWorkspace();
    const held = (expected, cached) => ({ [cached[0].key]: FamilyName.OTHER, [cached[1].key]: expected[cached[1].key], [cached[2].key]: FamilyName.AGILE_COACH, [cached[3].key]: expected[cached[3].key] });
    const { fake, cached, expected } = aSheetHolding(workspace, STANDARD_COHORT, { header: [...LEGACY_JOBS_HEADER, ROLE_FAMILY_COLUMN], held });
    const report = join(workspace, 'changes.txt');
    const before = observeSheet(fake);
    // When the operator builds
    const result = await operatorBuilds(fake, workspace, '--report', report);
    // Then the two stale cells are corrected, itemised in stderr and the report, and nothing else is written
    expect(result.status, result.stderr).toBe(0);
    assertStateDelta(before, observeSheet(fake), { universe: SHEET_UNIVERSE, expected: { 'jobs.roleFamilyByKey': setTo(expected) } });
    const itemised = [
      { key: cached[0].key, from: FamilyName.OTHER, to: FamilyName.SCRUM_MASTER },
      { key: cached[2].key, from: FamilyName.AGILE_COACH, to: FamilyName.OTHER },
    ];
    expect(roleFamilyCorrectionsIn(result.stderr)).toEqual(itemised);
    expect(roleFamilyCorrectionsIn(reportTextOf(report))).toEqual(itemised);
    expect(result.stdout).toMatch(/columns appended: 0/);
    expect(jobsCellsWrittenBy(theDataBatch(fake))).toBe(2);
    expect(columnsWrittenBy(theDataBatch(fake), headerAfter(fake))).toEqual([ROLE_FAMILY_COLUMN]);
  });

  it('@error a Role Family column the operator created by hand, and moved beside Status, is filled where it stands: nothing appended, each filled cell itemised', async () => {
    // Given a Sheet whose operator added an empty Role Family column beside Status
    const workspace = aScratchWorkspace();
    const besideStatus = [LEGACY_JOBS_HEADER[0], ROLE_FAMILY_COLUMN, ...LEGACY_JOBS_HEADER.slice(1)];
    const { fake, cached, expected } = aSheetHolding(workspace, STANDARD_COHORT, { header: besideStatus, held: () => ({}) });
    const before = observeSheet(fake);
    // When the operator previews, then builds
    const preview = await operatorBuilds(fake, workspace, '--dry-run');
    const built = await operatorBuilds(fake, workspace);
    // Then the preview appends nothing, the header is as the operator left it, and each cell is filled in place
    expect(preview.status, preview.stderr).toBe(0);
    expect(preview.stdout).toMatch(/columns to append: 0/);
    expect(built.status, built.stderr).toBe(0);
    assertStateDelta(before, observeSheet(fake), { universe: SHEET_UNIVERSE, expected: { 'jobs.roleFamilyByKey': setTo(expected) } });
    expect(roleFamilyCorrectionsIn(built.stderr).map(({ key, from, to }) => [key, from, to])).toEqual(cached.map(({ key }) => [key, '(blank)', expected[key]]));
  });

  it('@error a second build sends no batch at all and changes nothing', async () => {
    // Given a Sheet that the first build has already given the column
    const workspace = aScratchWorkspace();
    const { fake, expected } = aSheetHolding(workspace, STANDARD_COHORT);
    const first = await operatorBuilds(fake, workspace);
    expect(first.status, first.stderr).toBe(0);
    expect(observeSheet(fake)['jobs.roleFamilyByKey']).toEqual(expected);
    const before = observeSheet(fake);
    const second = await operatorBuilds(fake, workspace);
    expect(second.status, second.stderr).toBe(0);
    assertStateDelta(before, observeSheet(fake), { universe: SHEET_UNIVERSE, expected: allUnchanged(SHEET_UNIVERSE) });
    expect(fake.requestsTo('batch-update')).toHaveLength(1);
    expect(second.stdout).toMatch(/Jobs: rows updated: 4, rows appended: 0, columns appended: 0, cell changes: 0/);
    expect(second.stderr).toMatch(/no derived corrections/);
  });
});

describe('@driving_adapter harvest build --target sheets --dry-run previews the column and writes nothing', () => {
  // @contract-shape:unbounded-preservation
  it('@error the preview names the column it would append, prints the tuning view, and the fake records no write request', async () => {
    const workspace = aScratchWorkspace();
    const { fake } = aSheetHolding(workspace, STANDARD_COHORT);
    const before = observeSheet(fake);
    const result = await operatorBuilds(fake, workspace, '--dry-run');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/columns to append: 1 \(Role Family\)/);
    expect(result.stdout).toMatch(/cell changes: 4/);
    expect(tuningViewOf(result.stderr)).toEqual({ other: 1, total: 4, entries: [{ count: 1, title: 'data analyst' }] });
    expect(fake.writeRequests()).toEqual([]);
    assertStateDelta(before, observeSheet(fake), { universe: SHEET_UNIVERSE, expected: allUnchanged(SHEET_UNIVERSE) });
  });
});

describe('@driving_adapter harvest build --target sheets refuses what could misplace the column', () => {
  // @contract-shape:unbounded-preservation
  it('@error a Sheet naming Role Family twice is refused as a duplicate header, and nothing is written', async () => {
    const workspace = aScratchWorkspace();
    const { fake } = aSheetHolding(workspace, STANDARD_COHORT, { header: [...LEGACY_JOBS_HEADER, ROLE_FAMILY_COLUMN, ROLE_FAMILY_COLUMN] });
    const before = observeSheet(fake);
    const result = await operatorBuilds(fake, workspace);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(SheetsRefusal.DUPLICATE_HEADER);
    expect(result.stderr).toContain(ROLE_FAMILY_COLUMN);
    expect(fake.writeRequests()).toEqual([]);
    assertStateDelta(before, observeSheet(fake), { universe: SHEET_UNIVERSE, expected: allUnchanged(SHEET_UNIVERSE) });
  });
});

describe('@driving_adapter harvest build --target sheets shows the most frequent other titles', () => {
  it('@error a build prints the tuning view on stderr only, and the report stays empty when the Sheet was already up to date', async () => {
    // Given a Sheet that already holds every family, and adverts that fall through
    const workspace = aScratchWorkspace();
    const cohort = [DATA_ANALYST, { title: 'DATA ANALYST', family: FamilyName.OTHER }, SCRUM, PRODUCT_OWNER];
    const { fake } = aSheetHolding(workspace, cohort, { header: [...LEGACY_JOBS_HEADER, ROLE_FAMILY_COLUMN], held: (expected) => expected });
    const report = join(workspace, 'changes.txt');
    // When the operator builds and asks for the report
    const result = await operatorBuilds(fake, workspace, '--report', report);
    // Then stderr carries the view and the per-family counts, stdout does not, and the report is empty
    expect(result.status, result.stderr).toBe(0);
    expect(tuningViewOf(result.stderr)).toEqual({ other: 2, total: 4, entries: [{ count: 2, title: 'data analyst' }] });
    expect(familyCountsLineOf(result.stderr)).toMatch(/other\D+2\b/);
    expect(result.stdout).not.toMatch(/classified other/);
    expect(reportTextOf(report)).toBe('');
    expect(jobsCellsWrittenBy(theDataBatch(fake))).toBe(0);
  });

  it('@error the view says nothing when every advert has a family', async () => {
    const workspace = aScratchWorkspace();
    const { fake, expected } = aSheetHolding(workspace, [SCRUM, PRODUCT_OWNER]);
    const result = await operatorBuilds(fake, workspace);
    expect(result.status, result.stderr).toBe(0);
    expect(observeSheet(fake)['jobs.roleFamilyByKey']).toEqual(expected);
    expect(tuningViewOf(result.stderr)).toBeNull();
    expect(familyCountsLineOf(result.stderr)).toBeNull();
  });
});
