// DR-0010 (every derived tab merges by its own key), DR-0004 (one owner per
// column). Every derived tab -- Jobs, Companies, Sources -- merges under
// DR-0004's rules independently; no tab is regenerated wholesale. Sources'
// key is composite (Source + Search Term), carried as `update.match`
// alongside the existing scalar `key`, additively -- `planMerge` and its 9
// pinned `merge-plan.test.mjs` scenarios are untouched.
//
// Planning scenarios (pure, table-driven) sit alongside `merge-plan.test.mjs`
// style. Applying-more-than-one-plan scenarios are adapter-level, real fs +
// real xlsx, `target-sheet-apply.test.mjs` style.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { planMergeCompanies, planMergeSources, planMergeAll, KEY_COLUMN } from '../../../src/core/merge.mjs';
import { createTargetSheet } from '../../../src/adapters/xlsx-target-sheet.mjs';
import { COMPANIES_COLUMNS, SOURCES_COLUMNS } from '../../../src/core/harvest.mjs';
import { aTrackerContaining, aSheetRow, aHarvestOf, aWorkspace, fileDigests } from './support/domain-types.mjs';
import { assertStateDelta } from '../../common/state-delta.mjs';

/** A row as it appears in the tracker's Companies tab. */
function aCompanyRow(overrides = {}) {
  return {
    'Company': 'Stealth iT Consulting',
    'Source Type': 'recruiter',
    'Jobs Seen': 3,
    'First Seen': '2026-07-25T09:48:00Z',
    'Last Seen': '2026-07-25T21:48:00Z',
    ...overrides,
  };
}

/** A row as it appears in the tracker's Sources tab. */
function aSourceRow(overrides = {}) {
  return {
    'Source': 'LinkedIn',
    'Search Term': 'agile coach in London',
    'Sender': 'jobalerts-noreply@linkedin.com',
    'First Seen': '2026-07-25T09:48:00Z',
    'Last Seen': '2026-07-25T21:48:00Z',
    'Messages': 2,
    'Jobs Found': 3,
    ...overrides,
  };
}

function aCompaniesHarvestOf(rows) {
  return { companies: { columns: COMPANIES_COLUMNS, rows } };
}

function aSourcesHarvestOf(rows) {
  return { sources: { columns: SOURCES_COLUMNS, rows } };
}

function aCompaniesTracker(rows, columns = COMPANIES_COLUMNS) {
  return aTrackerContaining(rows, { columns, tab: 'Companies' });
}

function aSourcesTracker(rows, columns = SOURCES_COLUMNS) {
  return aTrackerContaining(rows, { columns, tab: 'Sources' });
}

function combineTrackers(...trackers) {
  return { tabs: Object.assign({}, ...trackers.map((tracker) => tracker.tabs)) };
}

