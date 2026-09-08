// @contract-shape:unbounded-preservation
// DR-0002, DR-0005 — every driven port carries probe(). A corrupt ledger that
// silently resets to empty is merely wasteful; one that silently reads as
// "everything covered" loses mail. A Jobs tab with no Dedup Key column doubles
// the sheet on merge. Real-adapter (real fs / real xlsx) layer — example-only.
import { describe, it, expect, afterEach } from 'vitest';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { createLedgerStore } from '../../../src/adapters/ledger-store.mjs';
import { createTargetSheet } from '../../../src/adapters/xlsx-target-sheet.mjs';
import { aWorkspace, writeText, refusalOf, fileDigests, LedgerRefusal, TargetRefusal } from './support/domain-types.mjs';
import { assertStateDelta } from '../../common/state-delta.mjs';

const restorePermissions = [];
afterEach(() => {
  while (restorePermissions.length > 0) {
    const [path, mode] = restorePermissions.pop();
    try {
      chmodSync(path, mode);
    } catch {
      // best-effort cleanup
    }
  }
});

describe('CoverageLedger probe contract (DR-0002)', () => {
  it('an absent ledger file reads as empty coverage — not an error', () => {
    // Given a workspace with no ledger file
    const workspace = aWorkspace();
    const store = createLedgerStore(join(workspace, '.cache/coverage.json'));
    // When the ledger is read
    // Then it reads as empty, not a refusal
    expect(store.read()).toEqual([]);
  });

  it('@error refuses a truncated or invalid ledger file, and never silently resets it', () => {
    // Given a ledger file that is not valid JSON
    const workspace = aWorkspace();
    const ledgerPath = join(workspace, '.cache/coverage.json');
    writeText(ledgerPath, '{"source": "linkedin", "from": "2026-01-01"');
    const store = createLedgerStore(ledgerPath);
    const before = { 'workspace.files': fileDigests(workspace) };

    // When the ledger is probed
    const refusal = refusalOf(() => store.probe());

    // Then it refuses by name, and the corrupt file is left byte-identical —
    // a silent reset here would read as "everything covered" and lose mail
    expect(refusal).toBe(LedgerRefusal.UNREADABLE);
    const after = { 'workspace.files': fileDigests(workspace) };
    assertStateDelta(before, after, { universe: ['workspace.files'] });
  });

  it('@error refuses to commit an interval whose `to` precedes its `from`', () => {
    const workspace = aWorkspace();
    const ledgerPath = join(workspace, '.cache/coverage.json');
    const store = createLedgerStore(ledgerPath);
    const before = { 'workspace.files': fileDigests(workspace) };

    const refusal = refusalOf(() =>
      store.commit({ source: 'linkedin', from: '2026-02-01', to: '2026-01-01', completedAt: '2026-08-01T00:00:00Z', messageCount: 1 }),
    );

    expect(refusal).toBe(LedgerRefusal.INVERTED_INTERVAL);
    const after = { 'workspace.files': fileDigests(workspace) };
    assertStateDelta(before, after, { universe: ['workspace.files'] });
  });

  it('@error refuses to start when the ledger directory is not writable', () => {
    const workspace = aWorkspace();
    const cacheDir = join(workspace, '.cache');
    mkdirSync(cacheDir, { recursive: true });
    chmodSync(cacheDir, 0o500);
    restorePermissions.push([cacheDir, 0o755]);
    const store = createLedgerStore(join(cacheDir, 'coverage.json'));

    const refusal = refusalOf(() =>
      store.commit({ source: 'linkedin', from: '2026-01-01', to: '2026-01-31', completedAt: '2026-08-01T00:00:00Z', messageCount: 1 }),
    );

    expect(refusal).toBe(LedgerRefusal.NOT_WRITABLE);
  });
});

describe('TargetSheet probe contract (DR-0005) — the dangerous one is the missing key column', () => {
  it('an absent target file is a valid create-new — never an error', () => {
    const workspace = aWorkspace();
    const sheet = createTargetSheet(join(workspace, 'tracker.xlsx'));
    expect(() => sheet.probe()).not.toThrow();
  });

  it('@error refuses when the target file is not a workbook', () => {
    // Given a file at the target path that xlsx cannot parse
    const workspace = aWorkspace();
    const targetPath = join(workspace, 'tracker.xlsx');
    writeText(targetPath, 'this is not a spreadsheet');
    const sheet = createTargetSheet(targetPath);

    const refusal = refusalOf(() => sheet.probe());

    expect(refusal).toBe(TargetRefusal.NOT_A_WORKBOOK);
  });

  it('@error refuses when the Jobs tab has no Dedup Key column — merging without a key doubles the sheet', () => {
    // Given a real workbook whose Jobs tab has no Dedup Key column
    const workspace = aWorkspace();
    const targetPath = join(workspace, 'tracker.xlsx');
    const book = XLSX.utils.book_new();
    const jobsSheet = XLSX.utils.aoa_to_sheet([['Job', 'Company', 'Status'], ['Agile Coach', 'Stealth iT', null]]);
    XLSX.utils.book_append_sheet(book, jobsSheet, 'Jobs');
    XLSX.writeFile(book, targetPath);
    const sheet = createTargetSheet(targetPath);

    const refusal = refusalOf(() => sheet.probe());

    expect(refusal).toBe(TargetRefusal.NO_DEDUP_KEY_COLUMN);
  });

  it('@error refuses before any read work when the target directory is not writable', () => {
    const workspace = aWorkspace();
    chmodSync(workspace, 0o500);
    restorePermissions.push([workspace, 0o755]);
    const sheet = createTargetSheet(join(workspace, 'tracker.xlsx'));

    const refusal = refusalOf(() => sheet.probe());

    expect(refusal).toBe(TargetRefusal.NOT_WRITABLE);
  });
});
