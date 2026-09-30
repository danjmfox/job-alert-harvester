import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  anInterval,
  fileDigests,
  installRealSpillFixtures,
  writeJson,
  CLI,
} from '../../acceptance/job-alert-harvester/support/domain-types.mjs';

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

const Refusal = Object.freeze({
  INVALID_DATE: 'cli.invalid-date',
  INVERTED_INTERVAL: 'coverage.interval.inverted',
});

const LEDGER = '.cache/coverage.json';

/** A workspace holding a raw spill directory that would commit cleanly for 2026-09-12, and a ledger already on disk. */
function workspaceWithSpillAndLedger() {
  const workspace = temporaryDirectory('harvest-');
  installRealSpillFixtures(join(workspace, 'spill'));
  writeJson(join(workspace, LEDGER), [anInterval({ from: '2026-01-01', to: '2026-01-05' })]);
  return workspace;
}

function expectRefusedAndUntouched(workspace, args, code, offendingToken) {
  const before = fileDigests(workspace);
  const ledgerBefore = existsSync(join(workspace, LEDGER)) ? readFileSync(join(workspace, LEDGER)) : null;

  const result = runCli(args, workspace);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(code);
  expect(result.stderr).toContain(offendingToken);
  expect(fileDigests(workspace)).toEqual(before);
  expect(existsSync(join(workspace, '.cache/receipts'))).toBe(false);
  expect(existsSync(join(workspace, LEDGER)) ? readFileSync(join(workspace, LEDGER)) : null).toEqual(ledgerBefore);
}

const planFetch = (from, to) => ['plan-fetch', '--source', 'linkedin', '--from', from, '--to', to, '--batch', '1'];
const ingest = (window, ...extra) => ['ingest', '--raw', 'spill', '--window', window, '--expect', '1', '--complete', ...extra];

describe('plan-fetch refuses a --from or --to that is not a real calendar day, and reads and writes nothing', () => {
  it.each([
    ['a three-digit month, 2025-012-01', planFetch('2025-012-01', '2025-12-02'), '2025-012-01'],
    ['an unpadded month and day, 2026-2-1', planFetch('2026-2-1', '2026-02-03'), '2026-2-1'],
    ['a --to of 2026-02-31', planFetch('2026-02-01', '2026-02-31'), '2026-02-31'],
    ['a --from of 2026-02-30', planFetch('2026-02-30', '2026-03-02'), '2026-02-30'],
    ['a --from of banana', planFetch('banana', '2026-03-02'), 'banana'],
    ['a --to of banana', planFetch('2026-01-01', 'banana'), 'banana'],
    ['a --from with no day, 2026-05', planFetch('2026-05', '2026-06-01'), '2026-05'],
    ['month 13 on both ends', planFetch('2026-13-01', '2026-13-02'), '2026-13-01'],
  ])('%s', (_label, args, token) => {
    expectRefusedAndUntouched(workspaceWithSpillAndLedger(), args, Refusal.INVALID_DATE, token);
  });

  it('names the option, the offending token and the expected shape', () => {
    const result = runCli(planFetch('2026-02-30', '2026-03-02'), workspaceWithSpillAndLedger());

    expect(result.stderr).toContain('--from');
    expect(result.stderr).toContain('2026-02-30');
    expect(result.stderr).toContain('YYYY-MM-DD');
  });
});

describe('fetch refuses a --from or --to that is not a real calendar day before any credential is read', () => {
  it.each([
    ['--to banana', ['fetch', '--from', '2026-01-01', '--to', 'banana'], 'banana'],
    ['--from 2026-02-30', ['fetch', '--from', '2026-02-30', '--to', '2026-03-02'], '2026-02-30'],
  ])('%s', (_label, args, token) => {
    const workspace = workspaceWithSpillAndLedger();
    expectRefusedAndUntouched(workspace, args, Refusal.INVALID_DATE, token);
    expect(runCli(args, workspace).stderr).not.toContain('credential');
  });
});

describe('ingest refuses a --window half that is not a real calendar day and leaves the ledger byte-identical', () => {
  it.each([
    ['banana..banana', 'banana..banana', 'banana'],
    ['month 13 on both halves', '2026-13-01..2026-13-02', '2026-13-01'],
    ['a valid first half and an impossible second half', '2026-09-12..2026-09-31', '2026-09-31'],
    ['an impossible first half and a valid second half', '2026-02-30..2026-09-12', '2026-02-30'],
    ['an unpadded first half', '2026-9-12..2026-09-12', '2026-9-12'],
  ])('%s', (_label, window, token) => {
    expectRefusedAndUntouched(workspaceWithSpillAndLedger(), ingest(window), Refusal.INVALID_DATE, token);
  });

  it('keeps its shape refusal for a window with no ..', () => {
    const workspace = workspaceWithSpillAndLedger();
    const before = fileDigests(workspace);

    const result = runCli(ingest('2026-01-01'), workspace);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--window must be formatted <from>..<to>');
    expect(result.stderr).not.toContain(Refusal.INVALID_DATE);
    expect(fileDigests(workspace)).toEqual(before);
  });
});

describe('real days are still accepted', () => {
  it.each([
    ['a range across a month end', planFetch('2026-02-28', '2026-03-01'), '2026-02-28..2026-02-28'],
    ['a leap day', planFetch('2028-02-29', '2028-02-29'), '2028-02-29..2028-02-29'],
    ['a single day', planFetch('2026-01-01', '2026-01-01'), '2026-01-01..2026-01-01'],
    ['the first day of year 1', planFetch('0001-01-01', '0001-01-01'), '0001-01-01..0001-01-01'],
  ])('plan-fetch offers %s', (_label, args, offered) => {
    const result = runCli(args, temporaryDirectory('harvest-'));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(offered);
    expect(result.stderr).not.toContain(Refusal.INVALID_DATE);
  });

  it('ingest still commits a real window', () => {
    const workspace = temporaryDirectory('harvest-');
    installRealSpillFixtures(join(workspace, 'spill'));

    const result = runCli(['ingest', '--raw', 'spill', '--window', '2026-09-12..2026-09-12', '--expect', '1', '--complete'], workspace);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('coverage committed for 2026-09-12..2026-09-12');
  });

  it('plan-fetch still reports real but inverted days as inverted, not as invalid dates', () => {
    const result = runCli(planFetch('2026-03-01', '2026-02-01'), temporaryDirectory('harvest-'));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(Refusal.INVERTED_INTERVAL);
    expect(result.stderr).not.toContain(Refusal.INVALID_DATE);
  });
});
