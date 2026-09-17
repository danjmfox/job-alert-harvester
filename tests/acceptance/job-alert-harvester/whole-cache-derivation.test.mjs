// @contract-shape:bounded-change
// Pins DR-0009 (docs/decisions/DR-0009-build-derives-from-the-whole-cache.md):
// First Seen / Last Seen / Times Seen are derived from every shard the cache
// holds, never from the window a run happens to be pointed at. `harvest()`
// itself stays history-free (src/core/harvest.mjs) -- this invariant lives at
// the composition root, so the guard drives the real CLI over a real
// month-sharded cache, not the pure core directly.
//
// Non-vacuity was demonstrated before this test was written by narrowing the
// same assertions to the September shard alone (`--in <cache>/2026-09`
// instead of `--in <cache>`): the run reported Times Seen 1 (not 2) and
// First Seen 2026-09-08T09:00:00Z (the later sighting, not the earlier one).
// Widening back to the whole cache root restored Times Seen 2 and First Seen
// 2026-08-08T09:00:00Z. That is what this test pins.
//
// `build` (src/cli/harvest.mjs:26) is still a RED scaffold -- `--in` is the
// only derivation path that exists today. When `build` lands it must satisfy
// this same invariant; the whole-cache derivation is not specific to `--in`.
//
// Subprocess/FS acceptance layer (real CLI, real filesystem) -- example-only
// per Mandate 11, Universe-bound assertion per Mandate 8.
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { aWorkspace, writeJson, aMessage, runHarvest } from './support/domain-types.mjs';
import { assertStateDelta, setTo } from '../../common/state-delta.mjs';

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

const RESENT_JOB_ID = '5551234567';
const DEDUP_KEY = `linkedin:${RESENT_JOB_ID}`;
const AUGUST_SIGHTING = '2026-08-08T09:00:00Z';
const SEPTEMBER_SIGHTING = '2026-09-08T09:00:00Z';

/** The resent job's row, as the driving port's own output reports it -- the Universe. */
function captureResentRow(out) {
  if (!existsSync(out)) {
    return { 'row.present': false, 'row.timesSeen': null, 'row.firstSeen': null, 'row.lastSeen': null };
  }
  const row = readJobsSheet(out).find((job) => job['Dedup Key'] === DEDUP_KEY);
  return {
    'row.present': Boolean(row),
    'row.timesSeen': row?.['Times Seen'] ?? null,
    'row.firstSeen': row?.['First Seen'] ?? null,
    'row.lastSeen': row?.['Last Seen'] ?? null,
  };
}

describe('@driving_port a rebuild derives the seen-counters from every shard, not one window', () => {
  it('a rebuild derives the seen-counters from every shard, not one window', () => {
    // Given a month-sharded cache holding the same job resent a month apart
    const workspace = isolatedWorkspace();
    const cacheRoot = join(workspace, 'cache-root');
    const out = join(workspace, 'out', 'job-alerts.xlsx');

    const augustSighting = aMessage({
      id: 'resend-2026-08',
      date: AUGUST_SIGHTING,
      jobs: [{ id: RESENT_JOB_ID, title: 'Delivery Lead', company: 'Acme Corp' }],
    });
    const septemberSighting = aMessage({
      id: 'resend-2026-09',
      date: SEPTEMBER_SIGHTING,
      jobs: [{ id: RESENT_JOB_ID, title: 'Delivery Lead', company: 'Acme Corp' }],
    });
    writeJson(join(cacheRoot, '2026-08', `${augustSighting.id}.json`), augustSighting);
    writeJson(join(cacheRoot, '2026-09', `${septemberSighting.id}.json`), septemberSighting);

    const before = captureResentRow(out);

    // When the operator rebuilds from the whole cache root
    const result = runHarvest(['--in', cacheRoot, '--out', out]);
    expect(result.status, result.stderr).toBe(0);

    // Then the resend is counted twice, and First Seen holds at the earlier sighting
    const after = captureResentRow(out);
    assertStateDelta(before, after, {
      universe: ['row.present', 'row.timesSeen', 'row.firstSeen', 'row.lastSeen'],
      expected: {
        'row.present': setTo(true),
        'row.timesSeen': setTo(2),
        'row.firstSeen': setTo(AUGUST_SIGHTING),
        'row.lastSeen': setTo(SEPTEMBER_SIGHTING),
      },
    });
  });
});
