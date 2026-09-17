// @contract-shape:pure-function
// The support builders are fixtures for every other acceptance/unit test in
// the suite — if `aDigestBody` invents a card layout LinkedIn never sends,
// every test built on it silently proves nothing about the real parser. This
// file pins the one property a digest builder must hold: what goes in as a
// job's title/company/location comes back out the same way, in order, once
// run through the production parser (`extractJobs`), and the body still
// clears the quarantine floor.
import { describe, it, expect } from 'vitest';
import { extractJobs } from '../../../src/core/parse-linkedin.mjs';
import { aDigestBody, aMessage, MINIMUM_DIGEST_BODY_LENGTH } from './support/domain-types.mjs';

describe('aDigestBody builds a card layout extractJobs reads back exactly', () => {
  it('round-trips a single job\'s title, company and location', () => {
    const job = { id: '4441092711', title: 'Agile Coach', company: 'Stealth iT Consulting', location: 'United Kingdom' };

    const [extracted] = extractJobs(aMessage({ jobs: [job] }));

    expect({ title: extracted.title, company: extracted.company, location: extracted.location }).toEqual({
      title: job.title,
      company: job.company,
      location: job.location,
    });
  });

  it('round-trips several jobs, in order, each with its own triple', () => {
    const jobs = [
      { id: '1001', title: 'Agile Coach', company: 'Stealth iT Consulting', location: 'United Kingdom' },
      { id: '1002', title: 'Scrum Master', company: 'Digital Waffle', location: 'Manchester' },
      { id: '1003', title: 'Product Owner', company: 'Wire', location: 'Ledbury' },
    ];

    const extracted = extractJobs(aMessage({ jobs }));

    expect(extracted.map(({ title, company, location }) => ({ title, company, location }))).toEqual(
      jobs.map(({ title, company, location }) => ({ title, company, location })),
    );
  });

  it('clears MINIMUM_DIGEST_BODY_LENGTH for the smallest case — a single short job', () => {
    const body = aDigestBody({ jobs: [{ id: '1', title: 'A', company: 'B', location: 'C' }] });

    expect(body.length).toBeGreaterThanOrEqual(MINIMUM_DIGEST_BODY_LENGTH);
  });
});