describe('planMergeCompanies (DR-0010) -- Companies merges on Company', () => {
  it('a company already in the tracker is updated with freshly derived values', () => {
    // Given a tracker row for a company the harvester has seen before, now stale
    const existing = aCompanyRow({ 'Jobs Seen': 1, 'Last Seen': '2026-07-01T00:00:00Z' });
    const sheetState = aCompaniesTracker([existing]);
    // When the harvester re-derives fresher figures for the same company
    const harvestModel = aCompaniesHarvestOf([aCompanyRow({ 'Jobs Seen': 3, 'Last Seen': '2026-07-25T21:48:00Z' })]);
    const plan = planMergeCompanies(sheetState, harvestModel);
    // Then the plan overwrites the stale figures, matched on Company
    const update = plan.updates.find((u) => u.match.Company === 'Stealth iT Consulting');
    expect(update.match).toEqual({ Company: 'Stealth iT Consulting' });
    expect(update.cells['Jobs Seen']).toBe(3);
    expect(update.cells['Last Seen']).toBe('2026-07-25T21:48:00Z');
  });

  it('a new company is appended', () => {
    // Given a tracker with an unrelated existing company
    const sheetState = aCompaniesTracker([aCompanyRow({ Company: 'Existing Recruiters Ltd' })]);
    // When the harvester brings a company the tracker has never seen
    const harvestModel = aCompaniesHarvestOf([aCompanyRow({ Company: 'Brand New Co', 'Jobs Seen': 1 })]);
    const plan = planMergeCompanies(sheetState, harvestModel);
    // Then it is appended, not merged into the unrelated row
    expect(plan.updates).toHaveLength(0);
    const appended = plan.appends.find((row) => row.Company === 'Brand New Co');
    expect(appended).toBeDefined();
    expect(appended['Jobs Seen']).toBe(1);
  });

  it('a company absent from this harvest is left untouched and appears nowhere in the plan', () => {
    // Given a tracker holding a company this harvest run will not see again
    const staleCompany = aCompanyRow({ Company: 'OldCo Recruiters', 'Jobs Seen': 5 });
    const sheetState = aCompaniesTracker([staleCompany, aCompanyRow({ Company: 'Stealth iT Consulting' })]);
    // When this harvest brings only the other company
    const harvestModel = aCompaniesHarvestOf([aCompanyRow({ Company: 'Stealth iT Consulting', 'Jobs Seen': 9 })]);
    const plan = planMergeCompanies(sheetState, harvestModel);
    // Then the absent company is referenced nowhere in the plan -- not updated, not removed
    expect(JSON.stringify(plan)).not.toContain('OldCo Recruiters');
    // And the company this harvest did see is still merged
    expect(plan.updates.some((u) => u.match.Company === 'Stealth iT Consulting')).toBe(true);
  });

  it('unknown columns on Companies are never referenced by the plan', () => {
    // Given a tracker with a column the harvester does not recognise
    const columns = [...COMPANIES_COLUMNS, 'Target?'];
    const existing = { ...aCompanyRow(), 'Target?': 'Yes' };
    const sheetState = aCompaniesTracker([existing], columns);
    // When the harvester merges an update for that same row
    const harvestModel = aCompaniesHarvestOf([aCompanyRow({ 'Jobs Seen': 9 })]);
    const plan = planMergeCompanies(sheetState, harvestModel);
    // Then the unknown column is never referenced by the plan
    expect(plan.appendColumns).not.toContain('Target?');
    const update = plan.updates.find((u) => u.match.Company === 'Stealth iT Consulting');
    expect(update.cells).not.toHaveProperty('Target?');
  });

  it('a blank Company is never matched', () => {
    // Given a hand-added Companies row with no Company name yet
    const handAdded = { ...aCompanyRow({ Company: '' }), 'Source Type': 'hand-added, no company name yet' };
    const sheetState = aCompaniesTracker([handAdded]);
    // When the harvester brings a genuinely new company
    const harvestModel = aCompaniesHarvestOf([aCompanyRow({ Company: 'Genuinely New Co' })]);
    const plan = planMergeCompanies(sheetState, harvestModel);
    // Then the blank-key row is never treated as a merge target
    expect(plan.updates.some((u) => u.match.Company === '')).toBe(false);
    expect(JSON.stringify(plan)).not.toContain('hand-added, no company name yet');
  });
});

describe('planMergeSources (DR-0010) -- Sources merges on the composite Source + Search Term', () => {
  it('two rows sharing a Source but differing in Search Term are distinct rows and are not collided', () => {
    // Given two existing Sources rows for the same Source, different Search Terms --
    // the scenario a composed-string key (DR-0010 Option 2, rejected) would collide
    const agileCoach = aSourceRow({ 'Search Term': 'agile coach in London', 'Messages': 2, 'Jobs Found': 3 });
    const deliveryLead = aSourceRow({ 'Search Term': 'delivery lead in Manchester', 'Messages': 1, 'Jobs Found': 1 });
    const sheetState = aSourcesTracker([agileCoach, deliveryLead]);
    // When the harvester brings fresh, differing figures for each Search Term under the same Source
    const harvestModel = aSourcesHarvestOf([
      aSourceRow({ 'Search Term': 'agile coach in London', 'Messages': 5, 'Jobs Found': 8 }),
      aSourceRow({ 'Search Term': 'delivery lead in Manchester', 'Messages': 3, 'Jobs Found': 2 }),
    ]);
    const plan = planMergeSources(sheetState, harvestModel);
    // Then each Search Term keeps its own update, matched on the composite key, with its own figures
    expect(plan.updates).toHaveLength(2);
    const agileUpdate = plan.updates.find((u) => u.match['Search Term'] === 'agile coach in London');
    const deliveryUpdate = plan.updates.find((u) => u.match['Search Term'] === 'delivery lead in Manchester');
    expect(agileUpdate.match).toEqual({ Source: 'LinkedIn', 'Search Term': 'agile coach in London' });
    expect(deliveryUpdate.match).toEqual({ Source: 'LinkedIn', 'Search Term': 'delivery lead in Manchester' });
    expect(agileUpdate.cells['Messages']).toBe(5);
    expect(agileUpdate.cells['Jobs Found']).toBe(8);
    expect(deliveryUpdate.cells['Messages']).toBe(3);
    expect(deliveryUpdate.cells['Jobs Found']).toBe(2);
  });

  it('a new Search Term under an existing Source is appended, not merged into an unrelated row', () => {
    // Given a tracker with only one Search Term recorded for this Source
    const sheetState = aSourcesTracker([aSourceRow({ 'Search Term': 'agile coach in London' })]);
    // When the harvester brings a different Search Term under the same Source
    const harvestModel = aSourcesHarvestOf([aSourceRow({ 'Search Term': 'platform engineer in Leeds', 'Messages': 1, 'Jobs Found': 1 })]);
    const plan = planMergeSources(sheetState, harvestModel);
    // Then it is appended, and the existing row is never touched
    expect(plan.updates).toHaveLength(0);
    const appended = plan.appends.find((row) => row['Search Term'] === 'platform engineer in Leeds');
    expect(appended).toBeDefined();
  });

  it('unknown columns on Sources are never referenced by the plan', () => {
    // Given a tracker with a column the harvester does not recognise
    const columns = [...SOURCES_COLUMNS, 'Recruiter Phone'];
    const existing = { ...aSourceRow(), 'Recruiter Phone': '020 7946 0000' };
    const sheetState = aSourcesTracker([existing], columns);
    // When the harvester merges an update for that same row
    const harvestModel = aSourcesHarvestOf([aSourceRow({ 'Messages': 9 })]);
    const plan = planMergeSources(sheetState, harvestModel);
    // Then the unknown column is never referenced by the plan
    expect(plan.appendColumns).not.toContain('Recruiter Phone');
    expect(plan.updates[0].cells).not.toHaveProperty('Recruiter Phone');
  });

  it('a blank Source is never matched', () => {
    // Given a hand-added Sources row with no Source yet
    const handAdded = { ...aSourceRow({ Source: '' }), Sender: 'hand-added-row, no source yet' };
    const sheetState = aSourcesTracker([handAdded]);
    // When the harvester brings a genuinely new search
    const harvestModel = aSourcesHarvestOf([aSourceRow({ 'Search Term': 'genuinely new search' })]);
    const plan = planMergeSources(sheetState, harvestModel);
    // Then the blank-key row is never treated as a merge target
    expect(plan.updates.some((u) => u.match.Source === '')).toBe(false);
    expect(JSON.stringify(plan)).not.toContain('hand-added-row, no source yet');
  });
});

