// Driven adapter: reads and writes the coverage ledger (DR-0002).
// Bounded change universe: the ledger file and its sibling temp file.
//
// A corrupt ledger that silently resets to empty is merely wasteful. A corrupt
// ledger that silently reads as "everything covered" loses mail. The probe
// exists to make the second impossible.
//
// RED scaffold — created by DISTILL.

export const __SCAFFOLD__ = true;

const notImplemented = (name) => {
  throw new Error(`${name}: Not yet implemented — RED scaffold`);
};

export const LedgerRefusal = Object.freeze({
  UNREADABLE: 'ledger.unreadable',
  NOT_WRITABLE: 'ledger.not-writable',
  INVERTED_INTERVAL: 'ledger.interval.inverted',
});

/** @returns {{ read: Function, commit: Function, probe: Function }} */
export function createLedgerStore(_ledgerPath) {
  return {
    read: () => notImplemented('ledgerStore.read'),
    commit: (_interval) => notImplemented('ledgerStore.commit'),
    probe: () => notImplemented('ledgerStore.probe'),
  };
}
