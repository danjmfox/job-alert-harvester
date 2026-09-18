// DR-0004 rule 4 -- when a harvester-owned cell changes value between runs,
// record it: this is the signal that a parser improvement reached history,
// and without a report it is invisible. Summary to stderr, detail to
// `--report <file>`. The summary must distinguish two classes of change:
// a *derived correction* (any harvester-owned column except the sighting
// counters) versus *sighting bookkeeping* (First Seen, Last Seen, Times
// Seen, Jobs Seen, Messages, Jobs Found -- the counters that move every time
// an advert is merely re-seen). Undifferentiated, a correction drowns in
// bookkeeping noise -- measured on the real corpus at ~28:1.
//
// Subprocess acceptance layer (real CLI, real filesystem, real xlsx) --
// example-only per Mandate 11, Universe-bound assertion per Mandate 8.
//
// `--report` is written for both a real build and a `--dry-run` alike, since
// the plan carries `changes` either way (core/merge.mjs is pure -- see
// merge-plan.test.mjs). This file only adds scenarios; it does not modify
// `plan.changes`' existing shape, so the 9 merge-plan.test.mjs scenarios stay
// untouched.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { aWorkspace, writeJson, aMessage, runHarvest, fileDigests } from './support/domain-types.mjs';
import { assertStateDelta } from '../../common/state-delta.mjs';

function writeTracker(target, rows) {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(book, sheet, 'Jobs');
  XLSX.writeFile(book, target);
}

/** A tracker row for a job the harvester will see again -- Company stale (a
 *  derived correction is owed) and First Seen / Last Seen / Times Seen stale
 *  (sighting bookkeeping is owed too), so one run produces both classes of
 *  change on the very same row. */
function aTrackerStaleInBothClasses(target, { company }) {
  writeTracker(target, [
    ['Dedup Key', 'Job', 'Company', 'First Seen', 'Last Seen', 'Times Seen'],
    ['linkedin:4441092711', 'Agile Coach', company, '2026-07-20T00:00:00Z', '2026-07-20T00:00:00Z', 1],
  ]);
}

/** Two messages that both mention the same job -- the harvest re-derives
 *  Times Seen: 2, First Seen: 09:48, Last Seen: 21:48. */
function cacheTwoSightingsOfTheSameJob(workspace, { company }) {
  writeJson(
    join(workspace, '.cache/messages/2026-07/1.json'),
    aMessage({ id: '1', date: '2026-07-25T09:48:00Z', jobs: [{ id: '4441092711', title: 'Agile Coach', company }] }),
  );
  writeJson(
    join(workspace, '.cache/messages/2026-07/2.json'),
    aMessage({ id: '2', date: '2026-07-25T21:48:00Z', jobs: [{ id: '4441092711', title: 'Agile Coach', company }] }),
  );
}

/** The line in a `--report` file naming a single changed cell, if one exists
 *  matching every pattern. `\b1\b`-style boundaries are load-bearing: without
 *  them a bare `1` or `2` would false-match inside the dedup key's own
 *  digits ("...092711..."). One line per changed cell is this test's chosen
 *  report shape -- the spec asks only for content, not incidental format. */
function reportLine(content, ...patterns) {
  return content.split('\n').find((line) => patterns.every((pattern) => pattern.test(line)));
}