describe('planMergeAll (DR-0010) -- one plan per derived tab, in one call', () => {
  it('returns one plan per tab the harvest carries, each naming its own tab', () => {
    // Given a tracker holding all three derived tabs
    const sheetState = combineTrackers(
      aTrackerContaining([aSheetRow()]),
      aCompaniesTracker([aCompanyRow()]),
      aSourcesTracker([aSourceRow()]),
    );
    // When the harvest carries all three tabs
    const harvestModel = {
      ...aHarvestOf([aSheetRow()]),
      ...aCompaniesHarvestOf([aCompanyRow()]),
      ...aSourcesHarvestOf([aSourceRow()]),
    };
    const plans = planMergeAll(sheetState, harvestModel);
    // Then one plan comes back per tab, each naming its own tab
    expect(plans).toHaveLength(3);
    expect(new Set(plans.map((p) => p.tab))).toEqual(new Set(['Jobs', 'Companies', 'Sources']));
  });

  it('returns a plan only for the tabs the harvest actually carries, not a hardcoded three', () => {
    // Given a tracker holding Companies and Sources only
    const sheetState = combineTrackers(aCompaniesTracker([aCompanyRow()]), aSourcesTracker([aSourceRow()]));
    // When the harvest carries no Jobs tab this run
    const harvestModel = { ...aCompaniesHarvestOf([aCompanyRow()]), ...aSourcesHarvestOf([aSourceRow()]) };
    const plans = planMergeAll(sheetState, harvestModel);
    // Then only the tabs the harvest actually carries get a plan
    expect(plans).toHaveLength(2);
    expect(new Set(plans.map((p) => p.tab))).toEqual(new Set(['Companies', 'Sources']));
  });
});

/** Builds a real workbook, real fs -- adapter-level fixture (DR-0010's plan-per-tab shape). */
function aMultiTabTracker() {
  const workspace = aWorkspace();
  const targetPath = join(workspace, 'tracker.xlsx');
  const book = XLSX.utils.book_new();

  const jobsSheet = XLSX.utils.aoa_to_sheet([
    ['Dedup Key', 'Job', 'Company'],
    ['linkedin:1', 'Agile Coach', 'Stealth iT Consulting'],
  ]);
  XLSX.utils.book_append_sheet(book, jobsSheet, 'Jobs');

  const companiesSheet = XLSX.utils.aoa_to_sheet([
    ['Company', 'Source Type', 'Jobs Seen', 'First Seen', 'Last Seen'],
    ['Stealth iT Consulting', 'recruiter', 1, '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'],
  ]);
  XLSX.utils.book_append_sheet(book, companiesSheet, 'Companies');

  XLSX.writeFile(book, targetPath);
  return { workspace, targetPath };
}

/** A hand-built WritePlan -- adapter-level scenarios exercise `apply` directly,
 *  independent of whether the planners above exist yet. */
function aPlanFor(tab, { appendColumns = [], updates = [], appends = [], changes = [] } = {}) {
  return { tab, appendColumns, updates, appends, changes };
}

