// @contract-shape:unbounded-preservation
// DR-0003 wire-probe-use, extended to the new adapters, plus the structural rules DESIGN promised beyond a
// dependency-cruiser run (none is installed): the Sheets adapters use only what they are handed, and only the shared
// transport attaches a bearer. Reading source text is the check; no production behaviour is executed.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSheetProvisioner } from '../../../src/adapters/sheet-provisioner.mjs';
import { createSheetsCredentialStore } from '../../../src/adapters/credential-store.mjs';
import { createSheetsTargetReader, createSheetsTargetWriter } from '../../../src/adapters/sheets-target.mjs';
import { PROJECT_ROOT } from './support/sheets-domain-types.mjs';

const nowhere = '/nonexistent/probe-presence';
const handed = { store: {}, tokenSource: {}, transport: { read: {}, write: {} }, endpoints: {}, sleep: () => {}, jitter: () => 0 };
const adapters = {
  'sheets-target reader': () => createSheetsTargetReader(handed),
  'sheets-target writer': () => createSheetsTargetWriter(handed),
  'sheet-provisioner': () => createSheetProvisioner({ transport: { write: {} }, tokenSource: {}, endpoints: {} }),
  'sheets credential store': () => createSheetsCredentialStore({ directory: nowhere }),
};
const source = (path) => readFileSync(join(PROJECT_ROOT, path), 'utf8');
const SHEETS_CORE = ['sheets-model', 'sheets-requests', 'import-check', 'sheets-refusals'].map((name) => `src/core/${name}.mjs`);
const SHEETS_ADAPTERS = ['src/adapters/sheets-target.mjs', 'src/adapters/sheet-provisioner.mjs'];

describe('probe presence: every new adapter owning a credential, a network boundary or a file exposes a probe', () => {
  for (const [name, build] of Object.entries(adapters)) {
    it(`${name} exports a probe`, () => {
      expect(typeof build().probe).toBe('function');
    });
  }
});

describe('the architecture rules, checked as text', () => {
  for (const path of SHEETS_ADAPTERS) {
    it(`@error ${path} imports no node: module, no other adapter, and calls no global fetch`, () => {
      const text = source(path);

      expect(text).not.toMatch(/from\s+['"]node:/);
      expect(text).not.toMatch(/from\s+['"]\.\/[a-z-]+\.mjs['"]/);
      expect(text).not.toMatch(/(^|[^.\w])fetch\s*\(/);
    });

    it(`@error ${path} never attaches a bearer header itself`, () => {
      expect(source(path)).not.toMatch(/authorization|bearer/i);
    });
  }

  it('only the shared transport attaches a bearer, and it refuses redirects on every request that carries one', () => {
    const text = source('src/cli/google-transport.mjs');

    expect(text).toMatch(/authorization/i);
    expect(text).toMatch(/redirect:\s*['"]error['"]/);
  });

  for (const path of SHEETS_CORE) {
    it(`@error ${path} is pure: no node: import, no adapter or cli import, no global fetch, no class`, () => {
      const text = source(path);

      expect(text).not.toMatch(/from\s+['"]node:/);
      expect(text).not.toMatch(/from\s+['"]\.\.\/(adapters|cli)\//);
      expect(text).not.toMatch(/(^|[^.\w])fetch\s*\(/);
      expect(text).not.toMatch(/^\s*class\s/m);
    });
  }
});
