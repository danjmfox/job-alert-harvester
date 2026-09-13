// @contract-shape:bounded-change
// DR-0007 — the spill contract is what the harness writes: flat JSON, no
// `{ result: ... }` wrapper, in files matching `mcp-<connector-id>-get_message-
// <epoch-ms>.txt`, sharing a directory with unrelated tool output. Selection is
// by that filename pattern, never by extension alone and never by anything
// inside the file — records are keyed by the id inside the payload. The real
// spill fixture (fixtures/spill/*.txt) is what caught the invented `{result}`
// *.json shape; this file pins the contract against it.
// Subprocess/FS acceptance layer (real CLI, real filesystem) — example-only
// per Mandate 11, Universe-bound assertion per Mandate 8.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import {
  aWorkspace,
  writeJson,
  aSpillPayload,
  aSpillFileName,
  installRealSpillFixtures,
  runHarvest,
  cachedMessageIds,
  committedCoverage,
} from './support/domain-types.mjs';
import { assertStateDelta, grownBy } from '../../common/state-delta.mjs';

const cacheRoot = (workspace) => join(workspace, '.cache/messages');
const ledgerPath = (workspace) => join(workspace, '.cache/coverage.json');

const snapshot = (workspace) => ({
  'cache.messageIds': cachedMessageIds(cacheRoot(workspace)),
  'ledger.coverage': committedCoverage(ledgerPath(workspace)),
});

describe('@driving_port @real-io harvest ingest models the real spill contract (DR-0007)', () => {
  it('the real spill fixture ingests', () => {
    // Given the spill directory holds exactly the real fixture the harness wrote
    const workspace = aWorkspace();
    const spillDir = join(workspace, 'spill');
    installRealSpillFixtures(spillDir);
    const before = snapshot(workspace);

    // When the operator ingests the window that fixture falls inside
    const result = runHarvest(
      ['ingest', '--raw', spillDir, '--window', '2026-09-12..2026-09-12', '--expect', '1', '--complete'],
      { cwd: workspace },
    );

    // Then ingest succeeds: the message is cached and the window's coverage is committed
    expect(result.status).toBe(0);
    const after = snapshot(workspace);
    assertStateDelta(before, after, {
      universe: Object.keys(before),
      expected: { 'cache.messageIds': grownBy(1), 'ledger.coverage': grownBy(1) },
    });
  });

  it('unrelated tool-result files in the same directory are ignored and do not count toward --expect', () => {
    // Given the spill directory holds one real harness file and one unrelated tool-result file
    const workspace = aWorkspace();
    const spillDir = join(workspace, 'spill');
    installRealSpillFixtures(spillDir);
    writeFileSync(join(spillDir, 'bzw5n4z7j.txt'), JSON.stringify({ note: 'not a get_message spill' }), 'utf8');
    const before = snapshot(workspace);

    // When the operator ingests declaring --expect 1 — the true count of candidate files
    const result = runHarvest(
      ['ingest', '--raw', spillDir, '--window', '2026-09-12..2026-09-12', '--expect', '1', '--complete'],
      { cwd: workspace },
    );

    // Then ingest succeeds — the unrelated file never counted toward --expect
    expect(result.status).toBe(0);
    const after = snapshot(workspace);
    assertStateDelta(before, after, {
      universe: Object.keys(before),
      expected: { 'cache.messageIds': grownBy(1), 'ledger.coverage': grownBy(1) },
    });
  });

  it('@error a JSON spill file without the message envelope refuses not-a-message, naming the file', () => {
    // Given a spill file that is valid JSON but carries none of id/date/sender
    const workspace = aWorkspace();
    const spillDir = join(workspace, 'spill');
    const fileName = aSpillFileName();
    writeJson(join(spillDir, fileName), { note: 'no envelope here' });
    const before = snapshot(workspace);

    // When the operator ingests the directory
    const result = runHarvest(
      ['ingest', '--raw', spillDir, '--window', '2026-07-01..2026-07-31', '--expect', '1'],
      { cwd: workspace },
    );

    // Then ingest refuses distinctly from a missing body, naming the offending file
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(fileName);
    expect(result.stderr.toLowerCase()).toContain('not-a-message');
    const after = snapshot(workspace);
    assertStateDelta(before, after, { universe: Object.keys(before) });
  });

  it('@error a message with an empty plaintextBody refuses missing-plaintext-body', () => {
    // Given a spill file whose envelope is intact but plaintextBody is empty
    const workspace = aWorkspace();
    const spillDir = join(workspace, 'spill');
    const fileName = aSpillFileName();
    writeJson(join(spillDir, fileName), aSpillPayload({ id: '1', plaintextBody: '' }));
    const before = snapshot(workspace);

    // When the operator ingests the directory
    const result = runHarvest(
      ['ingest', '--raw', spillDir, '--window', '2026-07-01..2026-07-31', '--expect', '1'],
      { cwd: workspace },
    );

    // Then ingest refuses, naming the offending file
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(fileName);
    expect(result.stderr.toLowerCase()).toContain('missing-plaintext-body');
    const after = snapshot(workspace);
    assertStateDelta(before, after, { universe: Object.keys(before) });
  });
});
