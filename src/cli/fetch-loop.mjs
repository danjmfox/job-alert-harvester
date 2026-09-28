// Orchestrates fetching for a MessageSource that carries its own credential —
// DR-0003's named successor, with the agent absent from the data path.
//
// Removing the agent removes the agent-supplied `--expect`, so the fail-closed
// guarantee is re-established without it: the source's own listing is the
// expected set, and coverage commits only once every listed id is present in
// the cache's own view. list() and read() and ids() are three separate calls,
// so a source cannot self-certify a window it did not deliver.

import { nextUncoveredDay } from '../core/coverage.mjs';

export const FetchRefusal = Object.freeze({
  UNREADABLE: 'fetch.unreadable-message',
  NOT_CACHED: 'fetch.message-not-cached',
  NO_PROGRESS: 'fetch.window-did-not-advance',
});

const refuse = (code, detail) => {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  throw error;
};

/** @returns {{ windowsCommitted: number }} */
export function runFetchLoop({ range, sourceId, source, ledger, reader, cache, slim, now, log }) {
  ledger.probe();
  cache.probe();
  source.probe();

  let windowsCommitted = 0;
  let previousWindowKey = null;

  for (;;) {
    const coverage = ledger.read().filter((interval) => interval.source === sourceId);
    const window = nextUncoveredDay(range, coverage);
    if (window === null) return { windowsCommitted };

    const windowKey = `${window.from}..${window.to}`;
    // A committed window that does not advance coverage would loop forever.
    if (windowKey === previousWindowKey) refuse(FetchRefusal.NO_PROGRESS, windowKey);
    previousWindowKey = windowKey;

    const entries = source.list(window);
    const alreadyCached = new Set(reader.ids());
    const quarantinedIds = new Set();

    for (const entry of entries) {
      if (alreadyCached.has(entry.id)) continue;
      const payload = source.read(entry.id);
      if (payload === null || payload === undefined) refuse(FetchRefusal.UNREADABLE, entry.id);
      const { record, quarantine } = slim(payload);
      if (quarantine) {
        quarantinedIds.add(quarantine.id);
        log(`harvest fetch: quarantined ${quarantine.id} (${quarantine.reason})`);
        continue;
      }
      cache.put(record);
    }

    const cachedNow = new Set(reader.ids());
    const missing = entries
      .filter((entry) => !cachedNow.has(entry.id) && !quarantinedIds.has(entry.id))
      .map((entry) => entry.id);
    if (missing.length > 0) refuse(FetchRefusal.NOT_CACHED, missing.join(', '));

    ledger.commit({
      source: sourceId,
      from: window.from,
      to: window.to,
      completedAt: now(),
      messageCount: entries.length,
    });
    windowsCommitted += 1;
    log(`harvest fetch: ${windowKey} — ${entries.length} message(s)`);
  }
}
