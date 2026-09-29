// @contract-shape:bounded-change
// DR-0012 / DESIGN Q2-Q4: the Sheets writer applies the merge plan for all three tabs as ONE spreadsheets.batchUpdate,
// with every row and column resolved from a fresh read immediately before the write. Universe of change: the harvester-
// owned cells of the recorded Sheet, appended rows and columns, new tabs, and row-key metadata. Nothing a person typed
// moves. Adapter level: an injected fetch over the Sheets fake; example-only, sad paths enumerated (Mandate 9, 11).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planMergeAll } from '../../../src/core/merge.mjs';
import {
  HUMAN_COLUMNS,
  JOBS_WITH_NOTES,
  KEY_COLUMN,
  PROJECT_ROOT,
  SheetsRefusal,
  SheetsWarning,
  TRACKER_UNIVERSE,
  UNKNOWN_COLUMNS,
  aCompanyRow,
  aHarvest,
  aHarvestedJob,
  aSheetsTarget,
  aSourceRow,
  aTrackedJob,
  aTrackerFake,
  columnsByKey,
  dataBatches,
  harvesterCellsOf,
  mergeHarvest,
  metadataBatches,
  noSecretsIn,
  observeTracker,
  refusalOfAsync,
  tabRows,
} from './support/sheets-domain-types.mjs';
import { createSheetsFake, forbiddenFor, json, rateLimited, serverError } from './support/sheets-fake.mjs';
import { assertStateDelta, appendedWith, setTo, unchanged } from '../../common/state-delta.mjs';
import { scenario } from './support/red-gate.mjs';

const JUDGEMENT_COLUMNS = [...HUMAN_COLUMNS, ...UNKNOWN_COLUMNS];
const blankJudgement = () => Object.fromEntries(JUDGEMENT_COLUMNS.map((column) => [column, null]));
const allUnchanged = (names) => Object.fromEntries(names.map((name) => [name, unchanged()]));
const plainTracker = (options = {}) => aTrackerFake({ jobs: [aTrackedJob('1', { Status: 'Applied' }), aTrackedJob('2', { Status: 'Interview' })], ...options });
const retitled = (id, title) => aHarvestedJob(String(id), { Job: title });
const applying = (wired, harvest) => mergeHarvest(wired, harvest, planMergeAll);
const metadataOnly = (request) => request.requestTypes.length > 0 && request.requestTypes.every((type) => type === 'createDeveloperMetadata');
const asJson = (value) => JSON.stringify(value);

