import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractJobs } from '../../../src/core/parse-linkedin.mjs';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/linkedin-variants');

function loadFixture(id) {
  return JSON.parse(readFileSync(path.join(fixturesDir, `${id}.json`), 'utf8'));
}

function jobById(jobs, jobId) {
  return jobs.find((job) => job.dedupKey === `linkedin:${jobId}`);
}

function triple(job) {
  return [job.title, job.company, job.location];
}

describe('LinkedIn block-anchor regression', () => {
  it('a block with an unfiltered preamble line no longer shifts the extracted title/company/location triple', () => {
    // 1a05bf0e7d2000d8 (preamble): "New jobs match your preferences." precedes the real
    // triple. The message carries two job cards — the trailing card must not be dropped
    // while the shift on the first card is fixed.
    const preambleJobs = extractJobs(loadFixture('1a05bf0e7d2000d8'));
    expect(preambleJobs).toHaveLength(2);
    expect(triple(jobById(preambleJobs, '4461201857'))).toEqual([
      'Release Train Manager, Economic Crime',
      'NatWest Group',
      'London',
    ]);

    // 1a05c5fb49972c37 (raw HTML + "Manage alerts:" gap + other-alerts cross-sell header):
    // both the primary card and the cross-sell card must yield correct triples.
    const rawHtmlJobs = extractJobs(loadFixture('1a05c5fb49972c37'));
    expect(triple(jobById(rawHtmlJobs, '4461201857'))).toEqual([
      'Release Train Manager, Economic Crime',
      'NatWest Group',
      'London',
    ]);
    expect(triple(jobById(rawHtmlJobs, '4449577159'))).toEqual([
      'Manager Global Service Engineering CIBP',
      'Cytiva',
      'Portsmouth',
    ]);

    // 1a09be37fadab08b (alert-created confirmation): two confirmation sentences precede
    // the real triple.
    const confirmationJobs = extractJobs(loadFixture('1a09be37fadab08b'));
    expect(triple(jobById(confirmationJobs, '4464603052'))).toEqual([
      'Head of Technology Transformation',
      'Investigo',
      'United Kingdom',
    ]);

    // 1a067f6097dc5f98 (Edit alert + token lines): corrupted continuation-token lines
    // must not swallow the real location.
    const tokenLineJobs = extractJobs(loadFixture('1a067f6097dc5f98'));
    expect(triple(jobById(tokenLineJobs, '4459555988'))).toEqual([
      'Commercial Contract and Performance Manager – Imaging Infrastructure',
      'University Hospital Southampton NHS FT',
      'Southampton',
    ]);
  });

  it('a singular alum count is trailing noise, not a meaningful line', () => {
    // 1a067195f7e7fe3d: two job cards trailed by the singular "1 company alum" form —
    // LinkedIn drops the plural at count 1. Both must extract the same triple shape as
    // the plural "N company alumni" form, with no shift onto the location/company lines.
    const singularAlumJobs = extractJobs(loadFixture('1a067195f7e7fe3d'));
    expect(triple(jobById(singularAlumJobs, '4458467067'))).toEqual([
      'Agile Coach',
      'Barclays',
      'Northampton',
    ]);
    expect(triple(jobById(singularAlumJobs, '4460279884'))).toEqual([
      'Senior Manager, Capabilities, Organisation Effectiveness & Agility',
      'Baringa',
      'London',
    ]);

    // The pre-existing plural form in the same message must keep matching.
    expect(triple(jobById(singularAlumJobs, '4452494445'))).toEqual([
      'Agile Team Lead (Healthcare)',
      'Kainos',
      'The Home',
    ]);
  });

  it('a per-card salary line is trailing noise, not the location', () => {
    // 1a09a2b19d112bb8: the "Senior Scrum Master" card carries a salary line
    // ("£59K-£78K / year") directly below its location. Without treating it as
    // noise, tripleAbove() shifts and reads the salary line as the location.
    const salaryLineJobs = extractJobs(loadFixture('1a09a2b19d112bb8'));
    expect(triple(jobById(salaryLineJobs, '4456258182'))).toEqual([
      'Senior Scrum Master',
      'Leonardo',
      'Gloucester',
    ]);

    // The subject-line salary still attaches only to the headline job named in
    // the subject ("Project Engineering Manager"), never to this trailing card.
    const salaryLineJob = jobById(salaryLineJobs, '4456258182');
    expect(salaryLineJob.minSalary).toBeNull();
    expect(salaryLineJob.maxSalary).toBeNull();
  });
});
