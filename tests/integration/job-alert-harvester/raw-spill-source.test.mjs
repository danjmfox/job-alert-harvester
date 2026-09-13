// @contract-shape:bounded-change
// Adapter-level integration test (real filesystem, no mocks) for the raw spill
// source (DR-0003). The CLI `ingest` subcommand that drives this adapter is not
// wired until step 01-08 — tests/acceptance/.../ingest-fail-closed.test.mjs stays
// RED until then. This test exercises the adapter directly as its GREEN gate.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { createRawSpillSource, SpillRefusal } from '../../../src/adapters/raw-spill-source.mjs';
import { aWorkspace, writeJson, writeText, aSpillPayload, refusalOf } from '../../acceptance/job-alert-harvester/support/domain-types.mjs';

const AUGUST_WINDOW = { from: '2026-07-01', to: '2026-07-31' };

describe('raw spill source adapter (DR-0003)', () => {
  it('refuses a spilled message whose date falls outside the declared window', () => {
    const spillDir = join(aWorkspace(), 'spill');
    writeJson(join(spillDir, '1.json'), aSpillPayload({ id: '1', date: '2026-08-15T00:00:00Z' }));
    const source = createRawSpillSource(spillDir);

    const refusal = refusalOf(() => source.list(AUGUST_WINDOW));

    expect(refusal).toBe(SpillRefusal.OUTSIDE_WINDOW);
  });

  it('refuses a spill file that is not valid JSON, naming the offending file', () => {
    const spillDir = join(aWorkspace(), 'spill');
    writeText(join(spillDir, 'corrupt.json'), '{ this is not json');
    const source = createRawSpillSource(spillDir);

    let error;
    try {
      source.list(AUGUST_WINDOW);
    } catch (caught) {
      error = caught;
    }

    expect(error.code).toBe(SpillRefusal.NOT_JSON);
    expect(error.message).toContain('corrupt.json');
  });

  it('refuses a spill file missing plaintextBody, naming the offending file', () => {
    const spillDir = join(aWorkspace(), 'spill');
    writeJson(join(spillDir, 'no-body.json'), {
      result: { id: '2', date: '2026-07-10T00:00:00Z', sender: 'jobalerts-noreply@linkedin.com', subject: 'x', snippet: 'x' },
    });
    const source = createRawSpillSource(spillDir);

    let error;
    try {
      source.list(AUGUST_WINDOW);
    } catch (caught) {
      error = caught;
    }

    expect(error.code).toBe(SpillRefusal.MISSING_BODY);
    expect(error.message).toContain('no-body.json');
  });

  it('surfaces a spill directory holding fewer files than the expected count as a count mismatch', () => {
    const spillDir = join(aWorkspace(), 'spill');
    writeJson(join(spillDir, '1.json'), aSpillPayload({ id: '1', date: '2026-07-10T00:00:00Z' }));
    const source = createRawSpillSource(spillDir);

    const refusal = refusalOf(() => source.probe(2));

    expect(refusal).toBe(SpillRefusal.COUNT_MISMATCH);
  });

  it('does not refuse or drop a file whose id duplicates one already cached — it still counts toward the expected count', () => {
    // The adapter has no knowledge of the cache; resumability dedup happens upstream (DR-0002).
    // Its job is only to keep every structurally valid file in the count and the listing.
    const spillDir = join(aWorkspace(), 'spill');
    writeJson(join(spillDir, 'dup1.json'), aSpillPayload({ id: 'dup1', date: '2026-07-10T09:00:00Z' }));
    writeJson(join(spillDir, '2.json'), aSpillPayload({ id: '2', date: '2026-07-12T09:00:00Z' }));
    const source = createRawSpillSource(spillDir);

    expect(() => source.probe(2)).not.toThrow();
    const entries = source.list(AUGUST_WINDOW);

    expect(entries.map((entry) => entry.id).sort()).toEqual(['2', 'dup1']);
  });

  it('reads back the full raw payload for a given id, keyed by the id inside the payload (DR-0003 Rule 2)', () => {
    const spillDir = join(aWorkspace(), 'spill');
    writeJson(join(spillDir, 'whatever-name.json'), aSpillPayload({ id: 'abc123', date: '2026-07-10T09:00:00Z' }));
    const source = createRawSpillSource(spillDir);

    const payload = source.read('abc123');

    expect(payload.result.id).toBe('abc123');
    expect(typeof payload.result.plaintextBody).toBe('string');
  });

  it('an absent spill directory refuses via probe rather than silently reading as empty', () => {
    const workspace = aWorkspace();
    const source = createRawSpillSource(join(workspace, 'does-not-exist'));

    const refusal = refusalOf(() => source.probe(1));

    expect(refusal).toBe(SpillRefusal.DIRECTORY_ABSENT);
  });
});
