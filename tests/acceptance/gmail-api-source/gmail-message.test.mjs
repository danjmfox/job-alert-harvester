// @contract-shape:pure-function
// The anti-corruption layer (DR-0007 parity): Gmail's resource shape goes in, the
// cache record shape slim() already consumes comes out. Test resources are built
// around real captured alert bodies, never composed from memory.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { toMessage, toListing, senderAddress, MessageRefusal } from '../../../src/core/gmail-message.mjs';
import { gmailWindowQuery } from '../../../src/core/gmail-query.mjs';
import { slim } from '../../../src/core/slim.mjs';
import { linkedin } from '../../../src/core/sources/linkedin.mjs';
import { aGmailResource, realAlertRecords, aMessage, refusalOf } from './support/gmail-domain-types.mjs';
import { holds } from './support/property.mjs';

const REAL = realAlertRecords();
const anAddress = fc.tuple(fc.stringMatching(/^[a-z0-9][a-z0-9._-]{0,15}$/), fc.domain()).map(([local, domain]) => `${local}@${domain}`);
const aDisplayName = fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,20}$/);

describe('a Gmail message becomes a cache record', () => {
  for (const record of REAL) {
    it(`parity: real alert ${record.id} survives Gmail's shape and back unchanged, and parses to the same jobs`, () => {
      const message = toMessage(aGmailResource({ record }));

      expect(message).toEqual(record);
      expect(slim(message).quarantine).toBeNull();
      expect(linkedin.matches(message)).toBe(true);
      expect(linkedin.extract(message)).toEqual(linkedin.extract(record));
    });
  }

  it('@property finds the plain-text body wherever the parts tree puts it, ignoring html and attachments', () => {
    holds(
      fc.property(fc.string({ minLength: 1, unit: 'grapheme' }), fc.integer({ min: 0, max: 3 }), fc.boolean(), (body, nesting, htmlFirst) => {
        const record = aMessage({ id: 'p1', plaintextBody: body });
        expect(toMessage(aGmailResource({ record, nesting, htmlFirst })).plaintextBody).toBe(body);
      }),
    );
  });

  it('@error refuses a message with only an html part, naming its id', () => {
    const resource = aGmailResource({ record: aMessage({ id: 'html-only' }), plaintext: false });

    expect(refusalOf(() => toMessage(resource))).toBe(MessageRefusal.MISSING_PLAINTEXT_BODY);
    expect(() => toMessage(resource)).toThrowError(/html-only/);
  });

  it('@error refuses a message whose plain-text part is empty, naming its id', () => {
    const resource = aGmailResource({ record: aMessage({ id: 'empty-body', plaintextBody: '' }) });

    expect(refusalOf(() => toMessage(resource))).toBe(MessageRefusal.MISSING_PLAINTEXT_BODY);
    expect(() => toMessage(resource)).toThrowError(/empty-body/);
  });
});

describe('the sender is the bare address linkedin.matches compares against', () => {
  it('reduces a display-name From header to the bare lowercase address', () => {
    expect(senderAddress('LinkedIn Job Alerts <JobAlerts-NoReply@LinkedIn.com>')).toBe('jobalerts-noreply@linkedin.com');
  });

  it('@property every common From form reduces to the same bare lowercase address', () => {
    holds(
      fc.property(anAddress, aDisplayName, (address, name) => {
        for (const header of [address, `${name} <${address}>`, `"${name}" <${address}>`, `<${address}>`, address.toUpperCase()]) {
          expect(senderAddress(header)).toBe(address.toLowerCase());
        }
      }),
    );
  });

  it('the source descriptor exposes the sender the fetch query is bounded by, and matches it exactly', () => {
    expect(linkedin.sender).toBe('jobalerts-noreply@linkedin.com');
    expect(linkedin.matches({ sender: linkedin.sender })).toBe(true);
    expect(linkedin.matches({ sender: `x${linkedin.sender}` })).toBe(false);
  });

  it('a message from LinkedIn is routed to the LinkedIn source, not to Unmatched', () => {
    const resource = aGmailResource({ record: aMessage({ id: 'routed' }), fromHeader: 'LinkedIn Job Alerts <JobAlerts-NoReply@LinkedIn.com>' });
    expect(linkedin.matches(toMessage(resource))).toBe(true);
  });
});

describe('the listing date is the instant the query bounds use', () => {
  const internalDate = fc.integer({ min: 1_577_836_800_000, max: 1_893_456_000_000 });

  it('@property a listed date is second-precision UTC and names the same second Gmail stored', () => {
    holds(
      fc.property(internalDate, (ms) => {
        const { id, date } = toListing({ id: 'm', internalDate: String(ms) });
        expect(id).toBe('m');
        expect(date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
        expect(Date.parse(date) / 1000).toBe(Math.floor(ms / 1000));
      }),
    );
  });

  it('@property a message lands inside the query window of its own UTC day', () => {
    holds(
      fc.property(internalDate, (ms) => {
        const day = toListing({ id: 'm', internalDate: String(ms) }).date.slice(0, 10);
        const [, after, before] = gmailWindowQuery({ from: day, to: day }, { sender: 'a@b.co' }).match(/after:(\d+) before:(\d+)/);
        expect(Number(after)).toBeLessThanOrEqual(Math.floor(ms / 1000));
        expect(Math.floor(ms / 1000)).toBeLessThan(Number(before));
      }),
    );
  });
});
