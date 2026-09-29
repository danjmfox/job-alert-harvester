// Driven adapter: the Google token endpoint. Refreshes the access token once per
// process and persists a rotated refresh token only through the injected store.
// The access token lives in memory only; the code exchange is never retried.
import { AuthRefusal, TokenRefusal, buildTokenFile, isExpired, parseTokenResponse } from '../core/oauth.mjs';
import { decideRetry } from '../core/retry-policy.mjs';

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

const retryAfterSecondsOf = (response) => {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && response.headers.has('retry-after') ? seconds : null;
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
        body: new URLSearchParams(form).toString(),
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
          : decideRetry({ attempt, status: response.status, retryAfterSeconds: retryAfterSecondsOf(response), jitter: jitter() });
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
    const { clientId, clientSecret } = store.readClient();
    const { refreshToken } = store.readToken();
    const response = await postRefreshGrant({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });
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
    const { clientId, clientSecret } = store.readClient();
    const response = await postForm(
      {
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      },
      'authorization_code',
    );
    return parseTokenResponse({ status: response.status, body: await readBody(response) }, { grant: 'authorization_code', nowMs: nowMs() });
  };

  return { accessToken, exchangeCode, probe: () => store.probe() };
}