describe('apply merges the harvest into the operator Sheet in one batch', () => {
  scenario('@real-io @adapter-integration one batch merges three tabs: harvester cells change, new rows are appended, no human or unknown cell moves', async () => {
    // Given the operator's tracker holds two jobs with their own Status and notes, one company and one saved search
    const fake = aTrackerFake();
    const wired = aSheetsTarget({ fake });
    const before = observeTracker(fake);
    const harvest = aHarvest({
      jobs: [aHarvestedJob('1', { Job: 'New title' }), aHarvestedJob('3')],
      companies: [aCompanyRow('Acme Ltd', { 'Jobs Seen': 2 }), aCompanyRow('Beta Ltd')],
      sources: [aSourceRow('agile coach', { Messages: 5 })],
    });

    // When the harvest is merged
    const receipt = await applying(wired, harvest);

    // Then only the harvester-owned cells changed, the new rows were appended, and each new row is bound to its key
    assertStateDelta(before, observeTracker(fake), {
      universe: TRACKER_UNIVERSE,
      expected: {
        'jobs.header': unchanged(),
        'jobs.keys': appendedWith('linkedin:3'),
        'jobs.judgement': setTo({ ...before['jobs.judgement'], 'linkedin:3': blankJudgement() }),
        'jobs.harvesterCells': setTo({
          ...before['jobs.harvesterCells'],
          'linkedin:1': harvesterCellsOf(aHarvestedJob('1', { Job: 'New title' })),
          'linkedin:3': harvesterCellsOf(aHarvestedJob('3')),
        }),
        'companies.rows': setTo([aCompanyRow('Acme Ltd', { 'Jobs Seen': 2 }), aCompanyRow('Beta Ltd')]),
        'sources.rows': setTo([aSourceRow('agile coach', { Messages: 5 })]),
        'sheet.tabNames': unchanged(),
        'sheet.rowKeyBindings': setTo({ Jobs: ['linkedin:1', 'linkedin:2', 'linkedin:3'], Companies: ['Acme Ltd', 'Beta Ltd'], Sources: ['["LinkedIn","agile coach"]'] }),
        'drive.files': unchanged(),
      },
    });
    expect(dataBatches(fake)).toHaveLength(1);
    expect(receipt).toMatchObject({ inputDigest: null, outputDigest: null, appendsSkippedAsPresent: 0, warnings: [] });
    expect(fake.batchRequestTypes().every((type) => ['updateCells', 'appendCells', 'appendDimension', 'addSheet', 'createDeveloperMetadata'].includes(type))).toBe(true);
    expect(new Date(receipt.appliedAt).toString()).not.toBe('Invalid Date');
  });

  scenario('a tab the Sheet lacks is created in the same batch, with its header and rows', async () => {
    const fake = aTrackerFake({ companies: null, sources: null });
    const wired = aSheetsTarget({ fake });
    const before = observeTracker(fake);

    await applying(wired, aHarvest({ jobs: [], companies: [aCompanyRow('Acme Ltd')], sources: [aSourceRow('agile coach')] }));

    assertStateDelta(before, observeTracker(fake), {
      universe: TRACKER_UNIVERSE,
      expected: {
        'jobs.header': unchanged(),
        'jobs.keys': unchanged(),
        'jobs.judgement': unchanged(),
        'jobs.harvesterCells': unchanged(),
        'companies.rows': setTo([aCompanyRow('Acme Ltd')]),
        'sources.rows': setTo([aSourceRow('agile coach')]),
        'sheet.tabNames': appendedWith('Companies', 'Sources'),
        'sheet.rowKeyBindings': setTo({ Jobs: ['linkedin:1', 'linkedin:2'], Companies: ['Acme Ltd'], Sources: ['["LinkedIn","agile coach"]'] }),
        'drive.files': unchanged(),
      },
    });
    expect(dataBatches(fake)).toHaveLength(1);
    expect(dataBatches(fake)[0].requestTypes.filter((type) => type === 'addSheet')).toHaveLength(2);
    expect(tabRows(fake.snapshot(), 'Companies').header).toEqual(Object.keys(aCompanyRow('x')));
  });

  scenario('merging the same harvest again changes nothing and sends no data batch', async () => {
    const fake = aTrackerFake();
    const wired = aSheetsTarget({ fake });
    const harvest = aHarvest({ jobs: [retitled(1, 'New title')], companies: [aCompanyRow('Acme Ltd', { 'Jobs Seen': 2 })], sources: [aSourceRow('agile coach')] });
    await applying(wired, harvest);
    const before = observeTracker(fake);
    const batchesBefore = dataBatches(fake).length;

    const receipt = await applying(wired, harvest);

    assertStateDelta(before, observeTracker(fake), { universe: TRACKER_UNIVERSE, expected: allUnchanged(TRACKER_UNIVERSE) });
    expect(dataBatches(fake)).toHaveLength(batchesBefore);
    expect(receipt.cellsWritten).toBe(0);
  });

  scenario('a cell already holding the planned value is not written: one changed title is one cell written', async () => {
    const fake = plainTracker({ companies: [], sources: [] });
    const wired = aSheetsTarget({ fake });

    const receipt = await applying(wired, aHarvest({ jobs: [retitled(1, 'Retitled')] }));

    expect(receipt.cellsWritten).toBe(1);
    expect(columnsByKey(fake.snapshot(), 'Jobs', KEY_COLUMN, ['Job'])['linkedin:1']).toEqual({ Job: 'Retitled' });
  });

  scenario('a null planned value clears the cell, as the offline tracker does', async () => {
    const fake = plainTracker({ companies: [], sources: [] });
    const wired = aSheetsTarget({ fake });

    await applying(wired, aHarvest({ jobs: [aHarvestedJob('1', { Location: null }), aHarvestedJob('2')] }));

    expect(columnsByKey(fake.snapshot(), 'Jobs', KEY_COLUMN, ['Location'])).toEqual({ 'linkedin:1': { Location: null }, 'linkedin:2': { Location: 'United Kingdom' } });
  });

  scenario('a cell format a person set survives the write of its value', async () => {
    const fake = plainTracker({ companies: [], sources: [] });
    fake.formatColumn('Jobs', 'Job', '0.00');
    const wired = aSheetsTarget({ fake });

    await applying(wired, aHarvest({ jobs: [retitled(1, 'Retitled')] }));

    expect(fake.formatAt('Jobs', 1, 'Job')).toBe('0.00');
    expect(columnsByKey(fake.snapshot(), 'Jobs', KEY_COLUMN, ['Job'])['linkedin:1']).toEqual({ Job: 'Retitled' });
  });

  scenario('an unknown extra tab is left exactly as it was', async () => {
    const fake = createSheetsFake({ tabs: { Jobs: { header: JOBS_WITH_NOTES, rows: [aTrackedJob('1')] }, Notes: { header: ['Thoughts'], rows: [['keep me']] } } });
    const wired = aSheetsTarget({ fake });
    const notes = () => ({ 'notes.cells': fake.snapshot().tabs.Notes.cells, 'notes.grid': fake.snapshot().tabs.Notes.grid });
    const before = notes();

    await applying(wired, aHarvest({ jobs: [retitled(1, 'Retitled'), aHarvestedJob('9')] }));

    assertStateDelta(before, notes(), { universe: ['notes.cells', 'notes.grid'], expected: allUnchanged(['notes.cells', 'notes.grid']) });
  });
});

