// DR-0013: the layering rules are enforced by dependency-cruiser. The first test runs the repo's config over the real
// tree; the second proves each rule reports when broken, so a misconfigured rule cannot pass silently.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = join(PROJECT_ROOT, '.dependency-cruiser.cjs');
const CLI = join(PROJECT_ROOT, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruiser.mjs');

const cruise = (cwd) => {
  const run = spawnSync(process.execPath, [CLI, 'src', '--config', CONFIG, '--output-type', 'json'], { cwd, encoding: 'utf8' });
  if (run.status === null || run.stdout.trim() === '') {
    throw new Error(`dependency-cruiser did not run: ${run.error?.message ?? ''}${run.stderr}`);
  }
  return JSON.parse(run.stdout).summary.violations;
};

const BROKEN_TREE = {
  'src/core/uses-fs.mjs': "import { readFileSync } from 'node:fs';\nexport const a = readFileSync;\n",
  'src/core/uses-adapter.mjs': "import { x } from '../adapters/plain.mjs';\nexport const b = x;\n",
  'src/core/uses-cli.mjs': "import { y } from '../cli/main.mjs';\nexport const c = y;\n",
  'src/adapters/plain.mjs': "import { z } from './other.mjs';\nexport const x = z;\n",
  'src/adapters/other.mjs': 'export const z = 1;\n',
  'src/adapters/sheets-target.mjs': "import { join } from 'node:path';\nexport const t = join;\n",
  'src/cli/main.mjs': 'export const y = 1;\n',
  'src/adapters/spawns.mjs': "import { spawnSync } from 'node:child_process';\nexport const s = spawnSync;\n",
  'src/core/cycle-a.mjs': "import { d } from './cycle-b.mjs';\nexport const e = d;\n",
  'src/core/cycle-b.mjs': "import { e } from './cycle-a.mjs';\nexport const d = e;\n",
};

const EXPECTED_RULES = {
  'core-imports-no-node-builtin': 'src/core/uses-fs.mjs',
  'core-imports-no-adapter': 'src/core/uses-adapter.mjs',
  'core-imports-no-cli': 'src/core/uses-cli.mjs',
  'adapter-imports-no-sibling-adapter': 'src/adapters/plain.mjs',
  'capability-adapter-imports-no-node-module': 'src/adapters/sheets-target.mjs',
  'child-process-confined-to-spawning-adapters': 'src/adapters/spawns.mjs',
  'no-circular': 'src/core/cycle-a.mjs',
};

describe('layering rules (DR-0013)', () => {
  it('the real source tree obeys the layering rules', () => {
    // Given the repo's dependency-cruiser config
    // When it is run over the real src/ tree
    const violations = cruise(PROJECT_ROOT);
    // Then nothing is reported
    expect(violations.map((v) => `${v.rule.name}: ${v.from} -> ${v.to}`)).toEqual([]);
  });

  it('each rule reports when broken', () => {
    // Given a tree that breaks each rule once
    const dir = mkdtempSync(join(tmpdir(), 'layering-'));
    try {
      for (const [path, text] of Object.entries(BROKEN_TREE)) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), text);
      }
      // When the same config runs over it
      const violations = cruise(dir);
      // Then every rule reports, on the module that breaks it
      for (const [rule, from] of Object.entries(EXPECTED_RULES)) {
        expect(violations.some((v) => v.rule.name === rule && v.from === from), `${rule} on ${from}`).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
