// @walking_skeleton @driving_port
// Exercises the real CLI entry point -> real fixture adapter -> real pure core
// -> real xlsx driven adapter. No layer is mocked.
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';

const ROOT = new URL('../../../', import.meta.url).pathname;

describe('@walking_skeleton harvest LinkedIn job alerts into a workbook', () => {
  let book, jobs, sources, companies;

  beforeAll(() => {
    // GIVEN a corpus of saved LinkedIn job-alert emails
    const out = join(mkdtempSync(join(tmpdir(), 'harvest-')), 'job-alerts.xlsx');
    rmSync(out, { force: true });

    // WHEN the harvester is run through its real command-line entry point
    execFileSync('node', ['src/cli/harvest.mjs', '--in', 'fixtures/linkedin', '--out', out], {
      cwd: ROOT, encoding: 'utf8',
    });

    // THEN a workbook is produced
    expect(existsSync(out)).toBe(true);
    book = XLSX.readFile(out);
    const sheet = (n) => XLSX.utils.sheet_to_json(book.Sheets[n], { defval: null });
    jobs = sheet('Jobs');
    sources = sheet('Sources');
    companies = sheet('Companies');
  });

  it('has the three required tabs', () => {
    expect(book.SheetNames).toEqual(['Sources', 'Companies', 'Jobs']);
  });

  it('collapses resent alerts into one row per canonical job', () => {
    // 22 raw job rows across the 5 fixtures -> 14 distinct jobs
    expect(jobs).toHaveLength(14);
    expect(new Set(jobs.map((j) => j['Dedup Key'])).size).toBe(14);
  });

  it('records how often a repeatedly-advertised job was seen', () => {
    const stealth = jobs.find((j) => j['Dedup Key'] === 'linkedin:4441092711');
    expect(stealth['Times Seen']).toBe(4);
    expect(stealth['Company']).toBe('Stealth iT Consulting');
    expect(stealth['First Seen'] < stealth['Last Seen']).toBe(true);
  });

  it('extracts the core fields for every job', () => {
    for (const j of jobs) {
      expect(j['Job'], 'title').toBeTruthy();
      expect(j['Company'], 'company').toBeTruthy();
      expect(j['Advert Link']).toMatch(/^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+\/$/);
    }
  });

  // Regression for the defect found in the probe: subject salary was smeared
  // across every job in the digest. It belongs to the headline job only.
  it('does not smear the subject salary across other jobs in the digest', () => {
    const headline = jobs.find((j) => j['Dedup Key'] === 'linkedin:4445119872'); // Digital Waffle
    const sibling = jobs.find((j) => j['Dedup Key'] === 'linkedin:4445107205');  // Wealth Dynamix
    expect(headline['Max Salary (annual)']).toBe(75000);
    expect(sibling['Max Salary (annual)']).toBeNull();
  });

  it('derives the saved searches that produced the corpus', () => {
    const terms = sources.map((s) => s['Search Term']);
    expect(terms).toContain('agile coach in Exampleton');
    expect(terms).toContain('scrum master in England');
    expect(sources.every((s) => s['Source'] === 'LinkedIn')).toBe(true);
  });

  it('lists each distinct advertiser once, flagged by type', () => {
    expect(new Set(companies.map((c) => c['Company'])).size).toBe(companies.length);
    const lorien = companies.find((c) => c['Company'] === 'Lorien');
    expect(lorien['Source Type']).toBe('recruiter');
  });

  it('scores fit without filtering anything out at ingest', () => {
    expect(jobs.every((j) => typeof j['Fit Score'] === 'number')).toBe(true);
    expect(jobs.some((j) => j['Fit Score'] >= 3)).toBe(true);
  });
});
