// PURE. Whether a failed Gmail or token call is worth another attempt (DR-0011, OQ-3).
export const MAX_ATTEMPTS = 3;

export const RATE_LIMIT_REASONS = Object.freeze(['rateLimitExceeded', 'userRateLimitExceeded']);

export const RetryRefusal = Object.freeze({
  QUOTA_EXHAUSTED: 'gmail.quota-exhausted',
  SERVER_ERROR: 'gmail.server-error',
  UNAUTHORIZED: 'gmail.unauthorized',
  QUERY_REJECTED: 'gmail.query-rejected',
});

const BASE_DELAY_MS = 500;

const isRateLimited = ({ status, reason }) =>
  status === 429 || (status === 403 && RATE_LIMIT_REASONS.includes(reason));

const isServerError = ({ status }) => status >= 500 && status <= 599;

const GMAIL_NAMESPACE = 'gmail';

const refusalNamed = (namespace, reason) => `${namespace}.${reason}`;

// Gmail keeps its historical name for a rejected request.
const rejectedReason = (namespace) => (namespace === GMAIL_NAMESPACE ? 'query-rejected' : 'request-rejected');

const permanentRefusal = ({ status }, namespace) =>
  status === 401 || status === 403 ? refusalNamed(namespace, 'unauthorized') : refusalNamed(namespace, rejectedReason(namespace));

const exhaustedRefusal = (call, namespace) =>
  refusalNamed(namespace, isRateLimited(call) ? 'quota-exhausted' : 'server-error');

const backoffMs = ({ attempt, jitter }) => Math.floor(BASE_DELAY_MS * 2 ** (attempt - 1) * (1 + jitter));

const retryAfterMs = ({ retryAfterSeconds }) => (retryAfterSeconds == null ? 0 : retryAfterSeconds * 1000);

const delayBeforeRetry = (call) => Math.max(backoffMs(call), retryAfterMs(call));

/** @param {{ get: Function, has: Function }} headers @returns {number|null} the Retry-After delay in seconds */
export const retryAfterSecondsOf = (headers) => {
  const seconds = Number(headers.get('retry-after'));
  return headers.has('retry-after') && Number.isFinite(seconds) ? seconds : null;
};

/**
 * @param {{ attempt: number, status: number, reason?: string|null, retryAfterSeconds?: number|null, jitter: number, namespace?: string }} call
 *   attempt is the number of attempts already made (1-based); jitter is in [0, 1)
 * @returns {{ retry: true, delayMs: number } | { retry: false, refusal: string }}
 */
export function decideRetry(call) {
  const { namespace = GMAIL_NAMESPACE } = call;
  if (!isRateLimited(call) && !isServerError(call)) {
    return { retry: false, refusal: permanentRefusal(call, namespace) };
  }
  return call.attempt < MAX_ATTEMPTS
    ? { retry: true, delayMs: delayBeforeRetry(call) }
    : { retry: false, refusal: exhaustedRefusal(call, namespace) };
}
