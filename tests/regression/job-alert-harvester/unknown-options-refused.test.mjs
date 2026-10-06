import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  aWorkspace,
  aMessage,
  fileDigests,
  installRealSpillFixtures,
  writeJson,
  CLI,
} from '../../acceptance/job-alert-harvester/support/domain-types.mjs';
import { holds } from '../../acceptance/gmail-api-source/support/property.mjs';

const directories = [];

function temporaryDirectory(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop(), { recursive: true, force: true });
});

/** The real CLI with an empty HOME, so no operator credential is read and no network call is possible. */
function runCli(args, cwd) {
  const result = spawnSync('node', [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, HOME: temporaryDirectory('harvest-home-') },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const secondMessage = () => aMessage({ id: '2', jobs: [{ id: '999', title: 'Another Role', company: 'Acme' }] });

/** A tracker t.xlsx built from one message, then a second message cached, so a real merge would change t.xlsx. */
function workspaceWithTracker() {
  const workspace = temporaryDirectory('harvest-');
  writeJson(join(workspace, '.cache/messages/2026-07/1.json'), aMessage({}));
  expect(runCli(['build', '--out', 't.xlsx'], workspace).status).toBe(0);
  writeJson(join(workspace, '.cache/messages/2026-07/2.json'), secondMessage());
  return workspace;
}

function workspaceWithCache() {
  const workspace = aWorkspace();
  directories.push(workspace);
  writeJson(join(workspace, '.cache/messages/2026-07/1.json'), aMessage({}));
  return workspace;
}

const MERGE_INTO_TRACKER = ['--out', 't.xlsx', '--merge', 't.xlsx'];

const Refusal = Object.freeze({
  UNKNOWN_OPTION: 'cli.unknown-option',
  UNEXPECTED_ARGUMENT: 'cli.unexpected-argument',
  DUPLICATE_OPTION: 'cli.duplicate-option',
  MISSING_VALUE: 'cli.missing-value',
});

function expectRefusedAndUntouched(workspace, args, code, offendingToken) {
  const before = fileDigests(workspace);

  const result = runCli(args, workspace);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(code);
  expect(result.stderr).toContain(offendingToken);
  expect(result.stderr).not.toContain('ERR_INVALID_ARG_TYPE');
  expect(fileDigests(workspace)).toEqual(before);
  expect(existsSync(join(workspace, '.cache/receipts'))).toBe(false);
}

describe('build refuses a mistyped or misplaced option and changes nothing', () => {
  it.each([
    ['--dryrun', [...MERGE_INTO_TRACKER, '--dryrun'], Refusal.UNKNOWN_OPTION, '--dryrun'],
    ['--dry_run', [...MERGE_INTO_TRACKER, '--dry_run'], Refusal.UNKNOWN_OPTION, '--dry_run'],
    ['-n', [...MERGE_INTO_TRACKER, '-n'], Refusal.UNKNOWN_OPTION, '-n'],
    ['--dry-run=true', [...MERGE_INTO_TRACKER, '--dry-run=true'], Refusal.UNKNOWN_OPTION, '--dry-run=true'],
    ['--dry-run <path> last', [...MERGE_INTO_TRACKER, '--dry-run', 't.xlsx'], Refusal.UNEXPECTED_ARGUMENT, 't.xlsx'],
    ['--dry-run <path> first', ['--dry-run', 't.xlsx', ...MERGE_INTO_TRACKER], Refusal.UNEXPECTED_ARGUMENT, 't.xlsx'],
    ['a stray word', [...MERGE_INTO_TRACKER, 'extra'], Refusal.UNEXPECTED_ARGUMENT, 'extra'],
    ['dry-run without dashes', [...MERGE_INTO_TRACKER, 'dry-run'], Refusal.UNEXPECTED_ARGUMENT, 'dry-run'],
    ['--dry-run twice', [...MERGE_INTO_TRACKER, '--dry-run', '--dry-run'], Refusal.DUPLICATE_OPTION, '--dry-run'],
    ['--merge twice', ['--out', 't.xlsx', '--merge', 'other.xlsx', '--merge', 't.xlsx'], Refusal.DUPLICATE_OPTION, '--merge'],
    ['--merge with no value', ['--out', 't.xlsx', '--merge', '--dry-run'], Refusal.MISSING_VALUE, '--merge'],
    ['--report with no value before --dry-run', [...MERGE_INTO_TRACKER, '--report', '--dry-run'], Refusal.MISSING_VALUE, '--report'],
    ['--report with no value at the end', [...MERGE_INTO_TRACKER, '--dry-run', '--report'], Refusal.MISSING_VALUE, '--report'],
    ['--out with no value before --dry-run', ['--out', '--dry-run'], Refusal.MISSING_VALUE, '--out'],
    ['--out with no value at the end', ['--out'], Refusal.MISSING_VALUE, '--out'],
    ['a bare --target', ['--target'], Refusal.MISSING_VALUE, '--target'],
    ['--target=sheets', ['--target=sheets'], Refusal.UNKNOWN_OPTION, '--target=sheets'],
  ])('%s', (_label, args, code, token) => {
    expectRefusedAndUntouched(workspaceWithTracker(), ['build', ...args], code, token);
  });

  it('lists the valid options, including --dry-run, when an option is unknown', () => {
    const result = runCli(['build', ...MERGE_INTO_TRACKER, '--dryrun'], workspaceWithTracker());

    for (const valid of ['--out', '--merge', '--report', '--target', '--dry-run']) expect(result.stderr).toContain(valid);
    expect(result.stderr).toMatch(/did you mean --dry-run/i);
  });

  it.each([
    ['--dryrun', ['--target', 'sheets', '--dryrun'], Refusal.UNKNOWN_OPTION],
    ['--dry-run <word> after --target', ['--target', 'sheets', '--dry-run', 'x'], Refusal.UNEXPECTED_ARGUMENT],
    ['--dry-run <word> before --target', ['--dry-run', 'x', '--target', 'sheets'], Refusal.UNEXPECTED_ARGUMENT],
  ])('build --target sheets %s is refused before any credential or cache check', (_label, args, code) => {
    const workspace = temporaryDirectory('harvest-');
    const before = fileDigests(workspace);

    const result = runCli(['build', ...args], workspace);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(code);
    expect(result.stderr).not.toContain('credential');
    expect(result.stderr).not.toContain('empty');
    expect(fileDigests(workspace)).toEqual(before);
  });
});

describe('the rebuild form refuses a mistyped or misplaced option and writes nothing', () => {
  it.each([
    ['a typo of the build subcommand', (cache) => ['bild', '--in', cache, '--out', 'z.xlsx'], Refusal.UNEXPECTED_ARGUMENT, 'bild'],
    ['a stray positional', (cache) => ['--in', cache, '--out', 'z.xlsx', 'stray'], Refusal.UNEXPECTED_ARGUMENT, 'stray'],
    ['an unknown --overwrite', (cache) => ['--in', cache, '--out', 'z.xlsx', '--overwrite'], Refusal.UNKNOWN_OPTION, '--overwrite'],
    ['--out=<path>', (cache) => ['--in', cache, '--out=z.xlsx'], Refusal.UNKNOWN_OPTION, '--out=z.xlsx'],
    ['--out twice', (cache) => ['--in', cache, '--out', 'a.xlsx', '--out', 'b.xlsx'], Refusal.DUPLICATE_OPTION, '--out'],
    ['--in twice', (cache) => ['--in', 'nothing', '--in', cache, '--out', 'z.xlsx'], Refusal.DUPLICATE_OPTION, '--in'],
    ['--out with no value', (cache) => ['--in', cache, '--out'], Refusal.MISSING_VALUE, '--out'],
  ])('%s', (_label, argsFor, code, token) => {
    const workspace = workspaceWithCache();
    expectRefusedAndUntouched(workspace, argsFor(join(workspace, '.cache/messages')), code, token);
  });
});

describe('the other subcommands refuse a mistyped option before reading or writing anything', () => {
  const spillWorkspace = () => {
    const workspace = temporaryDirectory('harvest-');
    installRealSpillFixtures(join(workspace, 'spill'));
    return workspace;
  };
  const ingest = (...extra) => ['ingest', '--raw', 'spill', '--window', '2026-09-12..2026-09-12', '--expect', '1', ...extra];

  it.each([
    ['ingest --complet', ingest('--complet'), Refusal.UNKNOWN_OPTION, '--complet'],
    ['ingest --complete <word>', ingest('--complete', 'x'), Refusal.UNEXPECTED_ARGUMENT, 'x'],
    ['ingest --complete=true', ingest('--complete=true'), Refusal.UNKNOWN_OPTION, '--complete=true'],
  ])('%s leaves the cache and coverage ledger untouched', (_label, args, code, token) => {
    expectRefusedAndUntouched(spillWorkspace(), args, code, token);
  });

  it.each([
    ['plan-fetch --form', ['plan-fetch', '--form', '2026-09-10', '--from', '2026-09-10', '--to', '2026-09-10'], Refusal.UNKNOWN_OPTION, '--form'],
    ['plan-fetch --batch=5', ['plan-fetch', '--from', '2026-09-10', '--to', '2026-09-10', '--batch=5'], Refusal.UNKNOWN_OPTION, '--batch=5'],
    ['fetch --sorce', ['fetch', '--sorce', 'glassdoor', '--from', '2026-09-10', '--to', '2026-09-10'], Refusal.UNKNOWN_OPTION, '--sorce'],
    ['auth --targt sheets', ['auth', '--targt', 'sheets'], Refusal.UNKNOWN_OPTION, '--targt'],
    ['import --form', ['import', '--form', 'tracker.xlsx'], Refusal.UNKNOWN_OPTION, '--form'],
    ['auth --target with no value', ['auth', '--target'], Refusal.MISSING_VALUE, '--target'],
  ])('%s is refused before any credential read', (_label, args, code, token) => {
    const workspace = temporaryDirectory('harvest-');
    expectRefusedAndUntouched(workspace, args, code, token);
    expect(runCli(args, workspace).stderr).not.toContain('credential-');
  });
});

describe('a valid command line still reaches its normal behaviour', () => {
  it.each([
    ['--dry-run last', ['--out', 't.xlsx', '--merge', 't.xlsx', '--dry-run']],
    ['--dry-run first', ['--dry-run', '--out', 't.xlsx', '--merge', 't.xlsx']],
    ['--dry-run in the middle', ['--out', 't.xlsx', '--dry-run', '--merge', 't.xlsx']],
  ])('build %s prints a plan and writes nothing', (_label, args) => {
    const workspace = workspaceWithTracker();
    const before = fileDigests(workspace);

    const result = runCli(['build', ...args], workspace);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('harvest build --dry-run: plan');
    expect(fileDigests(workspace)).toEqual(before);
    expect(existsSync(join(workspace, '.cache/receipts'))).toBe(false);
  });

  it('build --report <path> --dry-run writes the report and leaves the tracker and receipts alone', () => {
    const workspace = workspaceWithTracker();
    const before = fileDigests(workspace);

    const result = runCli(['build', ...MERGE_INTO_TRACKER, '--report', 'r.txt', '--dry-run'], workspace);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('harvest build --dry-run: plan');
    expect(existsSync(join(workspace, 'r.txt'))).toBe(true);
    expect(fileDigests(workspace)['t.xlsx']).toEqual(before['t.xlsx']);
    expect(existsSync(join(workspace, '.cache/receipts'))).toBe(false);
  });

  it('build --out <new> --dry-run prints a plan and creates no workbook', () => {
    const workspace = workspaceWithCache();
    const before = fileDigests(workspace);

    const result = runCli(['build', '--out', 'new.xlsx', '--dry-run'], workspace);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('harvest build --dry-run: plan');
    expect(existsSync(join(workspace, 'new.xlsx'))).toBe(false);
    expect(fileDigests(workspace)).toEqual(before);
  });

  it('build --out <new> writes the workbook', () => {
    const workspace = workspaceWithCache();

    const result = runCli(['build', '--out', 'new.xlsx'], workspace);

    expect(result.status).toBe(0);
    expect(existsSync(join(workspace, 'new.xlsx'))).toBe(true);
  });

  it('the rebuild form writes a workbook to a new --out', () => {
    const workspace = workspaceWithCache();
    mkdirSync(join(workspace, 'out'));

    const result = runCli(['--in', join(workspace, '.cache/messages'), '--out', join(workspace, 'out/z.xlsx')], workspace);

    expect(result.status).toBe(0);
    expect(existsSync(join(workspace, 'out/z.xlsx'))).toBe(true);
  });

  it('plan-fetch with valid options prints its window', () => {
    const result = runCli(['plan-fetch', '--source', 'linkedin', '--from', '2026-09-10', '--to', '2026-09-13', '--batch', '25'], temporaryDirectory('harvest-'));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('2026-09-10..2026-09-10');
    expect(result.stdout).toContain('batch=25');
  });

  it('ingest --complete in the middle of the line commits coverage', () => {
    const workspace = temporaryDirectory('harvest-');
    installRealSpillFixtures(join(workspace, 'spill'));

    const result = runCli(['ingest', '--raw', 'spill', '--complete', '--window', '2026-09-12..2026-09-12', '--expect', '1'], workspace);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('coverage committed for 2026-09-12..2026-09-12');
  });

  it('build --target drive is still an unknown target, and --out with --target sheets still conflicts', () => {
    const workspace = workspaceWithCache();

    expect(runCli(['build', '--target', 'drive'], workspace).stderr).toContain('build.unknown-target');
    expect(runCli(['build', '--target', 'sheets', '--out', 't.xlsx'], workspace).stderr).toContain('build.target-conflict');
  });
});

describe('parseCommandLine is strict over every subcommand option table', () => {
  const loadParser = () => import('../../../src/core/cli-options.mjs');
  const valueText = fc.stringMatching(/^[A-Za-z0-9_./][A-Za-z0-9_./-]{0,11}$/);
  const refusalCodeOf = (parse) => {
    try {
      parse();
    } catch (error) {
      return error.code;
    }
    return null;
  };

  it('has a table for the rebuild form and every subcommand', async () => {
    const { OPTION_TABLES } = await loadParser();

    expect(Object.keys(OPTION_TABLES).sort()).toEqual(['auth', 'build', 'fetch', 'import', 'ingest', 'plan-fetch', 'rebuild', 'update']);
  });

  it('refuses any option name that is not in the table', async () => {
    const { OPTION_TABLES, parseCommandLine, CliRefusal } = await loadParser();
    const unknownName = (table) => fc.stringMatching(/^[a-z][a-z0-9_=-]{0,12}$/).filter((name) => !Object.hasOwn(table, name));

    for (const [subcommand, table] of Object.entries(OPTION_TABLES)) {
      holds(
        fc.property(unknownName(table), valueText, (name, value) => {
          expect(refusalCodeOf(() => parseCommandLine(subcommand, [`--${name}`]))).toBe(CliRefusal.UNKNOWN_OPTION);
          expect(refusalCodeOf(() => parseCommandLine(subcommand, [`--${name}`, value]))).toBe(CliRefusal.UNKNOWN_OPTION);
        }),
      );
    }
  });

  it('parses any valid combination of table options to exactly the values given', async () => {
    const { OPTION_TABLES, DATE_OPTIONS, parseCommandLine } = await loadParser();
    const realDay = fc
      .tuple(fc.integer({ min: 1000, max: 2999 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
      .map(([year, month, day]) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    const dayRange = fc.tuple(realDay, realDay).map(([first, last]) => `${first}..${last}`);
    const valueFor = (subcommand, name) => {
      if (!Object.hasOwn(DATE_OPTIONS[subcommand] ?? {}, name)) return valueText;
      return name === 'window' ? dayRange : realDay;
    };

    for (const [subcommand, table] of Object.entries(OPTION_TABLES)) {
      const names = Object.keys(table);
      const combination = fc.shuffledSubarray(names).chain((chosen) =>
        fc.tuple(fc.constant(chosen), fc.tuple(...chosen.map((name) => valueFor(subcommand, name)))),
      );
      holds(
        fc.property(combination, ([chosen, texts]) => {
          const given = chosen.map((name, index) => [name, table[name] === 'value' ? texts[index] : null]);
          const argv = given.flatMap(([name, text]) => (text === null ? [`--${name}`] : [`--${name}`, text]));

          const parsed = parseCommandLine(subcommand, argv);

          const expectedValues = Object.fromEntries(given.filter(([, text]) => text !== null));
          const expectedFlags = new Set(given.filter(([, text]) => text === null).map(([name]) => name));
          expect(parsed).toEqual({ ...expectedValues, flags: expectedFlags });
        }),
      );
    }
  });

  it('refuses a positional token, a repeated option and a value option with no value', async () => {
    const { OPTION_TABLES, parseCommandLine, CliRefusal } = await loadParser();

    for (const [subcommand, table] of Object.entries(OPTION_TABLES)) {
      const valueNames = Object.keys(table).filter((name) => table[name] === 'value');
      holds(
        fc.property(valueText, (word) => {
          expect(refusalCodeOf(() => parseCommandLine(subcommand, [word]))).toBe(CliRefusal.UNEXPECTED_ARGUMENT);
        }),
      );
      for (const name of Object.keys(table)) {
        const once = table[name] === 'value' ? [`--${name}`, 'x'] : [`--${name}`];
        expect(refusalCodeOf(() => parseCommandLine(subcommand, [...once, ...once]))).toBe(CliRefusal.DUPLICATE_OPTION);
      }
      for (const name of valueNames) {
        expect(refusalCodeOf(() => parseCommandLine(subcommand, [`--${name}`]))).toBe(CliRefusal.MISSING_VALUE);
        expect(refusalCodeOf(() => parseCommandLine(subcommand, [`--${name}`, `--${name}`]))).toBe(CliRefusal.MISSING_VALUE);
      }
    }
  });
});
