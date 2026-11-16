// In-memory doubles for the fetch loop's driven ports, shared by the release R2 acceptance tests (US-03a, US-03b).
// Same shape as the doubles in fetch-loop.test.mjs and gmail-api-source/fetch-loop-async.test.mjs, which keep them local:
// a source that answers on a later tick and records what it read, and a ledger and cache that report only what they hold.

import { runFetchLoop } from '../../../../src/cli/fetch-loop.mjs';

/** The refusal DR-0022 (coverage commit) rule 2 names for a day holding a message the screen set aside. */
export const QUARANTINED_REFUSAL = 'fetch.message-quarantined';

/** A MessageSource over an in-memory mailbox of `{ day: [ids] }`. `reads` lists every id it was asked to read, in order. */
export function aMailbox(idsByDay) {
  const reads = [];
  const all = Object.entries(idsByDay).flatMap(([day, ids], dayIndex) => ids.map((id, index) => ({ id, date: `${day}T09:${String(59 - index).padStart(2, '0')}:${String(dayIndex).padStart(2, '0')}Z` })));
  const later = (value) => new Promise((resolve) => setTimeout(() => resolve(value), 0));
  return {
    reads,
    list: async (window) => {
      await later();
      return all.filter((message) => message.date.slice(0, 10) >= window.from && message.date.slice(0, 10) <= window.to);
    },
    read: async (id) => {
      reads.push(id);
      await later();
      return { id, plaintextBody: 'body' };
    },
    probe: async () => later({}),
  };
}

/** A ledger and a cache that report only what they actually hold. */
export function aLedgerAndCache() {
  const intervals = [];
  const cached = new Set();
  return {
    intervals,
    cached,
    ledger: { read: () => [...intervals], commit: (interval) => intervals.push(interval), probe: () => {} },
    reader: { ids: () => [...cached] },
    cache: { put: (record) => cached.add(record.id), probe: () => {} },
  };
}

export const slimPassthrough = (payload) => ({ record: payload, quarantine: null });

/** A slim that sets aside the ids in `reasonById` (`{ id: reason }`) and caches every other message. */
export const slimSettingAside = (reasonById) => (payload) =>
  Object.hasOwn(reasonById, payload.id) ? { record: null, quarantine: { id: payload.id, reason: reasonById[payload.id] } } : { record: payload, quarantine: null };

const THE_RANGE = { from: '2026-09-01', to: '2026-09-03' };

/** `runFetchLoop` with the ports the loop does not care about filled in. */
export const runLoop = (overrides) =>
  runFetchLoop({ range: THE_RANGE, sourceId: 'linkedin', slim: slimPassthrough, now: () => '2026-09-04T00:00:00Z', log: () => {}, ...overrides });

/** What Dan can observe of a loop run: the cache and the committed days. */
export const observedLoop = (store) => ({
  'cache.messageIds': [...store.cached].sort(),
  'ledger.coverage': store.intervals.map(({ from, to, messageCount }) => ({ from, to, messageCount })),
});