describe('the Sheet is laid out by a person: columns are found by name, every run', () => {
  scenario('a column the operator reordered is still written by its header', async () => {
    const fake = plainTracker({ companies: [], sources: [] });
    fake.humanReordersColumns('Jobs', [...JOBS_WITH_NOTES].reverse());
    const wired = aSheetsTarget({ fake });
    const before = observeTracker(fake);

    await applying(wired, aHarvest({ jobs: [retitled(1, 'Retitled')] }));

    assertStateDelta(before, observeTracker(fake), {
      universe: ['jobs.header', 'jobs.keys', 'jobs.judgement'],
      expected: allUnchanged(['jobs.header', 'jobs.keys', 'jobs.judgement']),
    });
    expect(columnsByKey(fake.snapshot(), 'Jobs', KEY_COLUMN, ['Job'])['linkedin:1']).toEqual({ Job: 'Retitled' });
  });

  scenario('a column the operator added is preserved, values and all', async () => {
    const fake = plainTracker({ companies: [], sources: [] });
    fake.humanAddsColumn('Jobs', 'Recruiter Phone', [null, '020 7946 0000', '020 7946 0001']);
    const wired = aSheetsTarget({ fake });
    const before = observeTracker(fake);

    await applying(wired, aHarvest({ jobs: [retitled(1, 'Retitled'), aHarvestedJob('2')] }));

    assertStateDelta(before, observeTracker(fake), {
      universe: ['jobs.header', 'jobs.judgement'],
      expected: { 'jobs.header': unchanged(), 'jobs.judgement': unchanged() },
    });
    expect(columnsByKey(fake.snapshot(), 'Jobs', KEY_COLUMN, ['Recruiter Phone'])['linkedin:2']).toEqual({ 'Recruiter Phone': '020 7946 0001' });
  });

  scenario('a harvester column the operator renamed is re-added at the right, and the renamed column is kept as an unknown column', async () => {
    const fake = plainTracker({ companies: [], sources: [] });
    fake.humanRenamesHeader('Jobs', 'Fit Score', 'Score');
    const wired = aSheetsTarget({ fake });
    const before = observeTracker(fake);

    await applying(wired, aHarvest({ jobs: [aHarvestedJob('1'), aHarvestedJob('2')] }));

    assertStateDelta(before, observeTracker(fake), {
      universe: ['jobs.header', 'jobs.keys', 'jobs.judgement'],
      expected: { 'jobs.header': appendedWith('Fit Score'), 'jobs.keys': unchanged(), 'jobs.judgement': unchanged() },
    });
    expect(columnsByKey(fake.snapshot(), 'Jobs', KEY_COLUMN, ['Score', 'Fit Score'])['linkedin:1']).toEqual({ Score: 3, 'Fit Score': 3 });
  });

  scenario('a harvester column the operator deleted is re-added at the right and filled for every keyed row', async () => {
    const fake = plainTracker({ companies: [], sources: [] });
    fake.humanDeletesColumn('Jobs', 'Location');
    const wired = aSheetsTarget({ fake });
    const before = observeTracker(fake);

    await applying(wired, aHarvest({ jobs: [aHarvestedJob('1'), aHarvestedJob('2')] }));

    assertStateDelta(before, observeTracker(fake), {
      universe: ['jobs.header', 'jobs.keys', 'jobs.judgement'],
      expected: { 'jobs.header': appendedWith('Location'), 'jobs.keys': unchanged(), 'jobs.judgement': unchanged() },
    });
    expect(columnsByKey(fake.snapshot(), 'Jobs', KEY_COLUMN, ['Location'])).toEqual({ 'linkedin:1': { Location: 'United Kingdom' }, 'linkedin:2': { Location: 'United Kingdom' } });
  });

  scenario('@error the key column renamed between read and apply refuses sheets.key-column-missing and writes nothing', async () => {
    const fake = plainTracker({ companies: [], sources: [] });
    const wired = aSheetsTarget({ fake });
    const plans = planMergeAll(await wired.writer.read(), aHarvest({ jobs: [retitled(1, 'Retitled')] }));
    fake.humanRenamesHeader('Jobs', KEY_COLUMN, 'Key');
    const before = observeTracker(fake);

    const refusal = await refusalOfAsync(() => wired.writer.apply(plans));

    expect(refusal?.code).toBe(SheetsRefusal.KEY_COLUMN_MISSING);
    assertStateDelta(before, observeTracker(fake), { universe: TRACKER_UNIVERSE, expected: allUnchanged(TRACKER_UNIVERSE) });
    expect(dataBatches(fake)).toEqual([]);
  });

  scenario('@error a column the plan updates vanishing between read and apply refuses sheets.header-changed and writes nothing', async () => {
    const fake = plainTracker({ companies: [], sources: [] });
    const wired = aSheetsTarget({ fake });
    const plans = planMergeAll(await wired.writer.read(), aHarvest({ jobs: [retitled(1, 'Retitled')] }));
    fake.humanDeletesColumn('Jobs', 'Job');
    const before = observeTracker(fake);

    const refusal = await refusalOfAsync(() => wired.writer.apply(plans));

    expect(refusal?.code).toBe(SheetsRefusal.HEADER_CHANGED);
    assertStateDelta(before, observeTracker(fake), { universe: TRACKER_UNIVERSE, expected: allUnchanged(TRACKER_UNIVERSE) });
  });

  scenario('@error a key column or harvester column named twice refuses sheets.duplicate-header and writes nothing', async () => {
    const fake = plainTracker({ companies: [], sources: [], jobsHeader: [...JOBS_WITH_NOTES, 'Job'] });
    const wired = aSheetsTarget({ fake });
    const before = observeTracker(fake);

    const refusal = await refusalOfAsync(() => applying(wired, aHarvest({ jobs: [retitled(1, 'Retitled')] })));

    expect(refusal?.code).toBe(SheetsRefusal.DUPLICATE_HEADER);
    assertStateDelta(before, observeTracker(fake), { universe: TRACKER_UNIVERSE, expected: allUnchanged(TRACKER_UNIVERSE) });
  });
});

