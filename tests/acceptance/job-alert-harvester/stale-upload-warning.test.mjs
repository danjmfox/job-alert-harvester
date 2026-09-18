// DR-0005 "Mitigation for (1) and (4) -- partial, and named as partial": the
// interim xlsx target sheet has no concurrency control. If the Google Sheet is
// edited between download and re-upload, those edits are invisible to the
// merge and lost on the next upload. Each write persists a receipt under
// .cache/receipts/; the next merge build compares the target's current digest
// against the last receipt's own output digest **for that target**, and warns
// when they match -- the local file is still the harvester's own last output,
// so it was never uploaded, or the download predates it. The warning is
// advisory: the build still succeeds and the merge still happens
// (DR-0005: "converts an invisible loss into a visible warning. It does not
// prevent the loss.").
//
// Subprocess acceptance layer (real CLI, real filesystem, real xlsx) --
// example-only per Mandate 11, universe-bound assertion per Mandate 8.
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { createTargetSheet } from '../../../src/adapters/xlsx-target-sheet.mjs';
import { aWorkspace, writeJson, aMessage, runHarvest, fileDigests } from './support/domain-types.mjs';
import { assertStateDelta, setTo } from '../../common/state-delta.mjs';

const RECEIPTS_DIR = '.cache/receipts';
const STALE_WARNING = /stale/i;

function writeTracker(target, rows) {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(book, sheet, 'Jobs');
  XLSX.writeFile(book, target);
}

