// Driven adapter: the Google token endpoint. Refreshes the access token once per
// process and persists a rotated refresh token only through the injected store.
// The access token lives in memory only; the code exchange is never retried.
import {
  AuthRefusal,
  TokenRefusal,
  authorizationCodeForm,
  buildTokenFile,
  encodeForm,
  isExpired,
  parseTokenResponse,
  refreshTokenForm,
} from '../core/oauth.mjs';
import { decideRetry, retryAfterSecondsOf } from '../core/retry-policy.mjs';

export { AuthRefusal, TokenRefusal };

const EXPIRY_SKEW_MS = 60_000;

// Messages carry the refusal code only: no credential value may reach an error.
const refuse = (code) => {
  throw Object.assign(new Error(code), { code });
};

const networkFailureRefusal = (grant) =>
  grant === 'authorization_code' ? AuthRefusal.EXCHANGE_FAILED : TokenRefusal.TOKEN_ENDPOINT_ERROR;

const readBody = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

/**
 * @param {{ store: object, fetch: Function, endpoints: { tokenEndpoint: string }, nowMs: () => number, sleep: Function, jitter: () => number }} options
 * @returns {{ accessToken: Function, exchangeCode: Function, probe: Function }}
 */
export function createGoogleTokenSource({ store, fetch, endpoints, nowMs, sleep, jitter }) {
  let held = null;
  let inFlight = null;

  const postForm = async (form, grant) => {
    try {
      return await fetch(endpoints.tokenEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: encodeForm(form),
      });
    } catch {
      return refuse(networkFailureRefusal(grant));
    }
  };

  const postRefreshGrant = async (form) => {
    for (let attempt = 1; ; attempt += 1) {
      const response = await postForm(form, 'refresh_token');
      const decision =
        response.status === 200
          ? { retry: false }
          : decideRetry({ attempt, status: response.status, retryAfterSeconds: retryAfterSecondsOf(response.headers), jitter: jitter() });
      if (!decision.retry) return { status: response.status, body: await readBody(response) };
      await sleep(decision.delayMs);
    }
  };

  const persistRotatedRefreshToken = (refreshToken) => {
    if (refreshToken === null) return;
    const current = store.readToken();
    if (current.refreshToken !== refreshToken) store.writeToken(buildTokenFile({ ...current, refreshToken }));
  };

  const refresh = async () => {
    const client = store.readClient();
    const { refreshToken } = store.readToken();
    const response = await postRefreshGrant(refreshTokenForm({ client, refreshToken }));
    const tokens = parseTokenResponse(response, { grant: 'refresh_token', nowMs: nowMs() });
    persistRotatedRefreshToken(tokens.refreshToken);
    held = { accessToken: tokens.accessToken, expiresAtMs: tokens.expiresAtMs };
    return held.accessToken;
  };

  const accessToken = async ({ staleToken } = {}) => {
    if (held !== null && held.accessToken === staleToken) held = null;
    if (held !== null && !isExpired(held.expiresAtMs, nowMs(), EXPIRY_SKEW_MS)) return held.accessToken;
    inFlight ??= refresh().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const exchangeCode = async ({ code, verifier, redirectUri }) => {
    const response = await postForm(authorizationCodeForm({ client: store.readClient(), code, verifier, redirectUri }), 'authorization_code');
    return parseTokenResponse({ status: response.status, body: await readBody(response) }, { grant: 'authorization_code', nowMs: nowMs() });
  };

  return { accessToken, exchangeCode, probe: () => store.probe() };
}