describe('a person keeps working in the Sheet while the merge runs', () => {
  scenario('a sort between read and apply does not misdirect a write: each key gets its own value', async () => {
    const fake = plainTracker({ companies: [], sources: [] });
    const wired = aSheetsTarget({ fake });
    const plans = planMergeAll(await wired.writer.read(), aHarvest({ jobs: [retitled(1, 'Retitled 1'), retitled(2, 'Retitled 2')] }));
    fake.humanSortsRows('Jobs', KEY_COLUMN, { descending: true });
    const before = observeTracker(fake);

    await wired.writer.apply(plans);

    assertStateDelta(before, observeTracker(fake), {
      universe: ['jobs.keys', 'jobs.judgement'],
      expected: allUnchanged(['jobs.keys', 'jobs.judgement']),
    });
    expect(columnsByKey(fake.snapshot(), 'Jobs', KEY_COLUMN, ['Job'])).toEqual({ 'linkedin:1': { Job: 'Retitled 1' }, 'linkedin:2': { Job: 'Retitled 2' } });
  });

  scenario('a row inserted between read and apply pushes rows down, and no write lands on the wrong row or on the inserted row', async () => {
    const fake = plainTracker({ companies: [], sources: [] });
    const wired = aSheetsTarget({ fake });
    const plans = planMergeAll(await wired.writer.read(), aHarvest({ jobs: [retitled(1, 'Retitled 1'), retitled(2, 'Retitled 2')] }));
    fake.humanInsertsRow('Jobs', 1, { Job: 'hand-typed lead' });
    const before = observeTracker(fake);

    await wired.writer.apply(plans);

    assertStateDelta(before, observeTracker(fake), { universe: ['jobs.keys', 'jobs.judgement'], expected: allUnchanged(['jobs.keys', 'jobs.judgement']) });
    const rows = tabRows(fake.snapshot(), 'Jobs').rows;
    expect(rows.find((row) => row[KEY_COLUMN] === null)?.Job).toBe('hand-typed lead');
    expect(columnsByKey(fake.snapshot(), 'Jobs', KEY_COLUMN, ['Job'])).toEqual({ 'linkedin:1': { Job: 'Retitled 1' }, 'linkedin:2': { Job: 'Retitled 2' } });
  });

  scenario('a row typed into the Sheet at the last second is never overwritten: appended rows land below it', async () => {
    const fake = plainTracker({ companies: [], sources: [] });
    const wired = aSheetsTarget({ fake });
    fake.beforeNext('batch-update', (human) => human.humanAppendsRow('Jobs', { Job: 'typed at the last second' }));

    await applying(wired, aHarvest({ jobs: [aHarvestedJob('3')] }));

    const rows = tabRows(fake.snapshot(), 'Jobs').rows;
    const typed = rows.findIndex((row) => row.Job === 'typed at the last second');
    const appended = rows.findIndex((row) => row[KEY_COLUMN] === 'linkedin:3');
    expect([rows[typed][KEY_COLUMN], appended > typed]).toEqual([null, true]);
    expect(fake.snapshot().tabs.Jobs.metadata.find((meta) => meta.value === 'linkedin:3').rowIndex).toBe(appended + 1);
  });

  scenario('a human-owned cell edited mid-run keeps the operator value', async () => {
    const fake = plainTracker({ companies: [], sources: [] });
    const wired = aSheetsTarget({ fake });
    fake.beforeNext('batch-update', (human) => human.humanEditsCell('Jobs', 1, 'Status', 'Offer'));
    const before = observeTracker(fake);

    await applying(wired, aHarvest({ jobs: [retitled(1, 'Retitled')] }));

    assertStateDelta(before, observeTracker(fake), {
      universe: ['jobs.judgement', 'jobs.keys'],
      expected: { 'jobs.keys': unchanged(), 'jobs.judgement': setTo({ ...before['jobs.judgement'], 'linkedin:1': { ...before['jobs.judgement']['linkedin:1'], Status: 'Offer' } }) },
    });
  });

  scenario('@error a hand-typed row with no key is never matched and never given a key binding', async () => {
    const fake = plainTracker({ companies: [], sources: [] });
    fake.humanAppendsRow('Jobs', { Job: 'a lead from a friend', 'Qualified?': 'Yes' });
    const wired = aSheetsTarget({ fake });
    const before = observeTracker(fake);

    await applying(wired, aHarvest({ jobs: [aHarvestedJob('1'), aHarvestedJob('2')] }));

    assertStateDelta(before, observeTracker(fake), {
      universe: ['jobs.keys', 'jobs.judgement', 'sheet.rowKeyBindings'],
      expected: allUnchanged(['jobs.keys', 'jobs.judgement', 'sheet.rowKeyBindings']),
    });
    expect(tabRows(fake.snapshot(), 'Jobs').rows.find((row) => row.Job === 'a lead from a friend')).toMatchObject({ 'Qualified?': 'Yes', [KEY_COLUMN]: null });
  });
});

