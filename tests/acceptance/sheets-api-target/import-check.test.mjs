// @contract-shape:pure-function
// DR-0012 / DESIGN Q6: the verdict on a workbook before it is imported, and on the converted Sheet after. Decisions
// over SheetState pairs, so they are testable with no I/O. Cell values are deliberately NOT compared after
// conversion (a date may come back as a serial number, A2): tabs, headers, row counts and key sets are.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { checkConversion, checkWorkbook } from '../../../src/core/import-check.mjs';
import { COMPANIES_COLUMNS, ImportRefusal, JOBS_COLUMNS, SOURCES_COLUMNS, aCompanyRow, aSourceRow, aTrackedJob, refusalOf } from './support/sheets-domain-types.mjs';
import { holds } from './support/property.mjs';
import { scenario } from './support/red-gate.mjs';

const state = (tabs) => ({ tabs: Object.fromEntries(Object.entries(tabs).map(([name, [columns, rows]]) => [name, { columns, rows }])) });
const aTrackerState = () =>
  state({
    Jobs: [[...JOBS_COLUMNS, 'My Notes'], [aTrackedJob('1', { 'My Notes': 'call back' }), aTrackedJob('2')]],
    Companies: [COMPANIES_COLUMNS, [aCompanyRow('Acme Ltd'), aCompanyRow('Beta Ltd')]],
    Sources: [SOURCES_COLUMNS, [aSourceRow('agile coach'), aSourceRow('scrum master')]],
  });
const refusalDetail = (action) => {
  try {
    action();
  } catch (error) {
    return { code: error.code, message: error.message };
  }
  return null;
};

describe('a workbook is checked before anything is created in Drive', () => {
  scenario('accepts the operator tracker: three tabs, an unknown column, human columns filled in', () => {
    expect(refusalOf(() => checkWorkbook(aTrackerState()))).toBeNull();
  });

  scenario('accepts an unknown extra tab and a Jobs tab with only a header, both preserved by import', () => {
    const tracker = aTrackerState();
    tracker.tabs.Jobs.rows = [];
    tracker.tabs.Notes = { columns: ['Thoughts'], rows: [{ Thoughts: 'keep me' }] };

    expect(refusalOf(() => checkWorkbook(tracker))).toBeNull();
  });

  scenario('@error refuses import.no-dedup-key-column when the Jobs tab is absent or has no Dedup Key', () => {
    const withoutJobs = aTrackerState();
    delete withoutJobs.tabs.Jobs;
    const withoutKey = aTrackerState();
    withoutKey.tabs.Jobs.columns = withoutKey.tabs.Jobs.columns.filter((column) => column !== 'Dedup Key');

    expect(refusalOf(() => checkWorkbook(withoutJobs))).toBe(ImportRefusal.NO_DEDUP_KEY_COLUMN);
    expect(refusalOf(() => checkWorkbook(withoutKey))).toBe(ImportRefusal.NO_DEDUP_KEY_COLUMN);
  });

  scenario('@error refuses import.key-column-missing for a Companies tab without Company, or a Sources tab without Source or Search Term', () => {
    for (const [tab, drop] of [['Companies', 'Company'], ['Sources', 'Search Term'], ['Sources', 'Source']]) {
      const tracker = aTrackerState();
      tracker.tabs[tab].columns = tracker.tabs[tab].columns.filter((column) => column !== drop);
      expect(refusalOf(() => checkWorkbook(tracker))).toBe(ImportRefusal.KEY_COLUMN_MISSING);
    }
  });

  scenario('@error refuses import.unrecognised-headers when the Jobs tab shares no harvester-owned or human-owned header, key aside', () => {
    const stranger = state({ Jobs: [['Dedup Key', 'Foo', 'Bar'], [{ 'Dedup Key': 'k1', Foo: 1, Bar: 2 }]] });

    expect(refusalOf(() => checkWorkbook(stranger))).toBe(ImportRefusal.UNRECOGNISED_HEADERS);
  });

  const DUPLICATES = [
    ['Jobs', 'Dedup Key', () => [aTrackedJob('1'), aTrackedJob('1')], 'linkedin:1'],
    ['Companies', 'Company', () => [aCompanyRow('Acme Ltd'), aCompanyRow('Acme Ltd')], 'Acme Ltd'],
    ['Sources', 'Search Term', () => [aSourceRow('agile coach'), aSourceRow('agile coach')], 'agile coach'],
  ];
  for (const [tab, , rows, key] of DUPLICATES) {
    scenario(`@error refuses import.duplicate-key, naming the key, when a ${tab} key appears on two rows`, () => {
      const tracker = aTrackerState();
      tracker.tabs[tab].rows = rows();

      const refusal = refusalDetail(() => checkWorkbook(tracker));

      expect(refusal.code).toBe(ImportRefusal.DUPLICATE_KEY);
      expect(refusal.message).toContain(key);
    });
  }

  scenario('rows with a blank key are never duplicates of one another', () => {
    const tracker = aTrackerState();
    tracker.tabs.Jobs.rows = [aTrackedJob('1'), aTrackedJob('2', { 'Dedup Key': null }), aTrackedJob('3', { 'Dedup Key': null })];

    expect(refusalOf(() => checkWorkbook(tracker))).toBeNull();
  });

  scenario('@property a tracker with unique keys and the harvester header is always accepted', () => {
    holds(
      fc.property(fc.uniqueArray(fc.integer({ min: 1, max: 500 }), { maxLength: 10 }), fc.uniqueArray(fc.integer({ min: 1, max: 50 }), { maxLength: 5 }), (jobs, companies) => {
        const tracker = state({ Jobs: [JOBS_COLUMNS, jobs.map((id) => aTrackedJob(String(id)))], Companies: [COMPANIES_COLUMNS, companies.map((id) => aCompanyRow(`Company ${id}`))] });
        expect(refusalOf(() => checkWorkbook(tracker))).toBeNull();
      }),
    );
  });
});

