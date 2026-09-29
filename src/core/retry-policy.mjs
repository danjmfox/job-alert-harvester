// PURE. Whether a failed Gmail or token call is worth another attempt (DR-0011, OQ-3).
export const __SCAFFOLD__ = true;

export const MAX_ATTEMPTS = 3;

export const RATE_LIMIT_REASONS = Object.freeze(['rateLimitExceeded', 'userRateLimitExceeded']);

export const RetryRefusal = Object.freeze({
  QUOTA_EXHAUSTED: 'gmail.quota-exhausted',
  SERVER_ERROR: 'gmail.server-error',
  UNAUTHORIZED: 'gmail.unauthorized',
  QUERY_REJECTED: 'gmail.query-rejected',
});

/**
 * @param {{ attempt: number, status: number, reason?: string|null, retryAfterSeconds?: number|null, jitter: number }} call
 *   attempt is the number of attempts already made (1-based); jitter is in [0, 1)
 * @returns {{ retry: true, delayMs: number } | { retry: false, refusal: string }}
 */
export function decideRetry(_call) {
  throw new Error('RED scaffold: decideRetry is not implemented');
}