describe('the whole apply is refused, and nothing is written, when the Sheet is ambiguous (OQ-3)', () => {
  scenario('@error one key on two rows refuses sheets.duplicate-key, naming the key', async () => {
    const fake = plainTracker({ companies: [], sources: [] });
    fake.humanAppendsRow('Jobs', aTrackedJob('1'));
    const wired = aSheetsTarget({ fake });
    const before = observeTracker(fake);

    const refusal = await refusalOfAsync(() => applying(wired, aHarvest({ jobs: [retitled(1, 'Retitled')] })));

    expect(refusal?.code).toBe(SheetsRefusal.DUPLICATE_KEY);
    expect(refusal.message).toContain('linkedin:1');
    assertStateDelta(before, observeTracker(fake), { universe: TRACKER_UNIVERSE, expected: allUnchanged(TRACKER_UNIVERSE) });
    expect(fake.writeRequests()).toEqual([]);
  });

  scenario('@error a key that no longer matches its row binding refuses sheets.row-identity-conflict, naming a key', async () => {
    const fake = plainTracker({ companies: [], sources: [] });
    fake.humanEditsCell('Jobs', 1, KEY_COLUMN, 'linkedin:2');
    fake.humanEditsCell('Jobs', 2, KEY_COLUMN, 'linkedin:1');
    const wired = aSheetsTarget({ fake });
    const before = observeTracker(fake);

    const refusal = await refusalOfAsync(() => applying(wired, aHarvest({ jobs: [retitled(1, 'Retitled')] })));

    expect(refusal?.code).toBe(SheetsRefusal.ROW_IDENTITY_CONFLICT);
    expect(refusal.message).toMatch(/linkedin:[12]/);
    assertStateDelta(before, observeTracker(fake), { universe: TRACKER_UNIVERSE, expected: allUnchanged(TRACKER_UNIVERSE) });
    expect(fake.writeRequests()).toEqual([]);
  });
});

