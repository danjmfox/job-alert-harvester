// @contract-shape:pure-function
// SD-15 / Q9: decideRetry gains a refusal namespace (sheets, drive) with the Gmail default unchanged, and tells a
// 403 rate reason (retry, as a 429) from a 403 authorisation reason (never retry). Pure layer: properties over
// the whole input domain. The six Gmail properties themselves are pinned in the gmail-api-source suite.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { decideRetry } from '../../../src/core/retry-policy.mjs';
import { MAX_ATTEMPTS, RATE_LIMIT_REASONS } from './support/sheets-domain-types.mjs';
import { holds } from './support/property.mjs';
import { scenario } from './support/red-gate.mjs';

const anyJitter = fc.double({ min: 0, max: 0.999, noNaN: true });
const namespace = fc.constantFrom('sheets', 'drive');
const retriableStatus = fc.constantFrom(429, 500, 502, 503, 504);
const spent = fc.integer({ min: MAX_ATTEMPTS, max: MAX_ATTEMPTS + 5 });
const remaining = fc.integer({ min: 1, max: MAX_ATTEMPTS - 1 });
const AUTHORISATION_REASONS = ['forbidden', 'insufficientPermissions', 'insufficientFilePermissions', 'appNotAuthorizedToFile', 'notFound'];

describe('the refusal namespace of a spent or permanent failure', () => {
  scenario('@property the Gmail namespace is the default and names Gmail refusals exactly as before', () => {
    holds(
      fc.property(retriableStatus, spent, anyJitter, (status, attempt, jitter) => {
        const expected = { retry: false, refusal: status === 429 ? 'gmail.quota-exhausted' : 'gmail.server-error' };
        expect(decideRetry({ attempt, status, jitter })).toEqual(expected);
        expect(decideRetry({ attempt, status, jitter, namespace: 'gmail' })).toEqual(expected);
      }),
    );
  });

  scenario('@error @property a spent throttled or failing call is refused under the caller namespace', () => {
    holds(
      fc.property(namespace, retriableStatus, spent, anyJitter, (ns, status, attempt, jitter) => {
        expect(decideRetry({ attempt, status, jitter, namespace: ns })).toEqual({ retry: false, refusal: status === 429 ? `${ns}.quota-exhausted` : `${ns}.server-error` });
      }),
    );
  });

  scenario('@property a throttled call is retried while attempts remain, whatever the namespace', () => {
    holds(
      fc.property(namespace, retriableStatus, remaining, anyJitter, (ns, status, attempt, jitter) => {
        const decision = decideRetry({ attempt, status, jitter, namespace: ns });
        expect(decision.retry).toBe(true);
        expect(Number.isInteger(decision.delayMs)).toBe(true);
      }),
    );
  });

  scenario('@error @property a call that retrying cannot mend is named unauthorized or request-rejected in the caller namespace, never retried', () => {
    holds(
      fc.property(namespace, fc.constantFrom(400, 404, 409, 413), fc.constantFrom(401, 403), fc.integer({ min: 1, max: MAX_ATTEMPTS + 2 }), anyJitter, (ns, rejected, denied, attempt, jitter) => {
        expect(decideRetry({ attempt, status: rejected, jitter, namespace: ns })).toEqual({ retry: false, refusal: `${ns}.request-rejected` });
        expect(decideRetry({ attempt, status: denied, reason: 'forbidden', jitter, namespace: ns })).toEqual({ retry: false, refusal: `${ns}.unauthorized` });
      }),
    );
  });

  scenario('@error the Gmail namespace keeps its own name for a rejected query', () => {
    expect(decideRetry({ attempt: 1, status: 400, jitter: 0.5 })).toEqual({ retry: false, refusal: 'gmail.query-rejected' });
  });
});

describe('a 403 is a rate limit or an authorisation failure, and the reason says which', () => {
  scenario('@property a 403 with a rate reason is retried exactly as a 429, in any namespace', () => {
    holds(
      fc.property(namespace, fc.constantFrom(...RATE_LIMIT_REASONS), fc.integer({ min: 1, max: MAX_ATTEMPTS + 2 }), fc.option(fc.integer({ min: 0, max: 120 }), { nil: null }), anyJitter, (ns, reason, attempt, retryAfterSeconds, jitter) => {
        const decision = decideRetry({ attempt, status: 403, reason, retryAfterSeconds, jitter, namespace: ns });
        expect(decision).toEqual(decideRetry({ attempt, status: 429, retryAfterSeconds, jitter, namespace: ns }));
        if (!decision.retry) expect(decision.refusal).toBe(`${ns}.quota-exhausted`);
      }),
    );
  });

  scenario('@error @property a 403 with any authorisation reason is never retried and is named unauthorized, in any namespace', () => {
    holds(
      fc.property(namespace, fc.constantFrom(...AUTHORISATION_REASONS), fc.integer({ min: 1, max: MAX_ATTEMPTS + 2 }), anyJitter, (ns, reason, attempt, jitter) => {
        expect(decideRetry({ attempt, status: 403, reason, jitter, namespace: ns })).toEqual({ retry: false, refusal: `${ns}.unauthorized` });
      }),
    );
  });

  scenario('@error a 403 with no reason at all is an authorisation failure, not a rate limit', () => {
    expect(decideRetry({ attempt: 1, status: 403, jitter: 0.1, namespace: 'sheets' })).toEqual({ retry: false, refusal: 'sheets.unauthorized' });
  });
});