describe('@driving_port harvest build reports derived corrections separately from sighting bookkeeping (DR-0004 rule 4)', () => {
  // @contract-shape:bounded-change
  it('a merge build\'s stderr identifies the derived correction and does not classify a sighting counter as one', () => {
    // Given a tracker row stale in Company (a derived correction is owed) and
    // stale in First Seen / Last Seen / Times Seen (bookkeeping is owed too)
    const workspace = aWorkspace();
    const target = join(workspace, 'tracker.xlsx');
    aTrackerStaleInBothClasses(target, { company: 'OldCo Ltd' });
    cacheTwoSightingsOfTheSameJob(workspace, { company: 'Stealth iT Consulting' });

    // When the operator merges the tracker in place
    const result = runHarvest(['build', '--out', target, '--merge', target], { cwd: workspace });

    // Then the build succeeds, and stderr names the one derived correction --
    // its column and its value before and after -- distinctly from bookkeeping
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toMatch(/derived correction/i);
    expect(result.stderr).toContain('linkedin:4441092711');
    expect(result.stderr).toContain('Company');
    expect(result.stderr).toContain('OldCo Ltd');
    expect(result.stderr).toContain('Stealth iT Consulting');
    // And no line naming a sighting counter is ever labelled a correction --
    // this is what "one undifferentiated total" or "Times Seen counted as a
    // correction" would violate
    const sightingCounterLines = result.stderr.split('\n').filter((line) => /Times Seen|Last Seen|First Seen/.test(line));
    for (const line of sightingCounterLines) {
      expect(line.toLowerCase()).not.toContain('correction');
    }
    // And the existing plan/apply summary still goes to stdout -- the new
    // stderr summary is additive, not a replacement
    expect(result.stdout).toMatch(/cell changes:/);
  });

  // @contract-shape:bounded-change
  it('--report <file> records every changed cell -- correction and bookkeeping alike -- with its tab, key, column, and values before and after', () => {
    // Given the same tracker, stale in both classes
    const workspace = aWorkspace();
    const target = join(workspace, 'tracker.xlsx');
    const reportPath = join(workspace, 'changes.txt');
    aTrackerStaleInBothClasses(target, { company: 'OldCo Ltd' });
    cacheTwoSightingsOfTheSameJob(workspace, { company: 'Stealth iT Consulting' });

    // When the operator merges and asks for the detail report
    const result = runHarvest(['build', '--out', target, '--merge', target, '--report', reportPath], { cwd: workspace });

    // Then the build succeeds, and the report file names the derived
    // correction (Company: OldCo Ltd -> Stealth iT Consulting) ...
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(reportPath)).toBe(true);
    const reportContent = readFileSync(reportPath, 'utf8');
    const correctionLine = reportLine(reportContent, /Jobs/, /linkedin:4441092711/, /Company/, /OldCo Ltd/, /Stealth iT Consulting/);
    expect(correctionLine, reportContent).toBeTruthy();
    // ... and the bookkeeping change (Times Seen: 1 -> 2) -- the report is the
    // full detail; only the stderr summary is where the two classes separate
    const bookkeepingLine = reportLine(reportContent, /Jobs/, /linkedin:4441092711/, /Times Seen/, /\b1\b/, /\b2\b/);
    expect(bookkeepingLine, reportContent).toBeTruthy();
  });

  // @contract-shape:unbounded-preservation
  it('a dry-run build with --report writes the report and leaves the workbook untouched', () => {
    // Given a tracker stale in Company, and no prior report file
    const workspace = aWorkspace();
    const target = join(workspace, 'tracker.xlsx');
    const reportPath = join(workspace, 'changes.txt');
    aTrackerStaleInBothClasses(target, { company: 'OldCo Ltd' });
    cacheTwoSightingsOfTheSameJob(workspace, { company: 'Stealth iT Consulting' });
    const before = { 'tracker.digest': fileDigests(workspace)['tracker.xlsx'] };

    // When the operator previews the merge and asks for the detail report
    const result = runHarvest(['build', '--out', target, '--merge', target, '--dry-run', '--report', reportPath], {
      cwd: workspace,
    });

    // Then the preview succeeds, prints its plan to stdout as before, the
    // report is written naming the would-be correction, and the tracker on
    // disk is byte-identical -- a dry-run has no write-mode path to the
    // workbook regardless of whether --report was also passed
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(existsSync(reportPath)).toBe(true);
    const reportContent = readFileSync(reportPath, 'utf8');
    expect(reportLine(reportContent, /Company/, /OldCo Ltd/, /Stealth iT Consulting/), reportContent).toBeTruthy();
    const after = { 'tracker.digest': fileDigests(workspace)['tracker.xlsx'] };
    assertStateDelta(before, after, { universe: ['tracker.digest'] });
  });

  // @contract-shape:bounded-change
  it('a run whose only changes are sighting bookkeeping says plainly there are no derived corrections', () => {
    // Given a tracker row whose Company already matches what the harvester
    // will re-derive, but whose First Seen / Last Seen / Times Seen are stale
    const workspace = aWorkspace();
    const target = join(workspace, 'tracker.xlsx');
    aTrackerStaleInBothClasses(target, { company: 'Stealth iT Consulting' });
    cacheTwoSightingsOfTheSameJob(workspace, { company: 'Stealth iT Consulting' });

    // When the operator merges the tracker in place
    const result = runHarvest(['build', '--out', target, '--merge', target], { cwd: workspace });

    // Then the build succeeds, the sighting counters are still updated (the
    // merge itself is untouched by this feature) ...
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Jobs:[^\n]*cell changes: [1-9]/);
    // ... and stderr states plainly that there were no derived corrections,
    // rather than printing a correction section with nothing under it
    expect(result.stderr).toMatch(/no derived corrections/i);
  });
});
