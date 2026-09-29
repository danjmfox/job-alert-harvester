import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractJobs } from '../../../src/core/parse-linkedin.mjs';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/linkedin-variants');

const cleanMessage = JSON.parse(readFileSync(path.join(fixturesDir, '1a09a2b19d112bb8.json'), 'utf8'));

const SALARY_JOB_ID = '4456258182';

const NOISY_LINES = new Map([
  ['Senior Scrum Master', '  Senior  Scrum\t Master \t'],
  ['Leonardo', '\t  Leonardo  \t'],
  ['Gloucester', '  Gloucester\t '],
  ['£59K-£78K / year', '    £59K  -  £78K  /  year  '],
]);

// Alters only the salary card: its lines are consecutive, so an index scan from its title is unambiguous.
function noisyBody(plaintextBody) {
  const lines = plaintextBody.split('\n');
  const cardStart = lines.indexOf('Senior Scrum Master');
  const altered = lines.map((line, index) =>
    index >= cardStart && index < cardStart + 4 ? (NOISY_LINES.get(line) ?? line) : line,
  );
  return altered.join('\r\n');
}

const noisyMessage = { ...cleanMessage, plaintextBody: noisyBody(cleanMessage.plaintextBody) };

function jobById(jobs, jobId) {
  return jobs.find((job) => job.dedupKey === `linkedin:${jobId}`);
}

describe('LinkedIn inner-whitespace regression', () => {
  it('inner whitespace runs, tabs, indentation and CRLF in card lines parse identically to the clean message', () => {
    const cleanJobs = extractJobs(cleanMessage);
    const noisyJobs = extractJobs(noisyMessage);

    const noisyJob = jobById(noisyJobs, SALARY_JOB_ID);
    expect(noisyJob.title).toBe('Senior Scrum Master');
    expect(noisyJob.company).toBe('Leonardo');
    expect(noisyJob.location).toBe('Gloucester');

    expect(noisyJobs.map((job) => job.dedupKey)).toEqual(cleanJobs.map((job) => job.dedupKey));
    expect(noisyJobs.map((job) => job.advertLink)).toEqual(cleanJobs.map((job) => job.advertLink));

    expect(noisyJobs).toEqual(cleanJobs);
  });

  it('a card salary line containing inner double spaces still yields min and max', () => {
    const noisyJob = jobById(extractJobs(noisyMessage), SALARY_JOB_ID);
    expect(noisyJob.minSalary).toBe(59000);
    expect(noisyJob.maxSalary).toBe(78000);
  });
});
