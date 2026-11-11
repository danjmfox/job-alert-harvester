// @contract-shape:bounded-change
// Adapter-level integration test (real filesystem, no mocks): one source's commit never claims another source's days (DR-0022 rule 1).
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createLedgerStore } from '../../../src/adapters/ledger-store.mjs';
import { nextUncoveredDay } from '../../../src/core/coverage.mjs';
import { aWorkspace, anInterval, writeJson } from '../../acceptance/job-alert-harvester/support/domain-types.mjs';

const LINKEDIN = anInterval({ from: '2026-06-15', to: '2026-10-24', messageCount: 100 });

function ledgerHoldingLinkedin() {
  const ledgerPath = join(aWorkspace(), '.cache/coverage.json');
  writeJson(ledgerPath, [LINKEDIN]);
  return { ledgerPath, store: createLedgerStore(ledgerPath) };
}

const onDisk = (ledgerPath) => JSON.parse(readFileSync(ledgerPath, 'utf8'));
const entryFor = (ledger, source) => ledger.filter((interval) => interval.source === source);
const daysAndCount = (intervals) => intervals.map(({ from, to, messageCount }) => ({ from, to, messageCount }));

describe('the ledger store keeps each source\'s coverage separate', () => {
  it('a second source\'s commit leaves the first source\'s coverage untouched', () => {
    const { ledgerPath, store } = ledgerHoldingLinkedin();

    const returned = store.commit(anInterval({ source: 'wttj', from: '2026-10-25', to: '2026-10-25', messageCount: 3 }));

    const ledger = onDisk(ledgerPath);
    expect(returned).toEqual(ledger);
    expect(ledger).toHaveLength(2);
    expect(entryFor(ledger, 'linkedin')).toEqual([LINKEDIN]);
    expect(daysAndCount(entryFor(ledger, 'wttj'))).toEqual([
      { from: '2026-10-25', to: '2026-10-25', messageCount: 3 },
    ]);
  });

  it('a second source\'s commit inside the first source\'s span stays its own entry', () => {
    const { ledgerPath, store } = ledgerHoldingLinkedin();

    store.commit(anInterval({ source: 'wttj', from: '2026-09-11', to: '2026-09-11', messageCount: 3 }));

    const ledger = onDisk(ledgerPath);
    expect(entryFor(ledger, 'linkedin')).toEqual([LINKEDIN]);
    expect(daysAndCount(entryFor(ledger, 'wttj'))).toEqual([
      { from: '2026-09-11', to: '2026-09-11', messageCount: 3 },
    ]);
  });

  it('the linkedin planner still sees the next day uncovered after a wttj commit', () => {
    const { store } = ledgerHoldingLinkedin();

    store.commit(anInterval({ source: 'wttj', from: '2026-10-25', to: '2026-10-25', messageCount: 3 }));

    const linkedinOnly = store.read().filter((interval) => interval.source === 'linkedin');
    expect(nextUncoveredDay({ from: '2026-10-20', to: '2026-10-26' }, linkedinOnly)).toEqual({ from: '2026-10-25', to: '2026-10-25' });
  });
});
