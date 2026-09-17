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
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { createTargetSheet } from '../../../src/adapters/xlsx-target-sheet.mjs';
import { aWorkspace, writeJson, aMessage, runHarvest, fileDigests, TargetRefusal } from './support/domain-types.mjs';
import { assertStateDelta } from '../../common/state-delta.mjs';

function writeTracker(target, rows) {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(book, sheet, 'Jobs');
  XLSX.writeFile(book, target);
}

describe('@driving_port harvest build writes to the target tracker (DR-0004, DR-0005)', () => {
  // @contract-shape:bounded-change
  it('build --out <t> --merge <t> merges into the tracker in place, and a human-typed Status survives it', () => {
    // Given a tracker with a human-typed Status on a job the harvester will see again
    const workspace = aWorkspace();
    const target = join(workspace, 'tracker.xlsx');
    writeTracker(target, [
      ['Dedup Key', 'Job', 'Company', 'Status', 'Times Seen'],
      ['linkedin:4441092711', 'Agile Coach', 'Stealth iT Consulting', 'Applied', 1],
    ]);
    writeJson(
      join(workspace, '.cache/messages/2026-07/1.json'),
      aMessage({ id: '1', jobs: [{ id: '4441092711', title: 'Agile Coach', company: 'Stealth iT Consulting' }] }),
    );

    // When the operator merges the tracker in place
    const result = runHarvest(['build', '--out', target, '--merge', target], { cwd: workspace });

    // Then the build succeeds, and the human-typed Status is exactly as it was
    expect(result.status, result.stderr).toBe(0);
    const mergedRow = createTargetSheet(target).read().tabs.Jobs.rows.find((row) => row['Dedup Key'] === 'linkedin:4441092711');
    assertStateDelta(
      { 'tracker.jobs.status[merged]': 'Applied' },
      { 'tracker.jobs.status[merged]': mergedRow.Status },
      { universe: ['tracker.jobs.status[merged]'] },
    );
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
});
