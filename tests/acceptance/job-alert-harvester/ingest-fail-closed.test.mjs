// @contract-shape:bounded-change
// DR-0003 — the agent couriers paths and control values, never records. Every
// value it supplies is verified against the ingested data and fails closed.
// Spill files are named and shaped per DR-0007 (mcp-<connector-id>-get_message-
// <epoch-ms>.txt, flat JSON, no wrapper) — see spill-contract.test.mjs for the
// scenarios that pin the selection/envelope contract itself.
// Subprocess/FS acceptance layer (real CLI, real filesystem) — example-only
// per Mandate 11, Universe-bound assertion per Mandate 8.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  aWorkspace,
  writeJson,
  writeText,
  aSpillPayload,
  aSpillFileName,
  runHarvest,
  cachedMessageIds,
  committedCoverage,
} from './support/domain-types.mjs';
import { assertStateDelta, unchanged, grownBy } from '../../common/state-delta.mjs';

const cacheRoot = (workspace) => join(workspace, '.cache/messages');
const ledgerPath = (workspace) => join(workspace, '.cache/coverage.json');

const snapshot = (workspace) => ({
  'cache.messageIds': cachedMessageIds(cacheRoot(workspace)),
  'ledger.coverage': committedCoverage(ledgerPath(workspace)),
});