function sha256Of(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Every receipt persisted under .cache/receipts/, parsed. Absent directory reads as []. */
function receiptsUnder(workspace) {
  const dir = join(workspace, RECEIPTS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')));
}

function receiptsCount(workspace) {
  return Object.keys(fileDigests(join(workspace, RECEIPTS_DIR))).length;
}

function cacheAJob(workspace, { id, title, company }) {
  writeJson(join(workspace, `.cache/messages/2026-07/${id}.json`), aMessage({ id, jobs: [{ id, title, company }] }));
}

/** A tracker already merged once -- the state every later scenario in this file
 *  builds on, so the narrative chains through a shared Given+When rather than
 *  re-deriving "a merged tracker" from scratch each time (Pillar 2). */
function givenAMergedTracker(workspace, target, job = { id: '4441092711', title: 'Agile Coach', company: 'Stealth iT Consulting' }) {
  writeTracker(target, [
    ['Dedup Key', 'Job', 'Company'],
    [`linkedin:${job.id}`, job.title, job.company],
  ]);
  cacheAJob(workspace, job);
  const firstRun = runHarvest(['build', '--out', target, '--merge', target], { cwd: workspace });
  return { firstRun, job };
}

describe('@driving_port a merge build warns when the target looks like its own last output (DR-0005)', () => {
  // @contract-shape:bounded-change
  it('persists a receipt naming the target path and the digests of the file it read and wrote, and is not itself flagged stale', () => {
    // Given an existing tracker this project has never built against before
    const workspace = aWorkspace();
    const target = join(workspace, 'tracker.xlsx');
    const job = { id: '4441092711', title: 'Agile Coach', company: 'Stealth iT Consulting' };
    writeTracker(target, [['Dedup Key', 'Job', 'Company'], [`linkedin:${job.id}`, job.title, job.company]]);
    cacheAJob(workspace, job);
    const inputDigest = sha256Of(target);
    const before = { 'cache.receipts.count': receiptsCount(workspace) };

    // When the operator merges the tracker in place, for the first time
    const result = runHarvest(['build', '--out', target, '--merge', target], { cwd: workspace });

    // Then the build succeeds silently -- a first run is not stale -- and a
    // receipt now exists under .cache/receipts/ naming the target path and
    // the digests of what was read and what was written
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toMatch(STALE_WARNING);
    const after = { 'cache.receipts.count': receiptsCount(workspace) };
    assertStateDelta(before, after, { universe: ['cache.receipts.count'], expected: { 'cache.receipts.count': setTo(1) } });
    const [receipt] = receiptsUnder(workspace);
    expect(receipt.targetPath).toBe(target);
    expect(receipt.inputDigest).toBe(inputDigest);
    expect(receipt.outputDigest).toBe(sha256Of(target));
  });

  // @contract-shape:bounded-change
  it('a second build, after new messages arrive but before the target is touched, warns and still merges the new data', () => {
    // Given a tracker already merged once
    const workspace = aWorkspace();
    const target = join(workspace, 'tracker.xlsx');
    givenAMergedTracker(workspace, target);

    // And a new job has since arrived in the cache -- the target itself is
    // still exactly what the first run wrote, never touched since
    const newJob = { id: '9990001111', title: 'Delivery Lead', company: 'Northwind Traders' };
    cacheAJob(workspace, newJob);

    // When the operator merges again
    const result = runHarvest(['build', '--out', target, '--merge', target], { cwd: workspace });

    // Then the build still succeeds and still merges the new job -- the
    // warning is advisory, never a refusal (DR-0005: "does not prevent the
    // loss") -- and it warns that edits made in the sheet since may be lost
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toMatch(STALE_WARNING);
    const rows = createTargetSheet(target).read().tabs.Jobs.rows;
    expect(rows.some((row) => row['Dedup Key'] === `linkedin:${newJob.id}`)).toBe(true);
  });

  // @contract-shape:unbounded-preservation
  it('editing the tracker between two builds -- as an edit in the sheet would -- leaves the next build silent', () => {
    // Given a tracker already merged once
    const workspace = aWorkspace();
    const target = join(workspace, 'tracker.xlsx');
    givenAMergedTracker(workspace, target);

    // And the sheet is edited since -- new bytes at the same path, the way a
    // genuine download-then-upload cycle never reproduces the harvester's own
    // bytes (Google Sheets re-encodes a workbook on download)
    writeTracker(target, [
      ['Dedup Key', 'Job', 'Company', 'Notes'],
      ['linkedin:4441092711', 'Agile Coach', 'Stealth iT Consulting', 'called recruiter, seemed keen'],
    ]);

    // When the operator merges again
    const result = runHarvest(['build', '--out', target, '--merge', target], { cwd: workspace });

    // Then the build succeeds and is silent -- edited outside the loop is the
    // expected, healthy case
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toMatch(STALE_WARNING);
  });

  // @contract-shape:unbounded-preservation
  it('a tracker whose bytes happen to match another target\'s last output is not warned about on its own first build', () => {
    // Given a target already merged once, giving it a receipt of its own
    const workspace = aWorkspace();
    const staleTarget = join(workspace, 'tracker-a.xlsx');
    givenAMergedTracker(workspace, staleTarget);

    // And a second, different tracker that starts out byte-identical to the
    // first target's own last output -- a coincidence of content, not a build
    // history -- with its own job to merge for the first time
    const freshTarget = join(workspace, 'tracker-b.xlsx');
    writeFileSync(freshTarget, readFileSync(staleTarget));
    const otherJob = { id: '9990001111', title: 'Delivery Lead', company: 'Northwind Traders' };
    cacheAJob(workspace, otherJob);

    // When the operator merges the second tracker for the first time
    const result = runHarvest(['build', '--out', freshTarget, '--merge', freshTarget], { cwd: workspace });

    // Then it is not warned about -- receipts are matched per target path, so
    // matching by content alone would wrongly say otherwise
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toMatch(STALE_WARNING);
  });

  // @contract-shape:unbounded-preservation
  it('build --dry-run against a stale target warns too, and writes no receipt because a preview writes nothing', () => {
    // Given a target already stale -- merged once and untouched since
    const workspace = aWorkspace();
    const target = join(workspace, 'tracker.xlsx');
    givenAMergedTracker(workspace, target);
    const before = { 'cache.receipts': fileDigests(join(workspace, RECEIPTS_DIR)) };

    // When the operator previews a merge against it
    const result = runHarvest(['build', '--out', target, '--merge', target, '--dry-run'], { cwd: workspace });

    // Then the preview still warns -- the risk is real regardless of whether
    // this run writes -- but persists no new receipt, because a preview
    // writes nothing (DR-0005: the preview cannot represent "modified the
    // tracker", and a receipt is itself a record of a write)
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toMatch(STALE_WARNING);
    const after = { 'cache.receipts': fileDigests(join(workspace, RECEIPTS_DIR)) };
    assertStateDelta(before, after, { universe: ['cache.receipts'] });
  });
});
