// Orchestration of the one-off consent: `harvest auth`. Adapters arrive as arguments.
import { AuthRefusal, buildConsentUrl, buildTokenFile, checkGrantedScope, parseCallback, parseTokenResponse, pkceChallenge } from '../core/oauth.mjs';

const RANDOM_BYTES = 32;

const toBase64Url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

const refuse = (code) => {
  throw Object.assign(new Error(code), { code });
};

const readBody = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const exchangeCode = async ({ fetch, endpoints, client, code, verifier, redirectUri, nowMs }) => {
  const form = {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    client_id: client.clientId,
    client_secret: client.clientSecret,
  };
  const response = await fetch(endpoints.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  }).catch(() => refuse(AuthRefusal.EXCHANGE_FAILED));
  return parseTokenResponse({ status: response.status, body: await readBody(response) }, { grant: 'authorization_code', nowMs });
};

const mailboxOf = async ({ fetch, endpoints, accessToken }) => {
  const response = await fetch(`${endpoints.gmailBase}/users/me/profile`, { headers: { authorization: `Bearer ${accessToken}` } });
  return (await readBody(response))?.emailAddress;
};

/**
 * @param {{ store: object, fetch: Function, loopback: object, endpoints: object,
 *           random: (bytes: number) => Uint8Array, sha256: (text: string) => Uint8Array,
 *           now: () => string, print: (line: string) => void }} collaborators
 * @returns {Promise<{ emailAddress: string }>}
 */
export async function runAuth({ store, fetch, loopback, endpoints, random, sha256, now, print }) {
  const client = store.readClient();
  const listener = await loopback.listen();
  try {
    const verifier = toBase64Url(random(RANDOM_BYTES));
    const state = toBase64Url(random(RANDOM_BYTES));
    print(
      buildConsentUrl({
        authUri: endpoints.authUri,
        clientId: client.clientId,
        redirectUri: listener.redirectUri,
        state,
        codeChallenge: pkceChallenge(verifier, sha256),
      }),
    );
    const { code } = parseCallback(await listener.awaitCallback(), { expectedState: state });
    const tokens = await exchangeCode({ fetch, endpoints, client, code, verifier, redirectUri: listener.redirectUri, nowMs: Date.parse(now()) });
    checkGrantedScope(tokens.scope);
    const emailAddress = await mailboxOf({ fetch, endpoints, accessToken: tokens.accessToken });
    store.writeToken(buildTokenFile({ refreshToken: tokens.refreshToken, scope: tokens.scope, emailAddress, obtainedAt: now() }));
    return { emailAddress };
  } finally {
    listener.close();
  }
}