describe('atomicity and retry: a failure applies nothing, a retry never doubles a row', () => {
  const threeTabHarvest = () =>
    aHarvest({ jobs: [retitled(1, 'Retitled')], companies: [aCompanyRow('Acme Ltd', { 'Jobs Seen': 2 })], sources: [aSourceRow('agile coach', { Messages: 5 })] });

  scenario('@error a batch Google rejects applies nothing on any of the three tabs, and names sheets.request-rejected without a cell value', async () => {
    const fake = aTrackerFake();
    const wired = aSheetsTarget({ fake });
    fake.rejectRequestAt(2);
    const before = observeTracker(fake);
    const snapshotBefore = asJson(fake.snapshot());

    const refusal = await refusalOfAsync(() => applying(wired, threeTabHarvest()));

    expect(refusal?.code).toBe(SheetsRefusal.REQUEST_REJECTED);
    expect(refusal.message).not.toContain('call back');
    expect(noSecretsIn(refusal.message)).toEqual([]);
    assertStateDelta(before, observeTracker(fake), { universe: TRACKER_UNIVERSE, expected: allUnchanged(TRACKER_UNIVERSE) });
    expect(asJson(fake.snapshot())).toBe(snapshotBefore);
  });

  scenario('@error a batch applied but its answer lost is not applied twice: the retry finds the row present and appends nothing', async () => {
    const fake = aTrackerFake();
    const wired = aSheetsTarget({ fake });
    fake.dropResponseAfterApplying();
    const before = observeTracker(fake);

    const receipt = await applying(wired, aHarvest({ jobs: [aHarvestedJob('3')] }));

    assertStateDelta(before, observeTracker(fake), {
      universe: ['jobs.keys', 'jobs.judgement'],
      expected: { 'jobs.keys': appendedWith('linkedin:3'), 'jobs.judgement': setTo({ ...before['jobs.judgement'], 'linkedin:3': blankJudgement() }) },
    });
    expect(dataBatches(fake)).toHaveLength(1);
    expect(receipt.appendsSkippedAsPresent).toBe(1);
  });

  scenario('@error every attempt is re-verified against a fresh read before its write, first or retried', async () => {
    const fake = aTrackerFake();
    const wired = aSheetsTarget({ fake });
    fake.override('batch-update', () => serverError(503));

    await refusalOfAsync(() => applying(wired, threeTabHarvest()));

    const routes = fake.requests.map((request) => request.route).filter((route) => route !== 'token');
    const between = [];
    let current = [];
    for (const route of routes) {
      if (route === 'batch-update') {
        between.push(current);
        current = [];
      } else current.push(route);
    }
    expect(between).toHaveLength(3);
    expect(between.slice(1).every((segment) => segment.includes('values'))).toBe(true);
  });

  scenario('@error an outcome that stays unknown after three attempts is sheets.apply-outcome-unknown, and says a re-run is safe', async () => {
    const fake = aTrackerFake();
    const wired = aSheetsTarget({ fake });
    fake.override('batch-update', () => serverError(503));
    const before = observeTracker(fake);

    const refusal = await refusalOfAsync(() => applying(wired, threeTabHarvest()));

    expect(refusal?.code).toBe(SheetsRefusal.APPLY_OUTCOME_UNKNOWN);
    expect(refusal.message).toMatch(/re-run/i);
    expect(fake.requestsTo('batch-update')).toHaveLength(3);
    assertStateDelta(before, observeTracker(fake), { universe: TRACKER_UNIVERSE, expected: allUnchanged(TRACKER_UNIVERSE) });
  });

  scenario('@error a throttled write is sheets.quota-exhausted after three attempts: nothing was applied, so it is not unknown', async () => {
    const fake = aTrackerFake();
    const wired = aSheetsTarget({ fake });
    fake.override('batch-update', () => rateLimited({ retryAfter: 1 }));
    const before = observeTracker(fake);

    const refusal = await refusalOfAsync(() => applying(wired, threeTabHarvest()));

    expect(refusal?.code).toBe(SheetsRefusal.QUOTA_EXHAUSTED);
    expect(fake.requestsTo('batch-update')).toHaveLength(3);
    assertStateDelta(before, observeTracker(fake), { universe: TRACKER_UNIVERSE, expected: allUnchanged(TRACKER_UNIVERSE) });
  });

  scenario('@error an unauthenticated write after one refresh is sheets.unauthorized: write ability is proven by the apply itself', async () => {
    const fake = aTrackerFake();
    const wired = aSheetsTarget({ fake });
    fake.override('batch-update', () => json(401, { error: { code: 401, message: 'Invalid Credentials' } }));
    const before = observeTracker(fake);

    const refusal = await refusalOfAsync(() => applying(wired, threeTabHarvest()));

    expect(refusal?.code).toBe(SheetsRefusal.UNAUTHORIZED);
    expect(fake.tokenRequests()).toHaveLength(2);
    assertStateDelta(before, observeTracker(fake), { universe: TRACKER_UNIVERSE, expected: allUnchanged(TRACKER_UNIVERSE) });
  });

  scenario('@error a 403 authorisation reason on the write is sheets.unauthorized after one attempt', async () => {
    const fake = aTrackerFake();
    const wired = aSheetsTarget({ fake });
    fake.override('batch-update', () => forbiddenFor('forbidden'));

    const refusal = await refusalOfAsync(() => applying(wired, threeTabHarvest()));

    expect(refusal?.code).toBe(SheetsRefusal.UNAUTHORIZED);
    expect(fake.requestsTo('batch-update')).toHaveLength(1);
  });

  scenario('@error a 200 answer that is not a Sheet at resolution refuses sheets.response-malformed and writes nothing', async () => {
    const fake = aTrackerFake();
    const wired = aSheetsTarget({ fake });
    const plans = planMergeAll(await wired.writer.read(), threeTabHarvest());
    fake.override('values', () => json(200, { spreadsheetId: 'x' }));

    const refusal = await refusalOfAsync(() => wired.writer.apply(plans));

    expect(refusal?.code).toBe(SheetsRefusal.RESPONSE_MALFORMED);
    expect(fake.writeRequests()).toEqual([]);
  });
});

