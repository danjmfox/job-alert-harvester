// Driven adapter: reads message records off the real filesystem — one reach,
// walking subdirectories, so a flat directory (fixtures, or one cache shard)
// and the whole month-sharded cache root (.cache/messages/<YYYY-MM>/<id>.json)
// both read via readAll() and ids() alike.
// Read-only by design (D-18) — a component that only reads cannot be handed
// an object with a write method on it.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Every message record under a directory, one JSON file per message, walking subdirectories. */
const readAllIn = (directory) =>
  readdirSync(directory, { recursive: true })
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(directory, name), 'utf8')));

/** Every id the root holds, derived by listing files — walks month shards too. */
const idsIn = (root) => {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true })
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.split(/[\\/]/).pop().replace(/\.json$/, ''));
};

/** @returns {{ ids: Function, readAll: Function }} */
export function createMessageReader(root) {
  return {
    ids: () => idsIn(root),
    readAll: () => readAllIn(root),
  };
}
