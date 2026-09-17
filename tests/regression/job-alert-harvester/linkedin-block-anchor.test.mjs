import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractJobs } from '../../../src/core/parse-linkedin.mjs';
import { harvest } from '../../../src/core/harvest.mjs';

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

    // Emerged requirement (01-05, approved 2026-09-14): the card-level range
    // is captured onto the row rather than discarded — it is noise only with
    // respect to the title/company/location triple, not to the salary the
    // card carries.
    const salaryLineJob = jobById(salaryLineJobs, '4456258182');
    expect(salaryLineJob.minSalary).toBe(59000);
    expect(salaryLineJob.maxSalary).toBe(78000);
  });

  it('a per-card salary range populates both min and max, beating the subject ceiling', () => {
    // Reuses the Leonardo fixture from 01-04. Job 4456258182 (Senior Scrum
    // Master) carries its own range — it must win over the subject-line
    // ceiling because it is a more specific, per-card figure.
    const jobs = extractJobs(loadFixture('1a09a2b19d112bb8'));
    const cardSalaryJob = jobById(jobs, '4456258182');
    expect(triple(cardSalaryJob)).toEqual(['Senior Scrum Master', 'Leonardo', 'Gloucester']);
    expect(cardSalaryJob.minSalary).toBe(59000);
    expect(cardSalaryJob.maxSalary).toBe(78000);

    // Precedence: a job that is BOTH the headline named in the subject AND
    // carries its own card salary uses the card's range, not the subject's
    // ceiling — because the card carries a range where the subject carries
    // only a ceiling.
    const precedenceMessage = {
      id: 'precedence-test',
      date: '2026-09-14T00:00:00Z',
      sender: 'jobalerts-noreply@linkedin.com',
      subject: 'Project Engineering Manager at Leonardo UK Ltd: up to £90K/year',
      plaintextBody: [
        'Your job alert for engineering manager in England',
        '',
        'Project Engineering Manager',
        'Leonardo',
        'Southampton',
        '£65K-£74K / year',
        '',
        'This company is actively hiring',
        'View job: https://www.linkedin.com/comm/jobs/view/4456258999/?trackingId=REDACTED',
      ].join('\n'),
    };
    const [precedenceJob] = extractJobs(precedenceMessage);
    expect(triple(precedenceJob)).toEqual(['Project Engineering Manager', 'Leonardo', 'Southampton']);
    expect(precedenceJob.minSalary).toBe(65000);
    expect(precedenceJob.maxSalary).toBe(74000);

    // A card salary denominated per hour or per day is recognised as noise
    // (so it cannot shift the triple) but is written to no salary column —
    // DR-0004 keeps `Min Salary (hourly)` / `Day Rate` human-owned.
    const nonAnnualMessage = {
      id: 'non-annual-test',
      date: '2026-09-14T00:00:00Z',
      sender: 'jobalerts-noreply@linkedin.com',
      subject: 'Interim Delivery Manager at Acme Corp',
      plaintextBody: [
        'Your job alert for delivery manager in England',
        '',
        'Interim Delivery Manager',
        'Acme Corp',
        'Bristol',
        '£45 / hour',
        '',
        'This company is actively hiring',
        'View job: https://www.linkedin.com/comm/jobs/view/4456258997/?trackingId=REDACTED',
        '',
        '---------------------------------------------------------',
        '',
        'Contract Programme Lead',
        'Acme Corp',
        'Leeds',
        '£500 / day',
        '',
        'This company is actively hiring',
        'View job: https://www.linkedin.com/comm/jobs/view/4456258996/?trackingId=REDACTED',
      ].join('\n'),
    };
    const nonAnnualJobs = extractJobs(nonAnnualMessage);
    const hourlyJob = jobById(nonAnnualJobs, '4456258997');
    expect(triple(hourlyJob)).toEqual(['Interim Delivery Manager', 'Acme Corp', 'Bristol']);
    expect(hourlyJob.minSalary).toBeNull();
    expect(hourlyJob.maxSalary).toBeNull();

    const dayRateJob = jobById(nonAnnualJobs, '4456258996');
    expect(triple(dayRateJob)).toEqual(['Contract Programme Lead', 'Acme Corp', 'Leeds']);
    expect(dayRateJob.minSalary).toBeNull();
    expect(dayRateJob.maxSalary).toBeNull();
  });

  it('an hourly rate in the subject never becomes an annual salary', () => {
    // Real defect (audited 2026-09-14): the subject-salary regex captured the
    // amount but ignored the unit that followed it, so "up to £45/hour" was
    // filed as Max Salary (annual) = 45 — a plausible-but-wrong figure.
    const hourlyMessage = {
      id: 'subject-hourly-test',
      date: '2026-09-14T00:00:00Z',
      sender: 'jobalerts-noreply@linkedin.com',
      subject: 'Financial Accountant at Venture Recruitment Partners: up to £45/hour',
      plaintextBody: [
        'Your job alert for financial accountant in England',
        '',
        'Financial Accountant',
        'Venture Recruitment Partners',
        'Reading',
        '',
        'This company is actively hiring',
        'View job: https://www.linkedin.com/comm/jobs/view/4456258995/?trackingId=REDACTED',
      ].join('\n'),
    };
    const [hourlySubjectJob] = extractJobs(hourlyMessage);
    expect(hourlySubjectJob.minSalary).toBeNull();
    expect(hourlySubjectJob.maxSalary).toBeNull();
    expect(hourlySubjectJob.rate).toEqual({ min: null, max: 45, unit: 'hour' });

    // A day-rate subject must be refused the same way.
    const dayRateMessage = {
      id: 'subject-day-rate-test',
      date: '2026-09-14T00:00:00Z',
      sender: 'jobalerts-noreply@linkedin.com',
      subject: 'Interim Programme Director at Acme Corp: up to £500/day',
      plaintextBody: [
        'Your job alert for programme director in England',
        '',
        'Interim Programme Director',
        'Acme Corp',
        'Leeds',
        '',
        'This company is actively hiring',
        'View job: https://www.linkedin.com/comm/jobs/view/4456258994/?trackingId=REDACTED',
      ].join('\n'),
    };
    const [dayRateSubjectJob] = extractJobs(dayRateMessage);
    expect(dayRateSubjectJob.minSalary).toBeNull();
    expect(dayRateSubjectJob.maxSalary).toBeNull();
    expect(dayRateSubjectJob.rate).toEqual({ min: null, max: 500, unit: 'day' });

    // Annual subjects are unaffected and keep their current parsed values.
    const annualCeilingMessage = { ...hourlyMessage, subject: 'Role at Acme Corp: up to £74K/year' };
    const [annualCeilingJob] = extractJobs(annualCeilingMessage);
    expect(annualCeilingJob.minSalary).toBeNull();
    expect(annualCeilingJob.maxSalary).toBe(74000);
    expect(annualCeilingJob.rate).toEqual({ min: null, max: 74000, unit: 'year' });

    const annualRangeMessage = { ...hourlyMessage, subject: 'Role at Acme Corp: £55K-£70K / year' };
    const [annualRangeJob] = extractJobs(annualRangeMessage);
    expect(annualRangeJob.minSalary).toBe(55000);
    expect(annualRangeJob.maxSalary).toBe(70000);
    expect(annualRangeJob.rate).toEqual({ min: 55000, max: 70000, unit: 'year' });
  });

  it("an hourly rate reaches its derived column without touching the human's", () => {
    // DR-0004: a parser that learns to derive a human-owned value gets a
    // `(derived)` sibling column rather than taking the human's. `job.rate`
    // (01-06) is routing-only here — no re-parsing, no annual equivalent.
    const hourlyMessage = {
      id: 'derived-rate-hourly-test',
      date: '2026-09-14T00:00:00Z',
      sender: 'jobalerts-noreply@linkedin.com',
      subject: 'Financial Accountant at Venture Recruitment Partners: up to £45/hour',
      plaintextBody: [
        'Your job alert for financial accountant in England',
        '',
        'Financial Accountant',
        'Venture Recruitment Partners',
        'Reading',
        '',
        'This company is actively hiring',
        'View job: https://www.linkedin.com/comm/jobs/view/4456258995/?trackingId=REDACTED',
      ].join('\n'),
    };
    const [hourlyRow] = harvest([hourlyMessage]).jobs.rows;
    expect(hourlyRow['Max Rate (derived)']).toBe(45);
    expect(hourlyRow['Min Rate (derived)']).toBeNull();
    expect(hourlyRow['Rate Unit (derived)']).toBe('hour');
    expect(hourlyRow['Min Salary (annual)']).toBeNull();
    expect(hourlyRow['Max Salary (annual)']).toBeNull();
    // Human-owned columns are still created blank and never written.
    expect(hourlyRow['Min Salary (hourly)']).toBeNull();
    expect(hourlyRow['Day Rate']).toBeNull();

    // A day-denominated rate populates the same three columns, unit 'day'.
    const dayRateMessage = {
      id: 'derived-rate-day-test',
      date: '2026-09-14T00:00:00Z',
      sender: 'jobalerts-noreply@linkedin.com',
      subject: 'Interim Programme Director at Acme Corp: up to £500/day',
      plaintextBody: [
        'Your job alert for programme director in England',
        '',
        'Interim Programme Director',
        'Acme Corp',
        'Leeds',
        '',
        'This company is actively hiring',
        'View job: https://www.linkedin.com/comm/jobs/view/4456258994/?trackingId=REDACTED',
      ].join('\n'),
    };
    const [dayRow] = harvest([dayRateMessage]).jobs.rows;
    expect(dayRow['Max Rate (derived)']).toBe(500);
    expect(dayRow['Min Rate (derived)']).toBeNull();
    expect(dayRow['Rate Unit (derived)']).toBe('day');
    expect(dayRow['Min Salary (annual)']).toBeNull();
    expect(dayRow['Max Salary (annual)']).toBeNull();
    expect(dayRow['Min Salary (hourly)']).toBeNull();
    expect(dayRow['Day Rate']).toBeNull();
  });

  it('an annual salary never appears in the derived rate columns', () => {
    // 01-08: toJobsRow routed job.rate into the derived columns unconditionally,
    // so a `year`-unit rate restated the annual figures in Min/Max Rate (derived)
    // and Rate Unit (derived) — the same job described two ways in one row.
    const annualMessage = {
      id: 'annual-not-derived-test',
      date: '2026-09-14T00:00:00Z',
      sender: 'jobalerts-noreply@linkedin.com',
      subject: 'Programme Delivery Manager at Acme Corp: £65K-£74K / year',
      plaintextBody: [
        'Your job alert for programme delivery manager in England',
        '',
        'Programme Delivery Manager',
        'Acme Corp',
        'Manchester',
        '',
        'This company is actively hiring',
        'View job: https://www.linkedin.com/comm/jobs/view/4456258993/?trackingId=REDACTED',
      ].join('\n'),
    };
    const [annualRow] = harvest([annualMessage]).jobs.rows;
    expect(annualRow['Min Salary (annual)']).toBe(65000);
    expect(annualRow['Max Salary (annual)']).toBe(74000);
    expect(annualRow['Min Rate (derived)']).toBeNull();
    expect(annualRow['Max Rate (derived)']).toBeNull();
    expect(annualRow['Rate Unit (derived)']).toBeNull();

    // The hour/day cases from 01-07 must still populate all three derived
    // columns — this step gates on unit, not on whether a rate exists.
    const hourlyMessage = {
      id: 'annual-not-derived-hourly-test',
      date: '2026-09-14T00:00:00Z',
      sender: 'jobalerts-noreply@linkedin.com',
      subject: 'Interim QA Lead at Acme Corp: up to £50/hour',
      plaintextBody: [
        'Your job alert for interim qa lead in England',
        '',
        'Interim QA Lead',
        'Acme Corp',
        'Leeds',
        '',
        'This company is actively hiring',
        'View job: https://www.linkedin.com/comm/jobs/view/4456258992/?trackingId=REDACTED',
      ].join('\n'),
    };
    const [hourlyRow] = harvest([hourlyMessage]).jobs.rows;
    expect(hourlyRow['Min Salary (annual)']).toBeNull();
    expect(hourlyRow['Max Salary (annual)']).toBeNull();
    expect(hourlyRow['Max Rate (derived)']).toBe(50);
    expect(hourlyRow['Min Rate (derived)']).toBeNull();
    expect(hourlyRow['Rate Unit (derived)']).toBe('hour');

    // No row ever carries a value in both the annual pair and the derived
    // rate columns.
    for (const row of [annualRow, hourlyRow]) {
      const hasAnnual = row['Min Salary (annual)'] !== null || row['Max Salary (annual)'] !== null;
      const hasDerived =
        row['Min Rate (derived)'] !== null ||
        row['Max Rate (derived)'] !== null ||
        row['Rate Unit (derived)'] !== null;
      expect(hasAnnual && hasDerived).toBe(false);
    }
  });
});
