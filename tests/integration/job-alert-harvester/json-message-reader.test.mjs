// Driven-adapter integration test (real filesystem, no mocks) — read side of
// the cache/fixture split (D-18). Relocated from message-cache.test.mjs: the
// cache writer's messageIds() moved here as ids(), the port this reader owns.
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMessageCache } from '../../../src/adapters/message-cache.mjs';
import { createMessageReader } from '../../../src/adapters/json-message-reader.mjs';

const aWorkspace = () => mkdtempSync(join(tmpdir(), 'json-message-reader-'));

const aRecord = (overrides = {}) => ({
  id: '19f9b40545ae5bbf',
  date: '2026-07-25T09:48:00Z',
  sender: 'jobalerts-noreply@linkedin.com',
  subject: 'Scrum Master & PMO Lead at Digital Waffle',
  snippet: 'Scrum Master & PMO Lead at Digital Waffle',
  plaintextBody: 'Your job alert for agile coach\n',
  ...overrides,
});

describe('json message reader adapter (DR-0002 storage layout)', () => {
  it('ids() derives the processed-id set by listing the cache — no separate ledger (DR-0002)', () => {
    const cacheRoot = join(aWorkspace(), '.cache/messages');
    const cache = createMessageCache(cacheRoot);
    const reader = createMessageReader(cacheRoot);
    expect(reader.ids()).toEqual([]);

    cache.put(aRecord({ id: 'a', date: '2026-07-10T00:00:00Z' }));
    cache.put(aRecord({ id: 'b', date: '2026-08-01T00:00:00Z' }));

    expect(reader.ids().sort()).toEqual(['a', 'b']);
  });
});
