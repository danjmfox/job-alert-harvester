// @contract-shape:pure-function
// Structural guards for install-subcommand, read from the source tree (no subprocess): the three new core modules stay pure,
// only the two spawning adapters import `child_process` (DESIGN Q-spawn, ratified), and the tools are spawned by their bare
// names so a PATH shim always wins and no test can reach the operator's real launchd (DESIGN, "Bare-name invariant").
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PROJECT_ROOT } from '../job-alert-harvester/support/domain-types.mjs';
import { scenario } from './support/red-gate.mjs';

const SRC = join(PROJECT_ROOT, 'src');
const sourceFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? sourceFiles(join(directory, entry.name)) : entry.name.endsWith('.mjs') ? [join(directory, entry.name)] : []));
const textOf = (path) => readFileSync(path, 'utf8');
const CORE_MODULES = ['launch-agent', 'install-plan', 'launchd-print'].map((name) => join(SRC, 'core', `${name}.mjs`));
const importSpecifiers = (text) => [...text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);

describe('the three new core modules stay pure', () => {
  for (const path of CORE_MODULES) {
    it(`@structural ${relative(PROJECT_ROOT, path)} exists, imports only sibling core modules, declares no class and never touches process`, () => {
      // Given the module
      expect(existsSync(path)).toBe(true);
      const text = textOf(path);
      // When its imports and syntax are read
      // Then it imports only './' modules, no node: builtin, declares no class, and does not name process
      expect(importSpecifiers(text).every((specifier) => specifier.startsWith('./') && !specifier.startsWith('node:'))).toBe(true);
      expect(text).not.toMatch(/\bclass\s+[A-Za-z_]/);
      expect(text).not.toMatch(/\bprocess\./);
    });
  }
});

describe('spawning is confined to two adapters and always by bare name', () => {
  it('@structural only src/adapters/launchctl.mjs and src/adapters/git-checkout.mjs import child_process', () => {
    // Given the source tree
    // When every module that mentions child_process is listed
    const importers = sourceFiles(SRC).filter((path) => /child_process/.test(textOf(path))).map((path) => relative(PROJECT_ROOT, path)).sort();
    // Then they are those two adapters
    expect(importers).toEqual(['src/adapters/git-checkout.mjs', 'src/adapters/launchctl.mjs']);
  });

  it('@structural the launchctl adapter spawns the bare name launchctl, never a path to it', () => {
    // Given the adapter
    const path = join(SRC, 'adapters/launchctl.mjs');
    expect(existsSync(path)).toBe(true);
    // When its source is read
    const text = textOf(path);
    // Then it names launchctl as a bare word and holds no path ending in it
    expect(text).toMatch(/['"]launchctl['"]/);
    expect(text).not.toMatch(/\/launchctl\b/);
  });

  it('@structural the git adapter spawns the bare name git, never a path to it', () => {
    // Given the adapter
    const path = join(SRC, 'adapters/git-checkout.mjs');
    expect(existsSync(path)).toBe(true);
    // When its source is read
    const text = textOf(path);
    // Then it names git as a bare word and holds no path ending in it
    expect(text).toMatch(/['"]git['"]/);
    expect(text).not.toMatch(/\/git['"\s]/);
  });

  it('@structural nothing in src names an absolute path to launchctl or osascript', () => {
    // Given the source tree, the generated wrapper's text included
    // When every module is read
    const offenders = sourceFiles(SRC).filter((path) => /\/(?:usr\/)?(?:s?bin)\/(?:launchctl|osascript)\b/.test(textOf(path)));
    // Then none holds such a path
    expect(offenders).toEqual([]);
  });
});