describe('a plan too large for one batch is refused, never split (OQ-4)', () => {
  scenario('@error refuses sheets.plan-too-large after skipping unchanged cells, sends no batch and changes nothing', async () => {
    const fake = plainTracker({ companies: [], sources: [] });
    const wired = aSheetsTarget({ fake, maxBatchBytes: 300 });
    const before = observeTracker(fake);
    const harvest = aHarvest({ jobs: Array.from({ length: 25 }, (_, index) => aHarvestedJob(String(100 + index))) });

    const refusal = await refusalOfAsync(() => applying(wired, harvest));

    expect(refusal?.code).toBe(SheetsRefusal.PLAN_TOO_LARGE);
    expect(fake.requestsTo('batch-update')).toEqual([]);
    assertStateDelta(before, observeTracker(fake), { universe: TRACKER_UNIVERSE, expected: allUnchanged(TRACKER_UNIVERSE) });
  });

  scenario('a plan whose cells are all unchanged is never too large, however small the limit', async () => {
    const fake = plainTracker({ companies: [], sources: [] });
    const wired = aSheetsTarget({ fake, maxBatchBytes: 50 });

    const receipt = await applying(wired, aHarvest({ jobs: [aHarvestedJob('1'), aHarvestedJob('2')] }));

    expect(receipt.cellsWritten).toBe(0);
    expect(fake.requestsTo('batch-update')).toEqual([]);
  });
});

describe('row keys are bound to their rows as second locators (SD-04)', () => {
  scenario('an appended row is bound only after it exists, by a further batch that carries metadata alone', async () => {
    const fake = aTrackerFake();
    const wired = aSheetsTarget({ fake });

    await applying(wired, aHarvest({ jobs: [aHarvestedJob('3')] }));

    expect(metadataBatches(fake)).toHaveLength(1);
    expect(fake.snapshot().tabs.Jobs.metadata.find((meta) => meta.value === 'linkedin:3').rowIndex).toBe(3);
    expect(fake.requestsTo('batch-update').every((request) => metadataOnly(request) || !request.requestTypes.includes('createDeveloperMetadata'))).toBe(true);
  });

  scenario('a keyed row that lacks its binding is bound on the next merge, and merging again binds nothing more', async () => {
    const fake = aTrackerFake({ bindMetadata: false, jobs: [aTrackedJob('1'), aTrackedJob('2')] });
    const wired = aSheetsTarget({ fake });
    const harvest = aHarvest({ jobs: [aHarvestedJob('1'), aHarvestedJob('2')], companies: [aCompanyRow('Acme Ltd')], sources: [aSourceRow('agile coach')] });

    await applying(wired, harvest);

    expect(observeTracker(fake)['sheet.rowKeyBindings']).toEqual({ Jobs: ['linkedin:1', 'linkedin:2'], Companies: ['Acme Ltd'], Sources: ['["LinkedIn","agile coach"]'] });
    expect(dataBatches(fake)).toEqual([]);
    const bound = metadataBatches(fake).length;
    await applying(wired, harvest);
    expect(metadataBatches(fake)).toHaveLength(bound);
  });

  scenario('@error a binding that fails is reported as sheets.metadata-pending, not thrown, and the next merge heals it', async () => {
    const fake = aTrackerFake();
    const wired = aSheetsTarget({ fake });
    fake.override('batch-update', () => json(400, { error: { code: 400, message: 'bad' } }), { times: 1, when: metadataOnly });
    const harvest = aHarvest({ jobs: [aHarvestedJob('3')] });

    const receipt = await applying(wired, harvest);

    expect(receipt.warnings).toContain(SheetsWarning.METADATA_PENDING);
    expect(receipt.metadataPending).toBeGreaterThan(0);
    expect(observeTracker(fake)['jobs.keys']).toContain('linkedin:3');
    expect(observeTracker(fake)['sheet.rowKeyBindings'].Jobs).not.toContain('linkedin:3');

    await applying(wired, harvest);

    expect(observeTracker(fake)['sheet.rowKeyBindings'].Jobs).toContain('linkedin:3');
  });

  scenario('@error a failing binding lookup falls back to the key column, warns sheets.metadata-unavailable, and still merges', async () => {
    const fake = aTrackerFake();
    const wired = aSheetsTarget({ fake });
    fake.override('metadata-search', () => serverError(503));

    const receipt = await applying(wired, aHarvest({ jobs: [retitled(1, 'Retitled')] }));

    expect(receipt.warnings).toContain(SheetsWarning.METADATA_UNAVAILABLE);
    expect(columnsByKey(fake.snapshot(), 'Jobs', KEY_COLUMN, ['Job'])['linkedin:1']).toEqual({ Job: 'Retitled' });
  });

  const LOOKUP_REFUSALS = [
    ['throttled', () => rateLimited(), SheetsRefusal.QUOTA_EXHAUSTED],
    ['unauthenticated', () => json(401, { error: { code: 401, message: 'Invalid Credentials' } }), SheetsRefusal.UNAUTHORIZED],
  ];
  for (const [title, answer, code] of LOOKUP_REFUSALS) {
    scenario(`@error a binding lookup that is ${title} still refuses ${code} and writes nothing`, async () => {
      const fake = aTrackerFake();
      const wired = aSheetsTarget({ fake });
      fake.override('metadata-search', answer);

      const refusal = await refusalOfAsync(() => applying(wired, aHarvest({ jobs: [retitled(1, 'Retitled')] })));

      expect(refusal?.code).toBe(code);
      expect(fake.writeRequests()).toEqual([]);
    });
  }

  scenario('binding every keyed row that lacks one reports how many were bound, and a second call binds none', async () => {
    const fake = aTrackerFake({ bindMetadata: false });
    const { writer } = aSheetsTarget({ fake });

    const first = await writer.bindRowKeys();
    const batches = fake.requestsTo('batch-update').length;
    const second = await writer.bindRowKeys();

    expect(first).toEqual({ bound: 4, pending: 0 });
    expect(second).toEqual({ bound: 0, pending: 0 });
    expect(fake.requestsTo('batch-update')).toHaveLength(batches);
  });

  scenario('binding a large tracker goes in chunks of at most 100 requests (pinned proposal), none of them a data write', async () => {
    const jobs = Array.from({ length: 250 }, (_, index) => aTrackedJob(String(index + 1)));
    const fake = aTrackerFake({ bindMetadata: false, jobs, companies: [], sources: [] });
    const { writer } = aSheetsTarget({ fake });

    const result = await writer.bindRowKeys();

    expect(result).toEqual({ bound: 250, pending: 0 });
    const batches = fake.requestsTo('batch-update');
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((request) => metadataOnly(request) && request.requestTypes.length <= 100)).toBe(true);
  });

  scenario('@error a chunk Google rejects is counted as pending, not thrown, so import can finish and build can heal', async () => {
    const fake = aTrackerFake({ bindMetadata: false });
    const { writer } = aSheetsTarget({ fake });
    fake.override('batch-update', () => json(400, { error: { code: 400, message: 'bad' } }));

    const result = await writer.bindRowKeys();

    expect(result).toEqual({ bound: 0, pending: 4 });
  });
});

