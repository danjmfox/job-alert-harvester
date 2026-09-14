// @contract-shape:unbounded-preservation
// DR-0002 amendment — plan-fetch returns at most one UTC day: the earliest
// uncovered day within --from..--to, printed as <d>..<d>. A day covered by a
// zero-message interval counts as covered and is never re-offered. Coverage
// is filtered by --source. plan-fetch writes nothing.
//
// Closes G1 (plan-fetch returned the whole uncovered gap): a 90-day range
// could not be exhausted in one pass, so --complete was never legitimately
// reachable, and the harvest skill passed the *requested* range — not the
// window plan-fetch actually returned — to `ingest --window`, which with
// --complete commits coverage for days never fetched.
//
// Subprocess/FS acceptance layer (real CLI, real filesystem) — example-only
// per Mandate 11, Universe-bound assertion per Mandate 8.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { aWorkspace, writeJson, anInterval, runHarvest, cachedMessageIds, committedCoverage } from './support/domain-types.mjs';
import { assertStateDelta } from '../../common/state-delta.mjs';

const cacheRoot = (workspace) => join(workspace, '.cache/messages');
const ledgerPath = (workspace) => join(workspace, '.cache/coverage.json');

const snapshot = (workspace) => ({
  'cache.messageIds': cachedMessageIds(cacheRoot(workspace)),
  'ledger.coverage': committedCoverage(ledgerPath(workspace)),
});

/** The next window plan-fetch offered, or null when it reported full coverage. */
function nextOfferedWindow(stdout) {
  if (/fully covered/i.test(stdout)) return null;
  const match = /(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/.exec(stdout);
  return match ? { from: match[1], to: match[2] } : null;
}

describe('@driving_port harvest plan-fetch offers one uncovered day at a time (DR-0002 amendment)', () => {
  it('offers only the first uncovered day, not the whole gap, when the ledger is empty', () => {
    // Given an empty ledger
    const workspace = aWorkspace();
    const before = snapshot(workspace);

    // When the operator plans a fetch over a multi-day range
    const result = runHarvest(
      ['plan-fetch', '--source', 'linkedin', '--from', '2026-09-10', '--to', '2026-09-13', '--batch', '25'],
      { cwd: workspace },
    );

    // Then only the first day of the range is offered, not the whole gap
    expect(result.status).toBe(0);
    expect(nextOfferedWindow(result.stdout)).toEqual({ from: '2026-09-10', to: '2026-09-10' });
    const after = snapshot(workspace);
    assertStateDelta(before, after, { universe: Object.keys(before) });
  });

  it('offers the next day once the first day of the range is already covered', () => {
    // Given coverage committed for the first day of the range only
    const workspace = aWorkspace();
    writeJson(ledgerPath(workspace), [anInterval({ from: '2026-09-10', to: '2026-09-10' })]);
    const before = snapshot(workspace);

    // When the operator plans a fetch over the same range
    const result = runHarvest(
      ['plan-fetch', '--source', 'linkedin', '--from', '2026-09-10', '--to', '2026-09-13', '--batch', '25'],
      { cwd: workspace },
    );

    // Then the next uncovered day is offered
    expect(result.status).toBe(0);
    expect(nextOfferedWindow(result.stdout)).toEqual({ from: '2026-09-11', to: '2026-09-11' });
    const after = snapshot(workspace);
    assertStateDelta(before, after, { universe: Object.keys(before) });
  });

  it('skips a day covered by a zero-message interval — it is never re-offered', () => {
    // Given the first day of the range was searched to completion and found empty
    const workspace = aWorkspace();
    writeJson(ledgerPath(workspace), [anInterval({ from: '2026-09-10', to: '2026-09-10', messageCount: 0 })]);
    const before = snapshot(workspace);

    // When the operator plans a fetch over the same range
    const result = runHarvest(
      ['plan-fetch', '--source', 'linkedin', '--from', '2026-09-10', '--to', '2026-09-13', '--batch', '25'],
      { cwd: workspace },
    );

    // Then the empty day counts as covered and the next day is offered instead
    expect(result.status).toBe(0);
    expect(nextOfferedWindow(result.stdout)).toEqual({ from: '2026-09-11', to: '2026-09-11' });
    const after = snapshot(workspace);
    assertStateDelta(before, after, { universe: Object.keys(before) });
  });

  it('reports full coverage, with no window offered, once every day in the range is covered', () => {
    // Given coverage committed for the entire requested range
    const workspace = aWorkspace();
    writeJson(ledgerPath(workspace), [anInterval({ from: '2026-09-10', to: '2026-09-13', messageCount: 5 })]);
    const before = snapshot(workspace);

    // When the operator plans a fetch over that range
    const result = runHarvest(
      ['plan-fetch', '--source', 'linkedin', '--from', '2026-09-10', '--to', '2026-09-13', '--batch', '25'],
      { cwd: workspace },
    );

    // Then plan-fetch reports full coverage and offers no window to fetch
    expect(result.status).toBe(0);
    expect(result.stdout.toLowerCase()).toContain('fully covered');
    expect(nextOfferedWindow(result.stdout)).toBeNull();
    const after = snapshot(workspace);
    assertStateDelta(before, after, { universe: Object.keys(before) });
  });

  it('coverage committed for a different source does not count toward this source\'s coverage', () => {
    // Given the entire range is covered, but for a different source
    const workspace = aWorkspace();
    writeJson(ledgerPath(workspace), [anInterval({ source: 'indeed', from: '2026-09-10', to: '2026-09-13', messageCount: 5 })]);
    const before = snapshot(workspace);

    // When the operator plans a fetch for linkedin over that same range
    const result = runHarvest(
      ['plan-fetch', '--source', 'linkedin', '--from', '2026-09-10', '--to', '2026-09-13', '--batch', '25'],
      { cwd: workspace },
    );

    // Then linkedin's range is entirely uncovered, and only its first day is offered
    expect(result.status).toBe(0);
    expect(nextOfferedWindow(result.stdout)).toEqual({ from: '2026-09-10', to: '2026-09-10' });
    const after = snapshot(workspace);
    assertStateDelta(before, after, { universe: Object.keys(before) });
  });

  it('writes nothing to the workspace — the ledger and cache are unchanged whether or not a window is offered', () => {
    // Given coverage committed for part of the range, leaving a real gap to find
    const workspace = aWorkspace();
    writeJson(ledgerPath(workspace), [anInterval({ from: '2026-09-10', to: '2026-09-10' })]);
    const before = snapshot(workspace);

    // When the operator plans a fetch
    const result = runHarvest(
      ['plan-fetch', '--source', 'linkedin', '--from', '2026-09-10', '--to', '2026-09-13', '--batch', '25'],
      { cwd: workspace },
    );

    // Then plan-fetch finds and reports the gap, but the workspace state is byte-for-byte unchanged
    expect(result.status).toBe(0);
    expect(nextOfferedWindow(result.stdout)).not.toBeNull();
    const after = snapshot(workspace);
    assertStateDelta(before, after, { universe: Object.keys(before) });
  });

  it('@error refuses a range where --from is later than --to', () => {
    // Given an empty ledger
    const workspace = aWorkspace();
    const before = snapshot(workspace);

    // When the operator plans a fetch with an inverted range
    const result = runHarvest(
      ['plan-fetch', '--source', 'linkedin', '--from', '2026-09-13', '--to', '2026-09-10', '--batch', '25'],
      { cwd: workspace },
    );

    // Then plan-fetch refuses rather than silently reporting full coverage
    expect(result.status).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain('invert');
    const after = snapshot(workspace);
    assertStateDelta(before, after, { universe: Object.keys(before) });
  });
});