describe('the converted Sheet is compared with the workbook before its id is recorded', () => {
  scenario('accepts a Sheet with the same tabs, headers, row counts and keys', () => {
    expect(refusalOf(() => checkConversion({ workbookState: aTrackerState(), convertedState: aTrackerState() }))).toBeNull();
  });

  scenario('a date that reads back as a serial number is not a mismatch: cell values are not compared', () => {
    const converted = aTrackerState();
    converted.tabs.Jobs.rows[0]['Date Discovered'] = 46228;

    expect(refusalOf(() => checkConversion({ workbookState: aTrackerState(), convertedState: converted }))).toBeNull();
  });

  const LOSSES = [
    ['a tab was lost', (converted) => delete converted.tabs.Sources],
    ['a tab appeared', (converted) => (converted.tabs.Extra = { columns: ['x'], rows: [] })],
    ['a header was renamed', (converted) => (converted.tabs.Jobs.columns = converted.tabs.Jobs.columns.map((column) => (column === 'Job' ? 'Job title' : column)))],
    ['two headers swapped places', (converted) => converted.tabs.Jobs.columns.splice(0, 2, converted.tabs.Jobs.columns[1], converted.tabs.Jobs.columns[0])],
    ['a row was dropped', (converted) => converted.tabs.Jobs.rows.pop()],
    ['a row was added', (converted) => converted.tabs.Companies.rows.push(aCompanyRow('Gamma Ltd'))],
    ['a key changed but the count did not', (converted) => (converted.tabs.Jobs.rows[1]['Dedup Key'] = 'linkedin:changed')],
  ];
  for (const [title, damage] of LOSSES) {
    scenario(`@error refuses import.conversion-mismatch when ${title}`, () => {
      const converted = aTrackerState();
      damage(converted);

      expect(refusalOf(() => checkConversion({ workbookState: aTrackerState(), convertedState: converted }))).toBe(ImportRefusal.CONVERSION_MISMATCH);
    });
  }

  scenario('@error the mismatch names the tab and no cell value', () => {
    const converted = aTrackerState();
    converted.tabs.Jobs.rows[0]['My Notes'] = 'call back';
    converted.tabs.Jobs.rows.pop();

    const refusal = refusalDetail(() => checkConversion({ workbookState: aTrackerState(), convertedState: converted }));

    expect(refusal.code).toBe(ImportRefusal.CONVERSION_MISMATCH);
    expect(refusal.message).toContain('Jobs');
    expect(refusal.message).not.toContain('call back');
  });

  scenario('@property a Sheet identical to its workbook always passes, and dropping any one row always fails', () => {
    holds(
      fc.property(fc.uniqueArray(fc.integer({ min: 1, max: 500 }), { minLength: 1, maxLength: 10 }), fc.nat(), (ids, at) => {
        const build = () => state({ Jobs: [JOBS_COLUMNS, ids.map((id) => aTrackedJob(String(id)))] });
        expect(refusalOf(() => checkConversion({ workbookState: build(), convertedState: build() }))).toBeNull();
        const damaged = build();
        damaged.tabs.Jobs.rows.splice(at % ids.length, 1);
        expect(refusalOf(() => checkConversion({ workbookState: build(), convertedState: damaged }))).toBe(ImportRefusal.CONVERSION_MISMATCH);
      }),
    );
  });
});
