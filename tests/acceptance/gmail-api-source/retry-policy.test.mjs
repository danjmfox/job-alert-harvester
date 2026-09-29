// @contract-shape:pure-function
// OQ-3 (bounded retry): three attempts, exponential backoff with jitter, Retry-After
// honoured, 403 rate reasons treated as 429. The decision is pure; the adapter only
// sleeps. In-memory layer: property tests over the whole input domain.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { decideRetry, MAX_ATTEMPTS, RATE_LIMIT_REASONS, RetryRefusal } from '../../../src/core/retry-policy.mjs';
import { holds } from './support/property.mjs';

const anyJitter = fc.double({ min: 0, max: 0.999, noNaN: true });
const retriableStatus = fc.constantFrom(429, 500, 502, 503, 504);
const attemptsRemaining = fc.integer({ min: 1, max: MAX_ATTEMPTS - 1 });
const attemptsSpent = fc.integer({ min: MAX_ATTEMPTS, max: MAX_ATTEMPTS + 5 });
const retryAfterSeconds = fc.option(fc.integer({ min: 0, max: 120 }), { nil: null });

describe('the decision to retry a failed Gmail or token call (OQ-3)', () => {
  it('@property retries a throttled or failing call only while attempts remain', () => {
    holds(
      fc.property(retriableStatus, attemptsRemaining, anyJitter, (status, attempt, jitter) => {
        const decision = decideRetry({ attempt, status, jitter });
        expect(decision.retry).toBe(true);
        expect(Number.isInteger(decision.delayMs) && decision.delayMs >= 0).toBe(true);
      }),
    );
  });

  it('@error @property refuses by name once the attempts are spent', () => {
    holds(
      fc.property(retriableStatus, attemptsSpent, anyJitter, (status, attempt, jitter) => {
        const decision = decideRetry({ attempt, status, jitter });
        expect(decision).toEqual({
          retry: false,
          refusal: status === 429 ? RetryRefusal.QUOTA_EXHAUSTED : RetryRefusal.SERVER_ERROR,
        });
      }),
    );
  });

  it('@property waits at least as long as Retry-After asks', () => {
    holds(
      fc.property(retriableStatus, attemptsRemaining, fc.integer({ min: 0, max: 120 }), anyJitter, (status, attempt, seconds, jitter) => {
        const decision = decideRetry({ attempt, status, retryAfterSeconds: seconds, jitter });
        expect(decision.delayMs).toBeGreaterThanOrEqual(seconds * 1000);
      }),
    );
  });

  it('@property backs off: a later attempt never waits less than an earlier one', () => {
    holds(
      fc.property(retriableStatus, anyJitter, (status, jitter) => {
        const first = decideRetry({ attempt: 1, status, jitter });
        const second = decideRetry({ attempt: 2, status, jitter });
        expect(second.delayMs).toBeGreaterThanOrEqual(first.delayMs);
      }),
    );
  });

  it('@property treats a 403 rate-limit reason exactly as a 429', () => {
    holds(
      fc.property(fc.constantFrom(...RATE_LIMIT_REASONS), fc.integer({ min: 1, max: MAX_ATTEMPTS + 2 }), retryAfterSeconds, anyJitter, (reason, attempt, retryAfter, jitter) => {
        expect(decideRetry({ attempt, status: 403, reason, retryAfterSeconds: retryAfter, jitter })).toEqual(
          decideRetry({ attempt, status: 429, retryAfterSeconds: retryAfter, jitter }),
        );
      }),
    );
  });

  const NEVER_RETRIED = [
    { status: 400, reason: 'invalidArgument', refusal: RetryRefusal.QUERY_REJECTED },
    { status: 401, reason: null, refusal: RetryRefusal.UNAUTHORIZED },
    { status: 403, reason: 'forbidden', refusal: RetryRefusal.UNAUTHORIZED },
    { status: 403, reason: 'insufficientPermissions', refusal: RetryRefusal.UNAUTHORIZED },
  ];

  it('@error @property never retries a call that retrying cannot mend, and names why', () => {
    holds(
      fc.property(fc.constantFrom(...NEVER_RETRIED), fc.integer({ min: 1, max: MAX_ATTEMPTS + 2 }), anyJitter, ({ status, reason, refusal }, attempt, jitter) => {
        expect(decideRetry({ attempt, status, reason, jitter })).toEqual({ retry: false, refusal });
      }),
    );
  });
});
