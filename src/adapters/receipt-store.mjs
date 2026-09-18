// Driven adapter: lists and appends receipts under .cache/receipts/ (DR-0005).
// Absent directory reads as no receipts -- the same shape ledger-store.mjs
// uses for an absent ledger.
//
// Each receipt is its own file, named uniquely so two runs in the same
// millisecond never collide or overwrite one another -- content is written to
// a sibling temp file then renamed in, mirroring the atomic-write house style
// used elsewhere for this project's other small JSON-on-disk adapters.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const listReceipts = (receiptsDir) => {
  if (!existsSync(receiptsDir)) return [];
  return readdirSync(receiptsDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(receiptsDir, name), 'utf8')));
};

const appendReceipt = (receiptsDir, receipt) => {
  mkdirSync(receiptsDir, { recursive: true });
  const path = join(receiptsDir, `${Date.now()}-${randomUUID()}.json`);
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, JSON.stringify(receipt, null, 2), 'utf8');
  renameSync(tempPath, path);
};

/** @returns {{ list: Function, append: Function }} */
export function createReceiptStore(receiptsDir) {
  return {
    list: () => listReceipts(receiptsDir),
    append: (receipt) => appendReceipt(receiptsDir, receipt),
  };
}
