// Driven adapter: reads and writes the coverage ledger (DR-0002).
// Bounded change universe: the ledger file and its sibling temp file.
//
// A corrupt ledger that silently resets to empty is merely wasteful. A corrupt
// ledger that silently reads as "everything covered" loses mail. The probe
// exists to make the second impossible.

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, accessSync, constants } from 'node:fs';
import { dirname } from 'node:path';
import { validateInterval, mergeIntervals, CoverageRefusal } from '../core/coverage.mjs';

export const LedgerRefusal = Object.freeze({
  UNREADABLE: 'ledger.unreadable',
  NOT_WRITABLE: 'ledger.not-writable',
  INVERTED_INTERVAL: 'ledger.interval.inverted',
});

const refuse = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};

const readLedger = (ledgerPath) => {
  if (!existsSync(ledgerPath)) return [];
  try {
    return JSON.parse(readFileSync(ledgerPath, 'utf8'));
  } catch {
    refuse(LedgerRefusal.UNREADABLE);
  }
};

const assertDirectoryWritable = (ledgerPath) => {
  const directory = dirname(ledgerPath);
  mkdirSync(directory, { recursive: true });
  try {
    accessSync(directory, constants.W_OK);
  } catch {
    refuse(LedgerRefusal.NOT_WRITABLE);
  }
};

const writeLedgerAtomically = (ledgerPath, intervals) => {
  const tempPath = `${ledgerPath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(intervals, null, 2), 'utf8');
  renameSync(tempPath, ledgerPath);
};

/** @returns {{ read: Function, commit: Function, probe: Function }} */
export function createLedgerStore(ledgerPath) {
  const commit = (interval) => {
    try {
      validateInterval(interval);
    } catch (error) {
      if (error.code === CoverageRefusal.INVERTED_INTERVAL) refuse(LedgerRefusal.INVERTED_INTERVAL);
      throw error;
    }
    assertDirectoryWritable(ledgerPath);
    const existing = readLedger(ledgerPath);
    const merged = mergeIntervals([...existing, interval]);
    writeLedgerAtomically(ledgerPath, merged);
    return merged;
  };

  return {
    read: () => readLedger(ledgerPath),
    commit,
    probe: () => readLedger(ledgerPath),
  };
}