describe('the reader is what --dry-run gets: it can read and probe and nothing else', () => {
  scenario('@error the reader offers no apply and no bind, and reading writes nothing', async () => {
    const fake = aTrackerFake();
    const { reader } = aSheetsTarget({ fake });
    const before = observeTracker(fake);

    await reader.probe();
    await reader.read();

    expect(Object.keys(reader).sort()).toEqual(['probe', 'read']);
    expect(fake.writeRequests()).toEqual([]);
    assertStateDelta(before, observeTracker(fake), { universe: TRACKER_UNIVERSE, expected: allUnchanged(TRACKER_UNIVERSE) });
  });

  scenario('reading yields the SheetState the merge planner reads: typed values, blanks as null, blank interior rows kept in place', async () => {
    const fake = plainTracker({ companies: [], sources: [] });
    fake.humanInsertsRow('Jobs', 2, {});
    const { reader } = aSheetsTarget({ fake });

    const state = await reader.read();

    expect(state.tabs.Jobs.columns).toEqual(JOBS_WITH_NOTES);
    expect(state.tabs.Jobs.rows).toHaveLength(3);
    expect(state.tabs.Jobs.rows[0]).toMatchObject({ [KEY_COLUMN]: 'linkedin:1', Status: 'Applied', 'Fit Score': 3, 'Qualified?': null });
    expect(Object.values(state.tabs.Jobs.rows[1]).every((value) => value === null)).toBe(true);
    expect(state.tabs.Jobs.rows[2][KEY_COLUMN]).toBe('linkedin:2');
  });

  scenario('reads ask for unformatted values, so a number stays a number (assumption A1)', async () => {
    const fake = aTrackerFake();
    const { reader } = aSheetsTarget({ fake });

    await reader.read();

    expect(fake.requestsTo('values').every((request) => request.query.valueRenderOption === 'UNFORMATTED_VALUE')).toBe(true);
  });

  scenario('every read is fresh: an edit made between two reads shows in the second', async () => {
    const fake = plainTracker({ companies: [], sources: [] });
    const { reader } = aSheetsTarget({ fake });
    await reader.read();

    fake.humanEditsCell('Jobs', 1, 'Status', 'Offer');
    const state = await reader.read();

    expect(state.tabs.Jobs.rows[0].Status).toBe('Offer');
  });

  scenario('the Sheets adapter names no global fetch and imports no node: module, so it can only use what it is handed', () => {
    const source = readFileSync(join(PROJECT_ROOT, 'src/adapters/sheets-target.mjs'), 'utf8');

    expect(source).not.toMatch(/(^|[^.\w])fetch\s*\(/);
    expect(source).not.toMatch(/from\s+['"]node:/);
  });
});
