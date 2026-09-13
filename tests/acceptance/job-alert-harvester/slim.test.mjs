// @contract-shape:pure-function
// DR-0003, DESIGN Q5 — slim is the place connector schema drift is detected.
// A digest that is suspiciously short, or carries no advert link at all, is
// quarantined rather than cached with fewer jobs than it advertised. Payload
// shape is DR-0007: flat JSON, no `{ result: ... }` wrapper. Unit layer,
// table-driven boundary cases.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { slim, QuarantineReason, MINIMUM_DIGEST_BODY_LENGTH } from '../../../src/core/slim.mjs';
import { aMessage, aSpillPayload, aDigestBody, SPILL_FIXTURES_DIR } from './support/domain-types.mjs';

describe('slim (DR-0003, Q5) — quarantine truncated-but-parsable payloads', () => {
  it('slims a well-formed digest payload with no quarantine', () => {
    const payload = aSpillPayload({ id: '1', jobs: [{ id: '4441092711', title: 'Agile Coach', company: 'Stealth iT' }] });
    const { record, quarantine } = slim(payload);
    expect(quarantine).toBeNull();
    expect(record).not.toBeNull();
  });

  it('the slimmed record shape matches the cache/fixture record shape exactly', () => {
    const payload = aSpillPayload({ id: '1' });
    const { record } = slim(payload);
    expect(Object.keys(record).sort()).toEqual(['date', 'id', 'plaintextBody', 'sender', 'snippet', 'subject'].sort());
  });

  it('slim drops the harness\'s extra keys — a real-shape payload slims to exactly the six cache keys', () => {
    // Given the real spill fixture (DR-0007) — flat JSON carrying the connector's
    // full key set, including htmlBody/historyId/labelIds/etc. that slim() never keeps
    const [fixtureName] = readdirSync(SPILL_FIXTURES_DIR);
    const payload = JSON.parse(readFileSync(join(SPILL_FIXTURES_DIR, fixtureName), 'utf8'));

    const { record, quarantine } = slim(payload);

    expect(quarantine).toBeNull();
    expect(Object.keys(record).sort()).toEqual(['date', 'id', 'plaintextBody', 'sender', 'snippet', 'subject'].sort());
  });

  it('@error quarantines a digest body shorter than the minimum length, as truncated', () => {
    const shortBody = aDigestBody({ jobs: [{ id: '1', title: 'Agile Coach', company: 'Stealth iT' }] }).slice(0, 200);
    const payload = aMessage({ id: '1', plaintextBody: shortBody });

    const { record, quarantine } = slim(payload);

    expect(record).toBeNull();
    expect(quarantine).toMatchObject({ id: '1', reason: QuarantineReason.BODY_TOO_SHORT });
  });

  it('@error quarantines a digest body with no /jobs/view/ advert link, even when long enough', () => {
    const bodyWithNoLink = ('Your job alert for agile coach\n\n' + 'lorem ipsum dolor sit amet '.repeat(60)).padEnd(
      MINIMUM_DIGEST_BODY_LENGTH + 100,
      ' ',
    );
    const payload = aMessage({ id: '2', plaintextBody: bodyWithNoLink });

    const { record, quarantine } = slim(payload);

    expect(record).toBeNull();
    expect(quarantine).toMatchObject({ id: '2', reason: QuarantineReason.NO_ADVERT_LINK });
  });

  it.each([
    { name: 'one character below the minimum length is quarantined', length: MINIMUM_DIGEST_BODY_LENGTH - 1, quarantined: true },
    { name: 'exactly the minimum length, with a link, is not quarantined', length: MINIMUM_DIGEST_BODY_LENGTH, quarantined: false },
  ])('$name', ({ length, quarantined }) => {
    const link = 'View job: https://www.linkedin.com/jobs/view/4441092711/?trackingId=REDACTED\n';
    const padding = 'x'.repeat(Math.max(0, length - link.length));
    const body = (padding + link).slice(0, Math.max(length, link.length));
    const payload = aMessage({ id: '3', plaintextBody: body });

    const { record, quarantine } = slim(payload);

    expect(quarantine === null).toBe(!quarantined);
    expect(record === null).toBe(quarantined);
  });

  it('a quarantined record carries the message id, for correlation with a human review queue', () => {
    const payload = aMessage({ id: 'needs-review', plaintextBody: 'too short' });
    const { quarantine } = slim(payload);
    expect(quarantine.id).toBe('needs-review');
  });
});
