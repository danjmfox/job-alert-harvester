// @contract-shape:bounded-change
// Pins the silent-zero defect on the `--in` rebuild path (see
// docs/feature/fix-reparse-silent-zero/rca.md): an empty or unreadable corpus
// must refuse rather than overwrite --out with a zero-row workbook, and the
// month-sharded cache root must still harvest every message it holds once the
// refusal guard exists. Subprocess/FS acceptance layer (real CLI, real
// filesystem) — example-only per Mandate 11, Universe-bound assertion per
// Mandate 8.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { aWorkspace, writeText, writeJson, aMessage, runHarvest, fileDigests } from './support/domain-types.mjs';
import { assertStateDelta } from '../../common/state-delta.mjs';

const workspaces = [];

function isolatedWorkspace() {
  const workspace = aWorkspace();
  workspaces.push(workspace);
  return workspace;
}

afterEach(() => {
  while (workspaces.length > 0) rmSync(workspaces.pop(), { recursive: true, force: true });
});

function readJobsSheet(out) {
  const book = XLSX.readFile(out);
  return XLSX.utils.sheet_to_json(book.Sheets['Jobs'], { defval: null });
}

describe('@driving_port a rebuild that finds no messages refuses instead of reporting success', () => {
  it('@error refuses and writes nothing when --in holds no message JSON', () => {
    // Given an --in directory that exists but holds no message JSON
    const workspace = isolatedWorkspace();
    const inputDir = join(workspace, 'in');
    mkdirSync(inputDir, { recursive: true });
    const outDir = join(workspace, 'out');
    // --out's directory already exists (as it would for a real rebuild target) so a
    // write, if it happened, would succeed -- the assertion below pins the missing
    // emptiness guard, not an incidental ENOENT on the write path.
    mkdirSync(outDir, { recursive: true });
    const out = join(outDir, 'job-alerts.xlsx');
    const before = { 'out.files': fileDigests(outDir) };

    // When the operator rebuilds from that directory
    const result = runHarvest(['--in', inputDir, '--out', out]);

    // Then the run refuses and nothing is written to --out
    expect(result.status).not.toBe(0);
    const after = { 'out.files': fileDigests(outDir) };
    assertStateDelta(before, after, { universe: Object.keys(before) });
  });

  it('@error leaves an existing --out file byte-identical when the run refuses', () => {
    // Given an existing workbook at --out and an --in directory with no message JSON
    const workspace = isolatedWorkspace();
    const inputDir = join(workspace, 'in');
    mkdirSync(inputDir, { recursive: true });
    const outDir = join(workspace, 'out');
    const out = join(outDir, 'job-alerts.xlsx');
    writeText(out, 'sentinel-not-a-real-workbook');
    const before = { 'out.files': fileDigests(outDir) };

    // When the operator rebuilds from the empty directory
    const result = runHarvest(['--in', inputDir, '--out', out]);

    // Then the run refuses and the existing --out file is untouched byte-for-byte
    expect(result.status).not.toBe(0);
    const after = { 'out.files': fileDigests(outDir) };
    assertStateDelta(before, after, { universe: Object.keys(before) });
  });

  it('@error refuses a missing --in directory with a readable message and no stack trace', () => {
    // Given an --in directory that does not exist at all
    const workspace = isolatedWorkspace();
    const missingDir = join(workspace, 'does-not-exist');
    const outDir = join(workspace, 'out');
    const out = join(outDir, 'job-alerts.xlsx');
    const before = { 'out.files': fileDigests(outDir) };

    // When the operator points the rebuild at it
    const result = runHarvest(['--in', missingDir, '--out', out]);

    // Then the run refuses with a one-line message naming the directory, not a stack trace
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(missingDir);
    expect(result.stderr).not.toMatch(/at readdirSync|node:fs|at Object\.<anonymous>/);
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
    const after = { 'out.files': fileDigests(outDir) };
    assertStateDelta(before, after, { universe: Object.keys(before) });
  });

  it('harvests every message held under a month-sharded cache root', () => {
    // Given a cache root shaped like the real one -- messages nested under a month shard
    const workspace = isolatedWorkspace();
    const cacheRoot = join(workspace, 'cache-root');
    const shard = join(cacheRoot, '2026-09');
    const outDir = join(workspace, 'out');
    const out = join(outDir, 'job-alerts.xlsx');

    const messages = [
      aMessage({ id: 'shard-msg-1', jobs: [{ id: '9998887771', title: 'Test Engineer', company: 'Acme Corp' }] }),
      aMessage({ id: 'shard-msg-2', jobs: [{ id: '9998887772', title: 'Delivery Lead', company: 'Beta Ltd' }] }),
    ];
    for (const message of messages) writeJson(join(shard, `${message.id}.json`), message);

    // When the operator rebuilds from the cache root
    const result = runHarvest(['--in', cacheRoot, '--out', out]);

    // Then every shard message is harvested into the workbook
    expect(result.status).toBe(0);
    const jobs = readJobsSheet(out);
    expect(jobs.map((j) => j['Dedup Key']).sort()).toEqual(['linkedin:9998887771', 'linkedin:9998887772']);
  });
});