describe('TargetSheet.apply(plan[]) (DR-0010) -- every named tab, in one write', () => {
  // @contract-shape:bounded-change
  it('accepts an array of plans and merges every named tab in one write', () => {
    // Given a tracker with Jobs and Companies tabs, both stale for the same run
    const { workspace, targetPath } = aMultiTabTracker();
    const sheet = createTargetSheet(targetPath);
    const before = { 'workspace.fileNames': Object.keys(fileDigests(workspace)).sort() };
    const jobsPlan = aPlanFor('Jobs', {
      updates: [{ key: 'linkedin:1', match: { [KEY_COLUMN]: 'linkedin:1' }, cells: { Company: 'Stealth Consulting Group' } }],
    });
    const companiesPlan = aPlanFor('Companies', {
      updates: [{ key: 'Stealth iT Consulting', match: { Company: 'Stealth iT Consulting' }, cells: { 'Jobs Seen': 4 } }],
    });

    // When both plans are applied together
    sheet.apply([jobsPlan, companiesPlan]);

    // Then both tabs are merged, and the write touches only the one target file -- no leaked temp file
    const after = { 'workspace.fileNames': Object.keys(fileDigests(workspace)).sort() };
    assertStateDelta(before, after, { universe: ['workspace.fileNames'] });
    const state = sheet.read();
    expect(state.tabs.Jobs.rows[0].Company).toBe('Stealth Consulting Group');
    expect(state.tabs.Companies.rows[0]['Jobs Seen']).toBe(4);
  });

  // @contract-shape:bounded-change
  it('a row matched by match is located by testing every match entry against the row -- not a single key column', () => {
    // Given two Sources rows sharing a Source but differing in Search Term
    const workspace = aWorkspace();
    const targetPath = join(workspace, 'tracker.xlsx');
    const book = XLSX.utils.book_new();
    const sourcesSheet = XLSX.utils.aoa_to_sheet([
      ['Source', 'Search Term', 'Sender', 'Messages', 'Jobs Found'],
      ['LinkedIn', 'agile coach in London', 'jobalerts-noreply@linkedin.com', 2, 3],
      ['LinkedIn', 'delivery lead in Manchester', 'jobalerts-noreply@linkedin.com', 1, 1],
    ]);
    XLSX.utils.book_append_sheet(book, sourcesSheet, 'Sources');
    XLSX.writeFile(book, targetPath);
    const sheet = createTargetSheet(targetPath);
    const plan = aPlanFor('Sources', {
      updates: [
        {
          key: 'LinkedIn / delivery lead in Manchester',
          match: { Source: 'LinkedIn', 'Search Term': 'delivery lead in Manchester' },
          cells: { Messages: 9, 'Jobs Found': 9 },
        },
      ],
    });

    // When the plan is applied
    sheet.apply(plan);

    // Then only the row whose Search Term matches is updated -- the other, same-Source row is untouched
    const rows = sheet.read().tabs.Sources.rows;
    const untouched = rows.find((row) => row['Search Term'] === 'agile coach in London');
    const updated = rows.find((row) => row['Search Term'] === 'delivery lead in Manchester');
    expect(updated.Messages).toBe(9);
    expect(untouched.Messages).toBe(2);
  });

  // @contract-shape:bounded-change
  it('creates a tab present in the plans but absent from the tracker, and leaves a tab absent from the plans untouched', () => {
    // Given a tracker with only a Jobs tab
    const workspace = aWorkspace();
    const targetPath = join(workspace, 'tracker.xlsx');
    const book = XLSX.utils.book_new();
    const jobsSheet = XLSX.utils.aoa_to_sheet([
      ['Dedup Key', 'Job'],
      ['linkedin:1', 'Agile Coach'],
    ]);
    XLSX.utils.book_append_sheet(book, jobsSheet, 'Jobs');
    XLSX.writeFile(book, targetPath);
    const sheet = createTargetSheet(targetPath);
    const beforeJobsRows = sheet.read().tabs.Jobs.rows;
    const companiesPlan = aPlanFor('Companies', {
      appendColumns: COMPANIES_COLUMNS,
      appends: [{ Company: 'Brand New Co', 'Source Type': 'recruiter', 'Jobs Seen': 1, 'First Seen': '2026-07-25T00:00:00Z', 'Last Seen': '2026-07-25T00:00:00Z' }],
    });

    // When only a Companies plan is applied -- Jobs is named nowhere in the plans array
    sheet.apply([companiesPlan]);

    // Then Companies is created with the appended row, and Jobs is left completely untouched
    const state = sheet.read();
    expect(state.tabs.Companies.rows.find((row) => row.Company === 'Brand New Co')).toBeDefined();
    expect(state.tabs.Jobs.rows).toEqual(beforeJobsRows);
  });
});
