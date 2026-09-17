// DR-0004, DR-0005, DR-0009 (build derives from the whole cache) -- a
// non-dry-run `build` is the first code in this project that overwrites the
// user's own tracker. These scenarios drive the real CLI subprocess (the
// driving port) over a real cache and a real workbook, so a wiring gap
// between `build` and `TargetSheet.apply` cannot hide behind a unit test that
// calls the adapter directly.
//
// Subprocess acceptance layer (real CLI, real filesystem, real xlsx) --
// example-only per Mandate 11, Universe-bound assertion per Mandate 8.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { createTargetSheet } from '../../../src/adapters/xlsx-target-sheet.mjs';
import { aWorkspace, writeJson, aMessage, runHarvest, fileDigests, TargetRefusal } from './support/domain-types.mjs';
import { assertStateDelta, setTo } from '../../common/state-delta.mjs';

function writeTracker(target, rows) {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(book, sheet, 'Jobs');
  XLSX.writeFile(book, target);
}

// Google Sheets' export of 14/09/2026: a date serial with an explicit number format,
// the same shape target-sheet-apply.test.mjs pins at the adapter level.
const APPLIED_DATE_SERIAL = 46279;
const APPLIED_DATE_FORMAT = 'dd/mm/yyyy';

/**
 * A tracker holding every kind of human-owned content a merge must never disturb --
 * a typed Status, a date-formatted Applied on Date cell, an unknown column carrying a
 * note, and a second tab -- all on the one row this file's cache will update, so a
 * second identical run genuinely re-merges that row rather than skipping it untouched.
 * `aoa_to_sheet` cannot set `z` reliably, so the sheet is built from cell objects.
 */
