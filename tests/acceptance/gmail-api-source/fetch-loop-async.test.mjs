// @contract-shape:bounded-change
// OQ-1: the fetch loop is async so a network source can drive it. The fail-closed
// guarantee is unchanged and still the whole guarantee now that --expect is gone:
// coverage commits only once every id the source listed is in the cache's own view
// (DR-0002). In-memory doubles for the ports; the loop itself is the driving port.
// The two `toThrowError` assertions in job-alert-harvester/fetch-loop.test.mjs become
// `rejects.toThrowError` in DELIVER, asserting exactly what they assert today.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { runFetchLoop } from '../../../src/cli/fetch-loop.mjs';
import { FetchRefusal } from './support/gmail-domain-types.mjs';
import { assertStateDelta, unchanged, setTo } from '../../common/state-delta.mjs';
import { holds } from './support/property.mjs';

const RANGE = { from: '2026-09-01', to: '2026-09-03' };

/** A MessageSource whose every answer arrives on a later tick, as a network source's would. */
function anAsyncSource(messagesByDay, { unreadable = [], failListing = {}, failProbe = null } = {}) {
  const reads = [];
  const all = Object.entries(messagesByDay).flatMap(([day, ids]) => ids.map((id) => ({ id, date: `${day}T09:48:30Z` })));
  const later = (value) => new Promise((resolve) => setTimeout(() => resolve(value), 0));
  return {
    reads,
    list: async (window) => {
      await later();
      if (failListing[window.from]) throw Object.assign(new Error(failListing[window.from]), { code: failListing[window.from] });
      return all.filter((m) => m.date.slice(0, 10) >= window.from && m.date.slice(0, 10) <= window.to);
    },
    read: async (id) => {
      reads.push(id);
      await later();
      return unreadable.includes(id) ? null : { id, plaintextBody: 'body' };
    },
    probe: async () => {
      if (failProbe) throw Object.assign(new Error(failProbe), { code: failProbe });
      return later({});
    },
  };
}

function aStore({ dropWrites = [] } = {}) {
  const intervals = [];
  const cached = new Set();
  const writes = [];
  return {
    intervals,
    cached,
    writes,
    ledger: { read: () => [...intervals], commit: (i) => intervals.push(i), probe: () => {} },
    reader: { ids: () => [...cached] },
    cache: {
      put: (record) => {
        writes.push(record.id);
        if (!dropWrites.includes(record.id)) cached.add(record.id);
      },
      probe: () => {},
    },
  };
}

const observe = (store) => ({
  'cache.messageIds': [...store.cached].sort(),
  'ledger.coverage': store.intervals.map(({ from, to, messageCount }) => ({ from, to, messageCount })),
});

const slimPassthrough = (payload) => ({ record: payload, quarantine: null });
const loop = (overrides) =>
  runFetchLoop({ range: RANGE, sourceId: 'linkedin', slim: slimPassthrough, now: () => '2026-09-04T00:00:00Z', log: () => {}, ...overrides });