describe('@driving_port harvest ingest refuses out-of-contract input (DR-0003)', () => {
  it('@error refuses when an ingested message falls outside the declared window', () => {
    // Given a spill file whose message date is outside the declared window
    const workspace = aWorkspace();
    const spillDir = join(workspace, 'spill');
    writeJson(join(spillDir, aSpillFileName()), aSpillPayload({ id: '1', date: '2026-08-15T00:00:00Z' }));
    const before = snapshot(workspace);

    // When the operator ingests with a window that excludes that date
    const result = runHarvest(
      ['ingest', '--raw', spillDir, '--window', '2026-07-01..2026-07-31', '--expect', '1'],
      { cwd: workspace },
    );

    // Then ingest refuses, naming the window violation, and nothing is committed
    expect(result.status).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain('window');
    const after = snapshot(workspace);
    assertStateDelta(before, after, { universe: Object.keys(before) });
  });

  it('@error refuses when the expected count does not match the number of spill files', () => {
    // Given one spill file but an expected count of two
    const workspace = aWorkspace();
    const spillDir = join(workspace, 'spill');
    writeJson(join(spillDir, aSpillFileName()), aSpillPayload({ id: '1', date: '2026-07-10T00:00:00Z' }));
    const before = snapshot(workspace);

    // When the operator ingests claiming --expect 2
    const result = runHarvest(
      ['ingest', '--raw', spillDir, '--window', '2026-07-01..2026-07-31', '--expect', '2'],
      { cwd: workspace },
    );

    // Then ingest refuses rather than proceeding on a partial batch, naming the count mismatch
    expect(result.status).not.toBe(0);
    expect(result.stderr.toLowerCase()).toMatch(/count|expect/);
    const after = snapshot(workspace);
    assertStateDelta(before, after, { universe: Object.keys(before) });
  });

  it('@error refuses on a non-JSON spill file, naming the file rather than skipping it', () => {
    // Given a spill file that is not valid JSON
    const workspace = aWorkspace();
    const spillDir = join(workspace, 'spill');
    const fileName = aSpillFileName();
    writeText(join(spillDir, fileName), '{ this is not json');
    const before = snapshot(workspace);

    // When the operator ingests the directory
    const result = runHarvest(
      ['ingest', '--raw', spillDir, '--window', '2026-07-01..2026-07-31', '--expect', '1'],
      { cwd: workspace },
    );

    // Then ingest refuses and names the offending file, rather than silently skipping it
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(fileName);
    const after = snapshot(workspace);
    assertStateDelta(before, after, { universe: Object.keys(before) });
  });

  it('@error refuses on a spill file whose envelope has no plaintextBody key at all, naming the file', () => {
    // Given a spill file whose payload has no plaintextBody
    const workspace = aWorkspace();
    const spillDir = join(workspace, 'spill');
    const fileName = aSpillFileName();
    writeJson(join(spillDir, fileName), {
      id: '2', date: '2026-07-10T00:00:00Z', sender: 'jobalerts-noreply@linkedin.com', subject: 'x', snippet: 'x',
    });
    const before = snapshot(workspace);

    // When the operator ingests the directory
    const result = runHarvest(
      ['ingest', '--raw', spillDir, '--window', '2026-07-01..2026-07-31', '--expect', '1'],
      { cwd: workspace },
    );

    // Then ingest refuses and names the offending file
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(fileName);
    const after = snapshot(workspace);
    assertStateDelta(before, after, { universe: Object.keys(before) });
  });

  it('a duplicate id already cached is skipped silently and counts as satisfied — resumability, not an error', () => {
    // Given the cache already holds a message with id "dup1"
    const workspace = aWorkspace();
    writeJson(join(cacheRoot(workspace), '2026-07/dup1.json'), {
      id: 'dup1', date: '2026-07-10T09:00:00Z', sender: 'jobalerts-noreply@linkedin.com',
      subject: 'x', snippet: 'x', plaintextBody: 'Your job alert for agile coach\n'.padEnd(1200, 'x'),
    });
    // And a spill file re-delivering the very same id (DR-0007 Rule 6: keyed by
    // the id inside the payload, never by anything in the filename)
    const spillDir = join(workspace, 'spill');
    writeJson(join(spillDir, aSpillFileName()), aSpillPayload({ id: 'dup1', date: '2026-07-10T09:00:00Z' }));
    const before = snapshot(workspace);

    // When the operator ingests, completing the window
    const result = runHarvest(
      ['ingest', '--raw', spillDir, '--window', '2026-07-01..2026-07-31', '--expect', '1', '--complete'],
      { cwd: workspace },
    );

    // Then ingest succeeds — the duplicate satisfied the expected count without erroring
    expect(result.status).toBe(0);
    const after = snapshot(workspace);
    assertStateDelta(before, after, {
      universe: Object.keys(before),
      expected: { 'cache.messageIds': unchanged(), 'ledger.coverage': grownBy(1) },
    });
  });

  it('coverage does NOT commit when the count check passes but --complete is absent', () => {
    // Given a spill file whose count matches --expect, but --complete is not given
    const workspace = aWorkspace();
    const spillDir = join(workspace, 'spill');
    writeJson(join(spillDir, aSpillFileName()), aSpillPayload({ id: '1', date: '2026-07-10T00:00:00Z' }));
    const before = snapshot(workspace);

    // When the operator ingests without --complete
    const result = runHarvest(
      ['ingest', '--raw', spillDir, '--window', '2026-07-01..2026-07-31', '--expect', '1'],
      { cwd: workspace },
    );

    // Then ingest succeeds and the cache gains the message, but coverage is never
    // committed for a window that was never declared exhausted
    expect(result.status).toBe(0);
    const after = snapshot(workspace);
    assertStateDelta(before, after, {
      universe: Object.keys(before),
      expected: { 'cache.messageIds': grownBy(1), 'ledger.coverage': unchanged() },
    });
  });

  it('@error coverage does NOT commit — not even partially — when --complete is given but the count check fails', () => {
    // Given a spill directory holding fewer files than declared, but --complete is asserted anyway
    const workspace = aWorkspace();
    const spillDir = join(workspace, 'spill');
    writeJson(join(spillDir, aSpillFileName()), aSpillPayload({ id: '1', date: '2026-07-10T00:00:00Z' }));
    const before = snapshot(workspace);

    // When the operator ingests, wrongly claiming the window is exhausted
    const result = runHarvest(
      ['ingest', '--raw', spillDir, '--window', '2026-07-01..2026-07-31', '--expect', '5', '--complete'],
      { cwd: workspace },
    );

    // Then ingest refuses outright, naming the count mismatch — a partial batch
    // never advances coverage
    expect(result.status).not.toBe(0);
    expect(result.stderr.toLowerCase()).toMatch(/count|expect/);
    const after = snapshot(workspace);
    assertStateDelta(before, after, { universe: Object.keys(before) });
  });
});