function aHumanOwnedTracker(target) {
  const book = XLSX.utils.book_new();
  const jobsSheet = {
    A1: { t: 's', v: 'Dedup Key' },
    B1: { t: 's', v: 'Job' },
    C1: { t: 's', v: 'Company' },
    D1: { t: 's', v: 'Status' },
    E1: { t: 's', v: 'My Notes' },
    F1: { t: 's', v: 'Applied on Date' },
    G1: { t: 's', v: 'Times Seen' },
    A2: { t: 's', v: 'linkedin:4441092711' },
    B2: { t: 's', v: 'Agile Coach' },
    C2: { t: 's', v: 'OldCo Ltd' },
    D2: { t: 's', v: 'Applied' },
    E2: { t: 's', v: 'called recruiter, seemed keen' },
    F2: { t: 'n', v: APPLIED_DATE_SERIAL, z: APPLIED_DATE_FORMAT },
    G2: { t: 'n', v: 1 },
    '!ref': 'A1:G2',
  };
  XLSX.utils.book_append_sheet(book, jobsSheet, 'Jobs');
  const contactsSheet = XLSX.utils.aoa_to_sheet([
    ['Name', 'Company'],
    ['Jamie Fenwick', 'OldCo Ltd'],
  ]);
  XLSX.utils.book_append_sheet(book, contactsSheet, 'Contacts');
  writeFileSync(target, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
}

function readBackJobsRows(targetPath) {
  return XLSX.utils.sheet_to_json(XLSX.read(readFileSync(targetPath)).Sheets.Jobs, { defval: null });
}

function jobsHeaderOf(targetPath) {
  return XLSX.utils.sheet_to_json(XLSX.read(readFileSync(targetPath)).Sheets.Jobs, { header: 1 })[0];
}

/** Every cell's type, value and number format, across every tab -- the full
 *  observable surface a second merge could silently disturb. cellNF: true is
 *  load-bearing -- without it SheetJS does not report `z` on read. */
function workbookCellShapes(targetPath) {
  const book = XLSX.read(readFileSync(targetPath), { cellNF: true });
  const cells = {};
  for (const sheetName of book.SheetNames) {
    const sheet = book.Sheets[sheetName];
    for (const address of Object.keys(sheet)) {
      if (address.startsWith('!')) continue;
      const cell = sheet[address];
      cells[`${sheetName}!${address}`] = { t: cell.t, v: cell.v, z: cell.z ?? null };
    }
  }
  return { sheetNames: book.SheetNames, cells };
}

describe('@driving_port harvest build writes to the target tracker (DR-0004, DR-0005)', () => {
  // @contract-shape:bounded-change
  it('build --out <t> --merge <t> merges into the tracker in place, and a human-typed Status survives it', () => {
    // Given a tracker whose Company is stale for a job the harvester will see again, with a human-typed Status
    const workspace = aWorkspace();
    const target = join(workspace, 'tracker.xlsx');
    writeTracker(target, [
      ['Dedup Key', 'Job', 'Company', 'Status', 'Times Seen'],
      ['linkedin:4441092711', 'Agile Coach', 'OldCo Ltd', 'Applied', 1],
    ]);
    writeJson(
      join(workspace, '.cache/messages/2026-07/1.json'),
      aMessage({ id: '1', jobs: [{ id: '4441092711', title: 'Agile Coach', company: 'Stealth iT Consulting' }] }),
    );
    const before = { 'tracker.jobs.company[merged]': 'OldCo Ltd', 'tracker.jobs.status[merged]': 'Applied' };

    // When the operator merges the tracker in place
    const result = runHarvest(['build', '--out', target, '--merge', target], { cwd: workspace });

    // Then the build succeeds, the stale Company is corrected, and the human-typed Status survives it
    expect(result.status, result.stderr).toBe(0);
    const mergedRow = createTargetSheet(target).read().tabs.Jobs.rows.find((row) => row['Dedup Key'] === 'linkedin:4441092711');
    const after = { 'tracker.jobs.company[merged]': mergedRow.Company, 'tracker.jobs.status[merged]': mergedRow.Status };
    assertStateDelta(before, after, {
      universe: ['tracker.jobs.company[merged]', 'tracker.jobs.status[merged]'],
      expected: { 'tracker.jobs.company[merged]': setTo('Stealth iT Consulting') },
    });
  });

  // @contract-shape:unbounded-preservation
  it('build --out <existing> without --merge refuses, rather than overwriting a tracker it did not read', () => {
    // Given an existing target the operator did not ask to merge into
    const workspace = aWorkspace();
    const target = join(workspace, 'tracker.xlsx');
    writeTracker(target, [
      ['Dedup Key', 'Job'],
      ['linkedin:1', 'Some Job'],
    ]);
    writeJson(join(workspace, '.cache/messages/2026-07/1.json'), aMessage({}));
    const before = { 'workspace.files': fileDigests(workspace) };

    // When the operator builds without naming the target as the merge source
    const result = runHarvest(['build', '--out', target], { cwd: workspace });

    // Then the build refuses, naming the missing flag, and the existing file is untouched
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--merge/);
    const after = { 'workspace.files': fileDigests(workspace) };
    assertStateDelta(before, after, { universe: ['workspace.files'] });
  });

  // @contract-shape:bounded-change
  it('build --out <absent> without --merge creates a new workbook', () => {
    // Given no existing tracker at the output path
    const workspace = aWorkspace();
    const target = join(workspace, 'tracker.xlsx');
    writeJson(join(workspace, '.cache/messages/2026-07/1.json'), aMessage({}));

    // When the operator builds fresh
    const result = runHarvest(['build', '--out', target], { cwd: workspace });

    // Then the build succeeds and a new workbook exists at the target path
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(target)).toBe(true);
  });

  // @contract-shape:unbounded-preservation
  it('a non-dry-run build refuses an empty cache and writes nothing', () => {
    // Given a workspace with no cached messages at all
    const workspace = aWorkspace();
    const target = join(workspace, 'tracker.xlsx');
    const before = { 'workspace.files': fileDigests(workspace) };

    // When the operator attempts a real build
    const result = runHarvest(['build', '--out', target], { cwd: workspace });

    // Then the build refuses, naming the empty cache, and writes nothing
    expect(result.status).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('empty');
    expect(existsSync(target)).toBe(false);
    const after = { 'workspace.files': fileDigests(workspace) };
    assertStateDelta(before, after, { universe: ['workspace.files'] });
  });

  // @contract-shape:unbounded-preservation
  it('a target failing its probe refuses the build and is left byte-identical', () => {
    // Given a merge target whose Jobs tab has no Dedup Key column -- the dangerous probe failure
    const workspace = aWorkspace();
    const target = join(workspace, 'tracker.xlsx');
    writeTracker(target, [
      ['Job', 'Company'],
      ['Agile Coach', 'Stealth iT Consulting'],
    ]);
    writeJson(join(workspace, '.cache/messages/2026-07/1.json'), aMessage({}));
    const before = { 'workspace.files': fileDigests(workspace) };

    // When the operator builds against it
    const result = runHarvest(['build', '--out', target, '--merge', target], { cwd: workspace });

    // Then the build refuses with the probe's own refusal, and the target is untouched
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(TargetRefusal.NO_DEDUP_KEY_COLUMN);
    const after = { 'workspace.files': fileDigests(workspace) };
    assertStateDelta(before, after, { universe: ['workspace.files'] });
  });

  // @contract-shape:unbounded-preservation
  it('running build --out <t> --merge <t> twice over the same cache leaves the tracker unchanged the second time', () => {
    // Given a tracker holding a typed Status, a date-formatted Applied on Date cell, an
    // unknown column carrying a note, and a second tab, on the row this run's cache updates
    const workspace = aWorkspace();
    const target = join(workspace, 'tracker.xlsx');
    aHumanOwnedTracker(target);
    writeJson(
      join(workspace, '.cache/messages/2026-07/1.json'),
      aMessage({ id: '1', jobs: [{ id: '4441092711', title: 'Agile Coach', company: 'Stealth iT Consulting' }] }),
    );

    // When the operator merges the same cache into the same tracker twice
    const firstRun = runHarvest(['build', '--out', target, '--merge', target], { cwd: workspace });
    expect(firstRun.status, firstRun.stderr).toBe(0);
    const afterFirstRun = workbookCellShapes(target);
    const digestAfterFirstRun = fileDigests(workspace)['tracker.xlsx'];
    const rowCountAfterFirstRun = readBackJobsRows(target).length;
    const columnCountAfterFirstRun = jobsHeaderOf(target).length;

    const secondRun = runHarvest(['build', '--out', target, '--merge', target], { cwd: workspace });

    // Then the second run reports 0 cell changes, adds no rows or columns, and every cell's
    // type, value and number format on every tab is exactly what the first run left behind.
    // Measured (see probe in the DES step commit): two correct runs of this writer produce
    // byte-identical files, so that stronger check is asserted too, alongside the content check
    // that names what changed if this ever regresses.
    expect(secondRun.status, secondRun.stderr).toBe(0);
    expect(secondRun.stdout).toMatch(/cell changes: 0/);
    expect(readBackJobsRows(target)).toHaveLength(rowCountAfterFirstRun);
    expect(jobsHeaderOf(target)).toHaveLength(columnCountAfterFirstRun);
    const afterSecondRun = workbookCellShapes(target);
    assertStateDelta(
      { 'workbook.sheetNames': afterFirstRun.sheetNames, 'workbook.cells': afterFirstRun.cells },
      { 'workbook.sheetNames': afterSecondRun.sheetNames, 'workbook.cells': afterSecondRun.cells },
      { universe: ['workbook.sheetNames', 'workbook.cells'] },
    );
    expect(fileDigests(workspace)['tracker.xlsx']).toBe(digestAfterFirstRun);
  });

  // @contract-shape:unbounded-preservation
  it('build --merge <a> --out <b> with different paths refuses, naming both flags, and <b> stays absent', () => {
    // Given a tracker at one path, a cache holding a job, and no file yet at a different --out path
    const workspace = aWorkspace();
    const mergeTarget = join(workspace, 'tracker.xlsx');
    const outTarget = join(workspace, 'other.xlsx');
    writeTracker(mergeTarget, [
      ['Dedup Key', 'Job'],
      ['linkedin:1', 'Some Job'],
    ]);
    writeJson(join(workspace, '.cache/messages/2026-07/1.json'), aMessage({}));
    const before = { 'workspace.files': fileDigests(workspace) };

    // When the operator names two different paths for --merge and --out
    const result = runHarvest(['build', '--merge', mergeTarget, '--out', outTarget], { cwd: workspace });

    // Then the build refuses, naming both flags, <a> is untouched and <b> never comes into being
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--merge/);
    expect(result.stderr).toMatch(/--out/);
    expect(existsSync(outTarget)).toBe(false);
    const after = { 'workspace.files': fileDigests(workspace) };
    assertStateDelta(before, after, { universe: ['workspace.files'] });
  });

  // @contract-shape:unbounded-preservation
  it('build --merge <a> --out <b> with different paths refuses even when <b> already exists, leaving both byte-identical', () => {
    // Given two distinct, already-existing trackers named as --merge and --out
    const workspace = aWorkspace();
    const mergeTarget = join(workspace, 'tracker.xlsx');
    const outTarget = join(workspace, 'other.xlsx');
    writeTracker(mergeTarget, [
      ['Dedup Key', 'Job'],
      ['linkedin:1', 'Some Job'],
    ]);
    writeTracker(outTarget, [
      ['Dedup Key', 'Job'],
      ['linkedin:2', 'Another Job'],
    ]);
    writeJson(join(workspace, '.cache/messages/2026-07/1.json'), aMessage({}));
    const before = { 'workspace.files': fileDigests(workspace) };

    // When the operator names two different paths for --merge and --out
    const result = runHarvest(['build', '--merge', mergeTarget, '--out', outTarget], { cwd: workspace });

    // Then the build refuses, naming both flags, and both files remain byte-identical
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--merge/);
    expect(result.stderr).toMatch(/--out/);
    const after = { 'workspace.files': fileDigests(workspace) };
    assertStateDelta(before, after, { universe: ['workspace.files'] });
  });
});
