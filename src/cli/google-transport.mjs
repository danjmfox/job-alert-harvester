// The one module that attaches a bearer for the Sheets and Drive adapters. It hands them a read capability, which
// retries by decideRetry and cannot send a write, and a write capability, which sends once and never replays.
import { RequestClass, classifyRequest } from '../core/sheets-requests.mjs';
import { SheetsRefusal } from '../core/sheets-refusals.mjs';
import { decideRetry, retryAfterSecondsOf } from '../core/retry-policy.mjs';

const LOST_CONNECTION = 0;
const UNAUTHORIZED = 401;
const SERVER_ERROR_STATUS = 503;
const EXHAUSTED_REASONS = ['quota-exhausted', 'server-error'];

// Messages carry the refusal code only: no credential value may reach an error.
const refuse = (code) => {
  throw Object.assign(new Error(code), { code });
};

const parsedBodyOf = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const reasonOf = (body) => body?.error?.errors?.[0]?.reason ?? body?.error?.details?.find((detail) => detail.reason)?.reason ?? null;

/** @param {{ url: string, method?: string, headers?: object }} request */
const asFetchInit = ({ method = 'GET', headers = {}, body }, accessToken) => ({
  method,
  headers: { ...headers, authorization: `Bearer ${accessToken}` },
  redirect: 'error',
  ...(body === undefined ? {} : { body }),
});

const lostConnection = () => ({ status: LOST_CONNECTION, headers: new Headers(), body: null });

const refreshingSender = ({ tokenSource, fetch, namespace }) => {
  const sendOnce = async (url, options, accessToken) => {
    try {
      const response = await fetch(url, asFetchInit(options, accessToken));
      return { status: response.status, headers: response.headers, body: await parsedBodyOf(response) };
    } catch {
      return lostConnection();
    }
  };

  return async (url, options) => {
    const accessToken = await tokenSource.accessToken();
    const first = await sendOnce(url, options, accessToken);
    if (first.status !== UNAUTHORIZED) return first;
    const second = await sendOnce(url, options, await tokenSource.accessToken({ staleToken: accessToken }));
    return second.status === UNAUTHORIZED ? refuse(`${namespace}.unauthorized`) : second;
  };
};

/**
 * The read capability alone: no write closure is ever built, so a caller that asks only for this cannot write.
 * @param {{ tokenSource: { accessToken: Function }, fetch: Function, sleep: Function, jitter: () => number, namespace: 'sheets'|'drive' }} options
 * @returns {{ request: Function }}
 */
export function createGoogleReadTransport(options) {
  const { sleep, jitter, namespace } = options;
  const sendRefreshingOnce = refreshingSender(options);

  const decisionAfter = (response, attempt) =>
    decideRetry({
      attempt,
      status: response.status === LOST_CONNECTION ? SERVER_ERROR_STATUS : response.status,
      reason: reasonOf(response.body),
      retryAfterSeconds: retryAfterSecondsOf(response.headers),
      jitter: jitter(),
      namespace,
    });

  const isExhaustion = ({ refusal }) => EXHAUSTED_REASONS.some((reason) => refusal === `${namespace}.${reason}`);

  const readWithRetries = async (url, options) => {
    for (let attempt = 1; ; attempt += 1) {
      const response = await sendRefreshingOnce(url, options);
      const decision = response.status === 200 ? { retry: false } : decisionAfter(response, attempt);
      if (decision.retry) {
        await sleep(decision.delayMs);
      } else if (isExhaustion(decision)) {
        refuse(decision.refusal);
      } else {
        return response;
      }
    }
  };

  const read = (url, options = {}) =>
    classifyRequest({ method: options.method ?? 'GET', url }) === RequestClass.READ ? readWithRetries(url, options) : refuse(SheetsRefusal.WRITE_NOT_PERMITTED);

  return { request: read };
}

/**
 * @param {{ tokenSource: { accessToken: Function }, fetch: Function, sleep: Function, jitter: () => number, namespace: 'sheets'|'drive' }} options
 * @returns {{ read: { request: Function }, write: { request: Function } }}
 *   request(url, { method?, headers?, body? }) resolves { status, headers, body } (body parsed JSON or null).
 */
export function createGoogleTransport(options) {
  return { read: createGoogleReadTransport(options), write: { request: refreshingSender(options) } };
}
