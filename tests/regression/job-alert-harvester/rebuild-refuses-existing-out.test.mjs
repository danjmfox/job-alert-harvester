import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { aWorkspace, fileDigests, runHarvest, PROJECT_ROOT } from '../../acceptance/job-alert-harvester/support/domain-types.mjs';

const fixturesDir = join(PROJECT_ROOT, 'fixtures/linkedin');
const workspaces = [];

function isolatedWorkspace() {
  const workspace = aWorkspace();
  workspaces.push(workspace);
  return workspace;
}

afterEach(() => {
  while (workspaces.length > 0) rmSync(workspaces.pop(), { recursive: true, force: true });
});

function typeStatusIntoFirstJob(workbookPath, value) {
  const book = XLSX.readFile(workbookPath);
  const sheet = book.Sheets['Jobs'];
  const header = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0];
  const cell = XLSX.utils.encode_cell({ r: 1, c: header.indexOf('Status') });
  sheet[cell] = { t: 's', v: value };
  XLSX.writeFile(book, workbookPath);
}

function firstJobStatus(workbookPath) {
  const book = XLSX.readFile(workbookPath);
  return XLSX.utils.sheet_to_json(book.Sheets['Jobs'], { defval: null })[0]['Status'];
}

describe('rebuild onto an existing --out regression', () => {
  it('refuses and leaves the file byte-identical, keeping a human-typed Status', () => {
    const workspace = isolatedWorkspace();
    const out = join(workspace, 'tracker.xlsx');
    expect(runHarvest(['--in', fixturesDir, '--out', out]).status).toBe(0);
    typeStatusIntoFirstJob(out, 'Applied');
    const before = fileDigests(workspace);

    const result = runHarvest(['--in', fixturesDir, '--out', out]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('already exists');
    expect(result.stderr).toContain(out);
    expect(result.stderr).toContain('rebuild form');
    expect(fileDigests(workspace)).toEqual(before);
    expect(firstJobStatus(out)).toBe('Applied');
  });

  it('still writes the workbook when --out is a new path', () => {
    const workspace = isolatedWorkspace();
    const outDir = join(workspace, 'out');
    mkdirSync(outDir, { recursive: true });
    const out = join(outDir, 'fresh.xlsx');

    const result = runHarvest(['--in', fixturesDir, '--out', out]);

    expect(result.status).toBe(0);
    expect(existsSync(out)).toBe(true);
    expect(Object.keys(XLSX.readFile(out).Sheets)).toEqual(expect.arrayContaining(['Jobs']));
  });

  it('reports a missing --in before an existing --out', () => {
    const workspace = isolatedWorkspace();
    const out = join(workspace, 'tracker.xlsx');
    expect(runHarvest(['--in', fixturesDir, '--out', out]).status).toBe(0);
    const before = fileDigests(workspace);
    const missingInput = join(workspace, 'no-such-input');

    const result = runHarvest(['--in', missingInput, '--out', out]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`--in ${missingInput} does not exist`);
    expect(result.stderr).not.toContain('already exists');
    expect(fileDigests(workspace)).toEqual(before);
  });
});
