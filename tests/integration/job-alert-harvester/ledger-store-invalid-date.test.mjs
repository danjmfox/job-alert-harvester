// @contract-shape:bounded-change
// Adapter-level integration test (real filesystem, no mocks): the ledger holds real calendar days only (DR-0002).
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createLedgerStore } from '../../../src/adapters/ledger-store.mjs';
import { aWorkspace, anInterval, refusalOf, writeJson } from '../../acceptance/job-alert-harvester/support/domain-types.mjs';

const Refusal = Object.freeze({
  INVALID_DATE: 'ledger.interval.invalid-date',
  INVERTED_INTERVAL: 'ledger.interval.inverted',
});

const SEEDED = [anInterval({ from: '2026-01-01', to: '2026-01-05' })];

function seededLedger() {
  const ledgerPath = join(aWorkspace(), '.cache/coverage.json');
  writeJson(ledgerPath, SEEDED);
  return { ledgerPath, store: createLedgerStore(ledgerPath) };
}

describe('the ledger store commits real calendar days only', () => {
  it.each([
    ['a non-date from', 'banana', '2026-02-01'],
    ['a non-date to', '2026-02-01', 'banana'],
    ['month 13', '2026-13-01', '2026-13-02'],
    ['a day the month does not have', '2026-02-30', '2026-03-02'],
    ['an unpadded month and day', '2026-2-1', '2026-2-3'],
    ['a month with no day', '2026-05', '2026-06'],
  ])('refuses %s and leaves the ledger file byte-identical', (_label, from, to) => {
    const { ledgerPath, store } = seededLedger();
    const before = readFileSync(ledgerPath);

    const refusal = refusalOf(() => store.commit(anInterval({ from, to })));

    expect(refusal).toBe(Refusal.INVALID_DATE);
    expect(readFileSync(ledgerPath).equals(before)).toBe(true);
  });

  it('refuses a non-date interval and creates no ledger when there was none', () => {
    const ledgerPath = join(aWorkspace(), '.cache/coverage.json');

    const refusal = refusalOf(() => createLedgerStore(ledgerPath).commit(anInterval({ from: 'banana', to: 'banana' })));

    expect(refusal).toBe(Refusal.INVALID_DATE);
    expect(refusalOf(() => readFileSync(ledgerPath))).not.toBeNull();
  });

  it('commits a real interval, merged with the ledger it joins', () => {
    const { ledgerPath, store } = seededLedger();

    store.commit(anInterval({ from: '2026-01-06', to: '2026-02-28' }));

    expect(JSON.parse(readFileSync(ledgerPath, 'utf8')).map(({ from, to }) => ({ from, to }))).toEqual([{ from: '2026-01-01', to: '2026-02-28' }]);
  });

  it('still refuses a real but inverted interval as inverted, not as an invalid date', () => {
    const { ledgerPath, store } = seededLedger();
    const before = readFileSync(ledgerPath);

    const refusal = refusalOf(() => store.commit(anInterval({ from: '2026-02-01', to: '2026-01-01' })));

    expect(refusal).toBe(Refusal.INVERTED_INTERVAL);
    expect(readFileSync(ledgerPath).equals(before)).toBe(true);
  });
});
