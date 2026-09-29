// @contract-shape:unbounded-preservation
// DR-0003 wire-probe-use: every adapter owning durable state, a credential or a
// network boundary exposes a probe, so the composition root can prove it works
// before anything is fetched or written. Losing one would let a broken adapter
// commit "covered, zero messages". The pure readers/writers are out of scope.
import { describe, expect, it } from 'vitest';
import { createLedgerStore } from '../../../src/adapters/ledger-store.mjs';
import { createMessageCache } from '../../../src/adapters/message-cache.mjs';
import { createRawSpillSource } from '../../../src/adapters/raw-spill-source.mjs';
import { createTargetSheet } from '../../../src/adapters/xlsx-target-sheet.mjs';
import { createCredentialStore } from '../../../src/adapters/credential-store.mjs';
import { createGoogleTokenSource } from '../../../src/adapters/google-token-source.mjs';
import { createGmailApiSource } from '../../../src/adapters/gmail-api-source.mjs';

const nowhere = '/nonexistent/probe-presence';
const store = createCredentialStore({ directory: nowhere });
const tokenSource = createGoogleTokenSource({ store, fetch: () => {}, endpoints: {}, nowMs: () => 0, sleep: () => {}, jitter: () => 0 });

const adapters = {
  'ledger-store': () => createLedgerStore(`${nowhere}/ledger.json`),
  'message-cache': () => createMessageCache(nowhere),
  'raw-spill-source': () => createRawSpillSource(nowhere),
  'xlsx-target-sheet': () => createTargetSheet(`${nowhere}/target.xlsx`),
  'credential-store': () => store,
  'google-token-source': () => tokenSource,
  'gmail-api-source': () =>
    createGmailApiSource({ store, tokenSource, get: () => {}, endpoints: {}, sender: 'a@b.c', sleep: () => {}, jitter: () => 0 }),
};

describe('probe presence: durable-state, credential and network adapters expose a probe', () => {
  it.each(Object.entries(adapters))('%s exports a probe', (_name, build) => {
    expect(typeof build().probe).toBe('function');
  });
});
