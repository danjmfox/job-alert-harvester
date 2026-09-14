// Driven adapter: writes slimmed records into the month-sharded cache (DR-0002).
// Write-only by design (D-18) — a component that only reads cannot be handed an
// object with a write method on it.
// Bounded change universe: cacheRoot/**.

import { writeFileSync, renameSync, mkdirSync, accessSync, constants } from 'node:fs';
import { dirname, join } from 'node:path';

export const CacheRefusal = Object.freeze({
  NOT_WRITABLE: 'cache.not-writable',
});

const refuse = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};

/** A record's own month, YYYY-MM, decides its shard (DR-0002 storage layout). */
const monthShard = (record) => record.date.slice(0, 7);

const recordPath = (cacheRoot, record) => join(cacheRoot, monthShard(record), `${record.id}.json`);

const writeRecordAtomically = (path, record) => {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, JSON.stringify(record, null, 2), 'utf8');
  renameSync(tempPath, path);
};

const assertWritable = (cacheRoot) => {
  try {
    mkdirSync(cacheRoot, { recursive: true });
    accessSync(cacheRoot, constants.W_OK);
  } catch {
    refuse(CacheRefusal.NOT_WRITABLE);
  }
};

/** @returns {{ put: Function, probe: Function }} */
export function createMessageCache(cacheRoot) {
  return {
    put: (record) => writeRecordAtomically(recordPath(cacheRoot, record), record),
    probe: () => assertWritable(cacheRoot),
  };
}
