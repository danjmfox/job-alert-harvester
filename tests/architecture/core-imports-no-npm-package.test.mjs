// DR-0021 rule 2 and DDD-16: src/core imports no npm package, so the HTML scanner cannot quietly become a parser
// dependency inside the process that holds the Gmail and Sheets credentials. Same shape as layering.test.mjs: the
// rule is proven by a tree that breaks it. Adapters may import packages (the xlsx adapters do), so the tree also
// holds one that must stay unreported. Slice 01b adds the rule to .dependency-cruiser.cjs in its first commit; the
// crafter may fold this tree into layering.test.mjs once the rule exists.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = join(PROJECT_ROOT, '.dependency-cruiser.cjs');
const CLI = join(PROJECT_ROOT, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruiser.mjs');

const RULE = 'core-imports-no-npm-package';

const cruise = (cwd) => {
  const run = spawnSync(process.execPath, [CLI, 'src', '--config', CONFIG, '--output-type', 'json'], { cwd, encoding: 'utf8' });
  if (run.status === null || run.stdout.trim() === '') {
    throw new Error(`dependency-cruiser did not run: ${run.error?.message ?? ''}${run.stderr}`);
  }
  return JSON.parse(run.stdout).summary.violations;
};

const TREE = {
  'package.json': JSON.stringify({ name: 'tree-under-test', private: true, type: 'module', dependencies: { 'some-package': '1.0.0' } }),
  'node_modules/some-package/package.json': JSON.stringify({ name: 'some-package', version: '1.0.0', main: 'index.js' }),
  'node_modules/some-package/index.js': 'module.exports = { thing: 1 };\n',
  'src/core/uses-package.mjs': "import { thing } from 'some-package';\nexport const a = thing;\n",
  'src/core/uses-sibling.mjs': "import { a } from './uses-package.mjs';\nexport const b = a;\n",
  'src/adapters/uses-package.mjs': "import { thing } from 'some-package';\nexport const c = thing;\n",
};

describe('the core takes no package (DR-0021, DDD-16)', () => {
  it('reports a package imported by src/core, and only that one', () => {
    // Given a tree in which the core imports a package, and so does an adapter, and the core also imports its own sibling
    const dir = mkdtempSync(join(tmpdir(), 'no-npm-in-core-'));
    try {
      for (const [path, text] of Object.entries(TREE)) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), text);
      }

      // When the repo's dependency-cruiser config runs over it
      const violations = cruise(dir).filter((violation) => violation.rule.name === RULE);

      // Then the rule reports the core module that imports the package, and nothing else
      expect(violations.map((violation) => `${violation.from} -> ${violation.to}`)).toEqual(['src/core/uses-package.mjs -> node_modules/some-package/index.js']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
