// DR-0004 (one owner per column), DR-0005 (the target sheet is a plan-executing
// port). `apply` cannot write individual cells -- it rebuilds the file from
// `read()` + the plan (DR-0005 limitation 3, whole-tab rewrite). The hazard this
// suite exists to catch: an `apply` that builds the output from the plan ALONE
// would silently delete everything the plan protects by never mentioning it --
// rows outside the harvest window, hand-added rows, unknown columns, other tabs.
// Every preservation scenario below therefore reads a tracker holding all of
// those at once and asserts each survives independently, so a broken guarantee
// cannot hide behind a passing one.
//
// Adapter-level, real fs + real xlsx -- Subprocess/FS acceptance layer,
// example-only per Mandate 11, Universe-bound assertion per Mandate 8.
import { describe, it, expect, afterEach } from 'vitest';
import { chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { createTargetSheet } from '../../../src/adapters/xlsx-target-sheet.mjs';
import { planMerge } from '../../../src/core/merge.mjs';
import { aWorkspace, aSheetRow, aHarvestOf, fileDigests } from './support/domain-types.mjs';
import { assertStateDelta } from '../../common/state-delta.mjs';

const restorePermissions = [];
afterEach(() => {
  while (restorePermissions.length > 0) {
    const [path, mode] = restorePermissions.pop();
    try {
      chmodSync(path, mode);
    } catch {
      // best-effort cleanup
    }
  }
});

const UPDATED_KEY = 'linkedin:1000000001';
const OLDER_JOB_KEY = 'linkedin:1000000002';
const APPENDED_KEY = 'linkedin:1000000003';
const HAND_ADDED_TITLE = 'Hand-added lead — no dedup key yet';
const ORIGINAL_HEADER = ['Dedup Key', 'Job', 'My Notes', 'Company', 'Status', 'Times Seen', 'Max Salary (annual)'];

/**
 * A tracker holding every kind of data a plan never mentions, built once and
 * reused (Pillar 2) so each preservation guarantee is checked against one
 * realistic fixture instead of a bespoke one per scenario. `My Notes` sits
 * mid-header, not at the end, so a reorder bug would show.
 */
function aHazardTracker() {
  const workspace = aWorkspace();
  const targetPath = join(workspace, 'tracker.xlsx');
  const book = XLSX.utils.book_new();

  const jobsSheet = XLSX.utils.aoa_to_sheet([
    ORIGINAL_HEADER,
    [UPDATED_KEY, 'Delivery Lead', 'called recruiter 3x', 'Northwind Co', 'Applied', 2, 60000],
    [OLDER_JOB_KEY, 'Old Coach Role', 'stale, ignore', 'Ancient Corp', 'Rejected', 1, 55000],
    ['', HAND_ADDED_TITLE, '', 'Someone I met at a meetup', null, null, null],
  ]);
  XLSX.utils.book_append_sheet(book, jobsSheet, 'Jobs');

  const contactsSheet = XLSX.utils.aoa_to_sheet([
    ['Name', 'Company', 'Notes'],
    ['Jamie Fenwick', 'Northwind Co', 'met at conference, warm intro'],
  ]);
  XLSX.utils.book_append_sheet(book, contactsSheet, 'Contacts');

  XLSX.writeFile(book, targetPath);
  return { workspace, targetPath };
}

/** The harvest for this run: a fresh sighting of the row the tracker already has
 *  (numeric values that must land as numeric cells), plus one brand-new job. */
function aHazardHarvest() {
  return aHarvestOf([
    aSheetRow({
      'Dedup Key': UPDATED_KEY,
      'Job': 'Senior Delivery Lead',
      'Company': 'Northwind Co',
      'Times Seen': 5,
      'Max Salary (annual)': 68000,
    }),
    aSheetRow({
      'Dedup Key': APPENDED_KEY,
      'Job': 'Platform Engineer',
      'Company': 'Riverside Systems',
      'Times Seen': 1,
      'Max Salary (annual)': 72000,
    }),
  ]);
}

/** A pre-apply row's expected post-apply shape when untouched: identical, plus the
 *  plan's newly appended columns reading blank -- reconstructing the file widens
 *  every row's header, so "untouched" still gains the new columns as null. */
function untouchedShapeOf(row, plan) {
  return { ...row, ...Object.fromEntries(plan.appendColumns.map((column) => [column, null])) };
}

function readBackJobsRows(targetPath) {
  return XLSX.utils.sheet_to_json(XLSX.read(readFileSync(targetPath)).Sheets.Jobs, { defval: null });
}

describe('@real-io @adapter-integration TargetSheet.apply executes a WritePlan without disturbing what it does not own (DR-0004, DR-0005)', () => {
  // @contract-shape:unbounded-preservation
  it('preserves a row whose key is absent from the plan — an older job untouched by this run', () => {
    const { targetPath } = aHazardTracker();
    const sheet = createTargetSheet(targetPath);
    const sheetState = sheet.read();
    const plan = planMerge(sheetState, aHazardHarvest());
    const olderRow = sheetState.tabs.Jobs.rows.find((row) => row['Dedup Key'] === OLDER_JOB_KEY);
    const before = { 'tracker.jobs.row[older]': untouchedShapeOf(olderRow, plan) };

    sheet.apply(plan);

    const after = { 'tracker.jobs.row[older]': readBackJobsRows(targetPath).find((row) => row['Dedup Key'] === OLDER_JOB_KEY) };
    assertStateDelta(before, after, { universe: ['tracker.jobs.row[older]'] });
  });

  // @contract-shape:unbounded-preservation
  it('preserves a hand-added row with a blank Dedup Key — a human artefact, never matched', () => {
    const { targetPath } = aHazardTracker();
    const sheet = createTargetSheet(targetPath);
    const sheetState = sheet.read();
    const plan = planMerge(sheetState, aHazardHarvest());
    const handAdded = sheetState.tabs.Jobs.rows.find((row) => row.Job === HAND_ADDED_TITLE);
    const before = { 'tracker.jobs.row[hand-added]': untouchedShapeOf(handAdded, plan) };

    sheet.apply(plan);

    const after = { 'tracker.jobs.row[hand-added]': readBackJobsRows(targetPath).find((row) => row.Job === HAND_ADDED_TITLE) };
    assertStateDelta(before, after, { universe: ['tracker.jobs.row[hand-added]'] });
  });

  // @contract-shape:unbounded-preservation
  it("preserves the unknown 'My Notes' column's value and position, on rows the plan touches and rows it doesn't", () => {
    const { targetPath } = aHazardTracker();
    const sheet = createTargetSheet(targetPath);
    const sheetState = sheet.read();
    const byIdentity = (rows) => new Map(rows.map((row) => [row['Dedup Key'] || row.Job, row]));
    const beforeRows = byIdentity(sheetState.tabs.Jobs.rows);
    const plan = planMerge(sheetState, aHazardHarvest());
    const before = {
      'tracker.jobs.myNotes[updated]': beforeRows.get(UPDATED_KEY)['My Notes'],
      'tracker.jobs.myNotes[untouched]': beforeRows.get(OLDER_JOB_KEY)['My Notes'],
      'tracker.jobs.myNotes[hand-added]': beforeRows.get(HAND_ADDED_TITLE)['My Notes'],
    };

    sheet.apply(plan);

    const book = XLSX.read(readFileSync(targetPath));
    const header = XLSX.utils.sheet_to_json(book.Sheets.Jobs, { header: 1 })[0];
    const afterRows = byIdentity(XLSX.utils.sheet_to_json(book.Sheets.Jobs, { defval: null }));
    const after = {
      'tracker.jobs.myNotes[updated]': afterRows.get(UPDATED_KEY)['My Notes'],
      'tracker.jobs.myNotes[untouched]': afterRows.get(OLDER_JOB_KEY)['My Notes'],
      'tracker.jobs.myNotes[hand-added]': afterRows.get(HAND_ADDED_TITLE)['My Notes'],
    };
    assertStateDelta(before, after, {
      universe: ['tracker.jobs.myNotes[updated]', 'tracker.jobs.myNotes[untouched]', 'tracker.jobs.myNotes[hand-added]'],
    });
    expect(header.indexOf('My Notes')).toBe(2); // still mid-header -- a reorder would move it
  });

  // @contract-shape:unbounded-preservation
  it("preserves every tab other than the plan's own — the Contacts tab is untouched", () => {
    const { targetPath } = aHazardTracker();
    const sheet = createTargetSheet(targetPath);
    const sheetState = sheet.read();
    const plan = planMerge(sheetState, aHazardHarvest());
    const before = { 'tracker.tabs.Contacts': sheetState.tabs.Contacts };

    sheet.apply(plan);

    const after = { 'tracker.tabs.Contacts': createTargetSheet(targetPath).read().tabs.Contacts };
    assertStateDelta(before, after, { universe: ['tracker.tabs.Contacts'] });
  });

  // @contract-shape:bounded-change
  it('preserves a human-typed Status on a row the plan updates', () => {
    const { targetPath } = aHazardTracker();
    const sheet = createTargetSheet(targetPath);
    const sheetState = sheet.read();
    const plan = planMerge(sheetState, aHazardHarvest());
    const updatedRow = sheetState.tabs.Jobs.rows.find((row) => row['Dedup Key'] === UPDATED_KEY);
    const before = { 'tracker.jobs.status[updated]': updatedRow.Status };

    sheet.apply(plan);

    const afterRow = readBackJobsRows(targetPath).find((row) => row['Dedup Key'] === UPDATED_KEY);
    const after = { 'tracker.jobs.status[updated]': afterRow.Status };
    assertStateDelta(before, after, { universe: ['tracker.jobs.status[updated]'] });
  });

  // @contract-shape:bounded-change
  it('preserves existing column order, and appends new harvester columns to the right of the header', () => {
    const { targetPath } = aHazardTracker();
    const sheet = createTargetSheet(targetPath);
    const plan = planMerge(sheet.read(), aHazardHarvest());

    sheet.apply(plan);

    const header = XLSX.utils.sheet_to_json(XLSX.read(readFileSync(targetPath)).Sheets.Jobs, { header: 1 })[0];
    expect(header.slice(0, ORIGINAL_HEADER.length)).toEqual(ORIGINAL_HEADER);
    expect(header.slice(ORIGINAL_HEADER.length)).toEqual(plan.appendColumns);
  });

  // @contract-shape:bounded-change
  it('preserves existing row order, and appends new rows below the existing ones', () => {
    const { targetPath } = aHazardTracker();
    const sheet = createTargetSheet(targetPath);
    const plan = planMerge(sheet.read(), aHazardHarvest());

    sheet.apply(plan);

    const rows = readBackJobsRows(targetPath);
    expect(rows).toHaveLength(4);
    expect(rows[0]['Dedup Key']).toBe(UPDATED_KEY); // updated in place, not moved
    expect(rows[1]['Dedup Key']).toBe(OLDER_JOB_KEY); // untouched older job, still second
    expect(rows[2].Job).toBe(HAND_ADDED_TITLE); // untouched hand-added row, still third
    expect(rows[3]['Dedup Key']).toBe(APPENDED_KEY); // newly appended job, below the existing rows
  });

  // @contract-shape:bounded-change
  it('writes numeric harvester values as numeric cells, not strings', () => {
    const { targetPath } = aHazardTracker();
    const sheet = createTargetSheet(targetPath);
    const plan = planMerge(sheet.read(), aHazardHarvest());

    sheet.apply(plan);

    const book = XLSX.read(readFileSync(targetPath));
    const jobsSheet = book.Sheets.Jobs;
    const header = XLSX.utils.sheet_to_json(jobsSheet, { header: 1 })[0];
    const rows = XLSX.utils.sheet_to_json(jobsSheet, { defval: null });
    const cellTypeOf = (rowIndex, columnName) =>
      jobsSheet[XLSX.utils.encode_cell({ r: rowIndex + 1, c: header.indexOf(columnName) })]?.t;
    const updatedRowIndex = rows.findIndex((row) => row['Dedup Key'] === UPDATED_KEY);
    const appendedRowIndex = rows.findIndex((row) => row['Dedup Key'] === APPENDED_KEY);

    expect(cellTypeOf(updatedRowIndex, 'Times Seen')).toBe('n');
    expect(cellTypeOf(updatedRowIndex, 'Max Salary (annual)')).toBe('n');
    expect(cellTypeOf(appendedRowIndex, 'Times Seen')).toBe('n');
    expect(cellTypeOf(appendedRowIndex, 'Max Salary (annual)')).toBe('n');
  });

  // @contract-shape:bounded-change
  it('a successful apply changes only the target file on disk, and leaves no temp file behind', () => {
    const { workspace, targetPath } = aHazardTracker();
    const sheet = createTargetSheet(targetPath);
    const plan = planMerge(sheet.read(), aHazardHarvest());
    const before = { 'workspace.fileNames': Object.keys(fileDigests(workspace)).sort() };

    const receipt = sheet.apply(plan);

    const after = { 'workspace.fileNames': Object.keys(fileDigests(workspace)).sort() };
    assertStateDelta(before, after, { universe: ['workspace.fileNames'] }); // no new/removed file names -- no leaked temp file
    expect(fileDigests(workspace)['tracker.xlsx']).toBe(receipt.outputDigest);
  });

  // @contract-shape:unbounded-preservation
  it('a failed write leaves the original target byte-identical, and no temp file remains', () => {
    const { workspace, targetPath } = aHazardTracker();
    const sheet = createTargetSheet(targetPath);
    const plan = planMerge(sheet.read(), aHazardHarvest());
    const before = { 'workspace.files': fileDigests(workspace) };
    // Reading the existing target succeeds; writing the sibling temp file fails.
    chmodSync(workspace, 0o500);
    restorePermissions.push([workspace, 0o755]);

    expect(() => sheet.apply(plan)).toThrowError(/EACCES/);

    const after = { 'workspace.files': fileDigests(workspace) };
    assertStateDelta(before, after, { universe: ['workspace.files'] });
  });

  // @contract-shape:bounded-change
  it('returns a Receipt whose outputDigest is the sha256 of the file now on disk', () => {
    const { workspace, targetPath } = aHazardTracker();
    const sheet = createTargetSheet(targetPath);
    const plan = planMerge(sheet.read(), aHazardHarvest());

    const receipt = sheet.apply(plan);

    expect(receipt.outputDigest).toBe(fileDigests(workspace)['tracker.xlsx']);
  });

  // @contract-shape:bounded-change
  it('returns a Receipt whose inputDigest is the sha256 of the file before the write', () => {
    const { workspace, targetPath } = aHazardTracker();
    const beforeDigest = fileDigests(workspace)['tracker.xlsx'];
    const sheet = createTargetSheet(targetPath);
    const plan = planMerge(sheet.read(), aHazardHarvest());

    const receipt = sheet.apply(plan);

    expect(receipt.inputDigest).toBe(beforeDigest);
  });
});
