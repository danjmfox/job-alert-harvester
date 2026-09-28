// @contract-shape:bounded-change
// DR-0003's named successor: a MessageSource that carries its own credential
// removes the agent from the data path. The agent-supplied --expect goes with
// it, so the fail-closed guarantee must be re-established without it: the
// source's own listing is the expected set, and coverage commits only once
// every listed id is in the cache, verified against the cache's own view.
import { describe, it, expect } from 'vitest';
import { runFetchLoop } from '../../../src/cli/fetch-loop.mjs';

/** A MessageSource (the port raw-spill-source implements) over an in-memory corpus. */
function aSource(messagesByDay, { unreadable = [] } = {}) {
  const all = Object.entries(messagesByDay).flatMap(([day, ids]) =>
    ids.map((id) => ({ id, date: `${day}T09:48:30Z` })),
  );
  return {
    list: (window) => all.filter((m) => m.date.slice(0, 10) >= window.from && m.date.slice(0, 10) <= window.to),
    read: (id) => (unreadable.includes(id) ? null : { id, plaintextBody: 'body' }),
    probe: () => ({}),
  };
}

/** A ledger and cache pair, both reporting only what they actually hold. */
function aStore({ dropWrites = [] } = {}) {
  const intervals = [];
  const cached = new Set();
  return {
    intervals,
    cached,
    ledger: { read: () => [...intervals], commit: (i) => intervals.push(i), probe: () => {} },
    reader: { ids: () => [...cached] },
    cache: { put: (record) => { if (!dropWrites.includes(record.id)) cached.add(record.id); }, probe: () => {} },
  };
}

const slimPassthrough = (payload) => ({ record: payload, quarantine: null });
const loop = (overrides) =>
  runFetchLoop({
    range: { from: '2026-09-01', to: '2026-09-03' },
    sourceId: 'linkedin',
    slim: slimPassthrough,
    now: () => '2026-09-04T00:00:00Z',
    log: () => {},
    ...overrides,
  });

describe('@driving_port runFetchLoop — the fetch loop without an agent in the data path (DR-0003)', () => {
  it('walks one UTC day at a time until the range is fully covered', () => {
    const store = aStore();
    const result = loop({
      source: aSource({ '2026-09-01': ['a'], '2026-09-02': ['b'], '2026-09-03': ['c'] }),
      ...store,
    });

    expect(store.intervals.map((i) => `${i.from}..${i.to}`)).toEqual([
      '2026-09-01..2026-09-01',
      '2026-09-02..2026-09-02',
      '2026-09-03..2026-09-03',
    ]);
    expect(result.windowsCommitted).toBe(3);
    expect([...store.cached].sort()).toEqual(['a', 'b', 'c']);
  });

  it('records a day that advertised nothing, so it is never offered again', () => {
    const store = aStore();
    loop({ source: aSource({ '2026-09-01': ['a'], '2026-09-03': ['c'] }), ...store });

    const empty = store.intervals.find((i) => i.from === '2026-09-02');
    expect(empty).toBeDefined();
    expect(empty.messageCount).toBe(0);
  });

  it('counts every message the source listed for the window, not just the new ones', () => {
    const store = aStore();
    store.cached.add('a');
    loop({ source: aSource({ '2026-09-01': ['a', 'b'] }), ...store });

    expect(store.intervals[0].messageCount).toBe(2);
    expect([...store.cached].sort()).toEqual(['a', 'b']);
  });

  it('@error refuses without committing coverage when a listed message never reaches the cache', () => {
    // A write that silently does not land is the failure --expect used to catch.
    const store = aStore({ dropWrites: ['b'] });
    const act = () => loop({ source: aSource({ '2026-09-01': ['a', 'b'] }), ...store });

    expect(act).toThrowError(/b/);
    expect(store.intervals).toEqual([]);
  });

  it('@error refuses without committing coverage when the source cannot read an id it listed', () => {
    const store = aStore();
    const act = () =>
      loop({ source: aSource({ '2026-09-01': ['a', 'b'] }, { unreadable: ['b'] }), ...store });

    expect(act).toThrowError(/b/);
    expect(store.intervals).toEqual([]);
  });

  it('skips a quarantined message without blocking the window, and still counts it', () => {
    const store = aStore();
    const slimQuarantining = (payload) =>
      payload.id === 'b'
        ? { record: null, quarantine: { id: 'b', reason: 'body-too-short' } }
        : { record: payload, quarantine: null };

    loop({ source: aSource({ '2026-09-01': ['a', 'b'] }), slim: slimQuarantining, ...store });

    expect(store.intervals[0].messageCount).toBe(2);
    expect([...store.cached]).toEqual(['a']);
  });
});
