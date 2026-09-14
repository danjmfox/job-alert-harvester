// Driven-adapter integration test (real filesystem, no mocks) — the acceptance
// coverage for this adapter is CLI-level (ingest-fail-closed.test.mjs) and stays
// RED until the `ingest` subcommand is wired in step 01-08. This is the GREEN
// gate for src/adapters/message-cache.mjs until then (DR-0002 storage layout).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, chmodSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMessageCache, CacheRefusal } from '../../../src/adapters/message-cache.mjs';

const aWorkspace = () => mkdtempSync(join(tmpdir(), 'message-cache-'));

/** Every cached record file under `cacheRoot`, relative. Absent root reads as []. */
const cachedFiles = (cacheRoot) => {
  if (!existsSync(cacheRoot)) return [];
  return readdirSync(cacheRoot, { recursive: true }).filter((name) => name.endsWith('.json'));
};

const aRecord = (overrides = {}) => ({
  id: '19f9b40545ae5bbf',
  date: '2026-07-25T09:48:00Z',
  sender: 'jobalerts-noreply@linkedin.com',
  subject: 'Scrum Master & PMO Lead at Digital Waffle',
  snippet: 'Scrum Master & PMO Lead at Digital Waffle',
  plaintextBody: 'Your job alert for agile coach\n',
  ...overrides,
});

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

describe('message cache adapter (DR-0002 storage layout)', () => {
  it('writes a slimmed record under <cacheRoot>/<YYYY-MM>/<id>.json, sharded by the record\'s own date', () => {
    const cacheRoot = join(aWorkspace(), '.cache/messages');
    const cache = createMessageCache(cacheRoot);
    const record = aRecord();

    cache.put(record);

    const writtenPath = join(cacheRoot, '2026-07', `${record.id}.json`);
    expect(existsSync(writtenPath)).toBe(true);
    expect(JSON.parse(readFileSync(writtenPath, 'utf8'))).toEqual(record);
  });

  it('grows the cache by exactly the number of newly put, non-duplicate records', () => {
    const cacheRoot = join(aWorkspace(), '.cache/messages');
    const cache = createMessageCache(cacheRoot);
    const before = cachedFiles(cacheRoot);

    cache.put(aRecord({ id: 'a', date: '2026-07-10T00:00:00Z' }));
    cache.put(aRecord({ id: 'b', date: '2026-08-01T00:00:00Z' }));

    const after = cachedFiles(cacheRoot);
    expect(after.length).toBe(before.length + 2);
    expect(after.sort()).toEqual([join('2026-07', 'a.json'), join('2026-08', 'b.json')].sort());
  });

  it('@error refuses with CacheRefusal.NOT_WRITABLE when the cache root is not writable', () => {
    const workspace = aWorkspace();
    const cacheRoot = join(workspace, '.cache/messages');
    mkdirSync(cacheRoot, { recursive: true });
    chmodSync(cacheRoot, 0o500);
    restorePermissions.push([cacheRoot, 0o755]);
    const cache = createMessageCache(cacheRoot);

    let refusal = null;
    try {
      cache.probe();
    } catch (error) {
      refusal = error.code;
    }

    expect(refusal).toBe(CacheRefusal.NOT_WRITABLE);
  });
});
