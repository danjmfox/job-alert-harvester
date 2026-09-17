// @contract-shape:unbounded-preservation
// DR-0005 — `build --dry-run` prints the plan and is pure by construction: the
// preview cannot mutate the tracker because it stops at the plan. Subprocess
// acceptance layer, universe-bound assertion per Mandate 8.
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { aWorkspace, writeJson, runHarvest, fileDigests } from './support/domain-types.mjs';
import { assertStateDelta } from '../../common/state-delta.mjs';

describe('@driving_port harvest build --dry-run mutates nothing on disk (DR-0005)', () => {
  it('with no pre-existing target, --dry-run creates no file', () => {
    // Given a workspace with a populated cache but no target workbook
    const workspace = aWorkspace();
    writeJson(join(workspace, '.cache/messages/2026-07/1.json'), {
      id: '1', date: '2026-07-10T00:00:00Z', sender: 'jobalerts-noreply@linkedin.com',
      subject: 'x', snippet: 'x', plaintextBody: 'x'.repeat(2000),
    });
    const target = join(workspace, 'tracker.xlsx');
    const before = { 'workspace.files': fileDigests(workspace) };

    // When the operator previews the build
    const result = runHarvest(['build', '--out', target, '--dry-run'], { cwd: workspace });

    // Then the preview succeeds, and no workbook is created — a preview cannot
    // represent "modified the tracker"
    expect(result.status).toBe(0);
    expect(existsSync(target)).toBe(false);
    const after = { 'workspace.files': fileDigests(workspace) };
    assertStateDelta(before, after, { universe: ['workspace.files'] });
  });

  it('with a pre-existing target, --dry-run leaves it byte-identical', () => {
    // Given an existing target file — a real workbook, not placeholder bytes
    const workspace = aWorkspace();
    const target = join(workspace, 'tracker.xlsx');
    const book = XLSX.utils.book_new();
    const jobsSheet = XLSX.utils.aoa_to_sheet([
      ['Dedup Key', 'Job', 'Company'],
      ['linkedin:4441092711', 'Agile Coach', 'Stealth iT Consulting'],
    ]);
    XLSX.utils.book_append_sheet(book, jobsSheet, 'Jobs');
    XLSX.writeFile(book, target);
    const before = { 'workspace.files': fileDigests(workspace) };

    // When the operator previews a merge build against it
    const result = runHarvest(['build', '--out', target, '--merge', target, '--dry-run'], { cwd: workspace });

    // Then the preview succeeds and the file on disk is untouched
    expect(result.status).toBe(0);
    const after = { 'workspace.files': fileDigests(workspace) };
    assertStateDelta(before, after, { universe: ['workspace.files'] });
  });

  it('prints the plan to the operator rather than applying it silently', () => {
    const workspace = aWorkspace();
    const target = join(workspace, 'tracker.xlsx');

    const result = runHarvest(['build', '--out', target, '--dry-run'], { cwd: workspace });

    // A dry run that produces no observable output would be indistinguishable
    // from one that did nothing at all — the operator must see the plan.
    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  });
});