describe('@driving_port runFetchLoop drives a source that answers asynchronously (DR-0003, OQ-1)', () => {
  it('walks one UTC day at a time and commits each day once its messages are cached', async () => {
    const store = aStore();
    const before = observe(store);

    const result = await loop({ source: anAsyncSource({ '2026-09-01': ['a'], '2026-09-02': ['b', 'c'], '2026-09-03': [] }), ...store });

    expect(result.windowsCommitted).toBe(3);
    assertStateDelta(before, observe(store), {
      universe: ['cache.messageIds', 'ledger.coverage'],
      expected: {
        'cache.messageIds': setTo(['a', 'b', 'c']),
        'ledger.coverage': setTo([
          { from: '2026-09-01', to: '2026-09-01', messageCount: 1 },
          { from: '2026-09-02', to: '2026-09-02', messageCount: 2 },
          { from: '2026-09-03', to: '2026-09-03', messageCount: 0 },
        ]),
      },
    });
  });

  it('answers with a promise even when the source answers synchronously', async () => {
    const store = aStore();
    const syncSource = { list: () => [{ id: 'a', date: '2026-09-01T09:00:00Z' }], read: (id) => ({ id, plaintextBody: 'body' }), probe: () => ({}) };

    const pending = loop({ source: syncSource, range: { from: '2026-09-01', to: '2026-09-01' }, ...store });

    expect(pending).toBeInstanceOf(Promise);
    await pending;
    expect([...store.cached]).toEqual(['a']);
  });

  it('@error rejects without committing coverage when a listed message never reaches the cache', async () => {
    const store = aStore({ dropWrites: ['b'] });
    const before = observe(store);

    await expect(loop({ source: anAsyncSource({ '2026-09-01': ['a', 'b'] }), ...store })).rejects.toThrowError(/b/);

    assertStateDelta(before, observe(store), { universe: ['ledger.coverage'] });
  });

  it('@error rejects without committing coverage when the source resolves nothing for an id it listed', async () => {
    const store = aStore();
    const before = observe(store);

    await expect(loop({ source: anAsyncSource({ '2026-09-01': ['a', 'b'] }, { unreadable: ['b'] }), ...store })).rejects.toThrowError(/b/);

    assertStateDelta(before, observe(store), { universe: ['ledger.coverage'] });
  });

  it('@error a listing that fails part-way commits nothing for that day and keeps the days already committed', async () => {
    const store = aStore();

    await expect(
      loop({ source: anAsyncSource({ '2026-09-01': ['a'], '2026-09-02': ['b'] }, { failListing: { '2026-09-02': 'gmail.list-incomplete' } }), ...store }),
    ).rejects.toMatchObject({ code: 'gmail.list-incomplete' });

    expect(observe(store)['ledger.coverage']).toEqual([{ from: '2026-09-01', to: '2026-09-01', messageCount: 1 }]);
    expect(observe(store)['cache.messageIds']).toEqual(['a']);
  });

  it('@error a source that fails its readiness check stops the loop before any cache write or coverage commit', async () => {
    const store = aStore();

    await expect(loop({ source: anAsyncSource({ '2026-09-01': ['a'] }, { failProbe: 'gmail.reauth-required' }), ...store })).rejects.toMatchObject({
      code: 'gmail.reauth-required',
    });

    expect(store.writes).toEqual([]);
    expect(store.intervals).toEqual([]);
  });

  it('a resumed day skips ids already cached, reads only the missing ones, and commits the day once', async () => {
    const store = aStore();
    const interrupted = anAsyncSource({ '2026-09-01': ['a', 'b'] }, { unreadable: ['b'] });
    await expect(loop({ source: interrupted, range: { from: '2026-09-01', to: '2026-09-01' }, ...store })).rejects.toThrowError(/b/);
    expect(store.intervals).toEqual([]);
    expect([...store.cached]).toEqual(['a']);

    const resumed = anAsyncSource({ '2026-09-01': ['a', 'b'] });
    await loop({ source: resumed, range: { from: '2026-09-01', to: '2026-09-01' }, ...store });

    expect(resumed.reads).toEqual(['b']);
    expect(store.intervals.map(({ from, messageCount }) => ({ from, messageCount }))).toEqual([{ from: '2026-09-01', messageCount: 2 }]);
  });

  it('@error refuses a day it cannot advance past rather than looping', async () => {
    const store = aStore();
    store.ledger.commit = () => {};

    await expect(loop({ source: anAsyncSource({ '2026-09-01': ['a'] }), range: { from: '2026-09-01', to: '2026-09-02' }, ...store })).rejects.toMatchObject({
      code: FetchRefusal.NO_PROGRESS,
    });
  });

  it('@property coverage commits only when every listed id is cached', async () => {
    const ids = fc.uniqueArray(fc.stringMatching(/^[a-f0-9]{6}$/), { minLength: 0, maxLength: 8 });
    await holds(
      fc.asyncProperty(ids, fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }), async (listed, dropFlags) => {
        const dropWrites = listed.filter((_, index) => dropFlags[index]);
        const store = aStore({ dropWrites });
        const act = loop({ source: anAsyncSource({ '2026-09-01': listed }), range: { from: '2026-09-01', to: '2026-09-01' }, ...store });

        if (dropWrites.length === 0) {
          await act;
          expect(store.intervals.map((i) => i.messageCount)).toEqual([listed.length]);
        } else {
          await expect(act).rejects.toThrowError();
          expect(store.intervals).toEqual([]);
        }
      }),
      { numRuns: 60 },
    );
  });
});
