// @contract-shape:bounded-change
// The token endpoint client (DR-0011): the access token lives in memory only and is
// refreshed once per process; a rotated refresh token is persisted through the store
// and nowhere else; the authorization code is single-use so its exchange is never retried.
// Adapter level: an injected fetch over the fake, real credential files under a temp HOME.
import { describe, expect, it } from 'vitest';
import {
  aCredentialHome,
  aGmailSource,
  fileDigests,
  fileModes,
  readJsonFile,
  refusalOfAsync,
  noSecretsIn,
  GmailRefusal,
  AuthRefusal,
  GMAIL_READONLY_SCOPE,
  SENTINEL,
  aClientFile,
} from './support/gmail-domain-types.mjs';
import { createGmailFake, serverError } from './support/gmail-fake.mjs';
import { assertStateDelta, setTo } from '../../common/state-delta.mjs';

const credentialsOf = (home) => ({
  'credentials.files': fileDigests(home.directory),
  'credentials.modes': fileModes(home.directory),
  'token.refreshToken': readJsonFile(home.tokenPath).refreshToken,
});
const UNIVERSE = ['credentials.files', 'credentials.modes', 'token.refreshToken'];

describe('refreshing the access token', () => {
  it('refreshes once per process however many times the token is asked for', async () => {
    const fake = createGmailFake();
    const { tokenSource, home } = aGmailSource({ fake });
    const before = credentialsOf(home);

    const first = await tokenSource.accessToken();
    const second = await tokenSource.accessToken();

    expect(first).toBe(SENTINEL.accessToken);
    expect(second).toBe(first);
    expect(fake.requestsTo('token')).toHaveLength(1);
    assertStateDelta(before, credentialsOf(home), { universe: UNIVERSE });
  });

  it('sends the refresh grant with the client id and secret to the resolved token endpoint, not the one in the client file', async () => {
    const fake = createGmailFake();
    const { tokenSource, endpoints } = aGmailSource({ fake });

    await tokenSource.accessToken();

    const [request] = fake.requestsTo('token');
    expect(request.method).toBe('POST');
    expect(request.form).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: SENTINEL.refreshToken,
      client_id: '1234567890-abcdefghijklmnop.apps.googleusercontent.com',
      client_secret: SENTINEL.clientSecret,
    });
    expect(new URL(request.path, 'http://x').pathname).toBe(new URL(endpoints.tokenEndpoint).pathname);
  });

  it('persists a rotated refresh token through the store, at mode 0600, keeping every other field', async () => {
    const fake = createGmailFake({ rotateRefreshTo: SENTINEL.refreshTokenRotated });
    const { tokenSource, home } = aGmailSource({ fake });
    const before = credentialsOf(home);
    const recorded = readJsonFile(home.tokenPath);

    await tokenSource.accessToken();

    expect(readJsonFile(home.tokenPath)).toEqual({ ...recorded, refreshToken: SENTINEL.refreshTokenRotated });
    assertStateDelta(before, credentialsOf(home), {
      universe: UNIVERSE,
      expected: { 'token.refreshToken': setTo(SENTINEL.refreshTokenRotated), 'credentials.files': { description: 'token file rewritten, client file untouched', holds: (b, a) => a['client.json'] === b['client.json'] && a['token.json'] !== b['token.json'] } },
    });
  });

  it('never writes the access token to disk', async () => {
    const fake = createGmailFake({ rotateRefreshTo: SENTINEL.refreshTokenRotated });
    const { tokenSource, home } = aGmailSource({ fake });

    await tokenSource.accessToken();

    for (const name of Object.keys(fileDigests(home.directory))) {
      expect(JSON.stringify(readJsonFile(`${home.directory}/${name}`))).not.toContain(SENTINEL.accessToken);
    }
  });

  it('a failing refresh is retried, then succeeds', async () => {
    const fake = createGmailFake();
    fake.override('token', () => serverError(503), { times: 1 });
    const { tokenSource, sleeps } = aGmailSource({ fake });

    await expect(tokenSource.accessToken()).resolves.toBe(SENTINEL.accessToken);
    expect(fake.requestsTo('token')).toHaveLength(2);
    expect(sleeps).toHaveLength(1);
  });

  it('@error a revoked refresh token is refused by name and the token file is left as it was', async () => {
    const fake = createGmailFake();
    fake.revokeRefreshToken();
    const { tokenSource, home } = aGmailSource({ fake });
    const before = credentialsOf(home);

    const refusal = await refusalOfAsync(() => tokenSource.accessToken());

    expect(refusal.code).toBe(GmailRefusal.REAUTH_REQUIRED);
    expect(noSecretsIn(refusal.message)).toEqual([]);
    assertStateDelta(before, credentialsOf(home), { universe: UNIVERSE });
    expect(fake.requestsTo('token')).toHaveLength(1);
  });

  it('@error a rejected client secret is refused by name without echoing the secret', async () => {
    const fake = createGmailFake({ clientSecret: 'a-different-secret' });
    const { tokenSource } = aGmailSource({ fake, home: aCredentialHome({ client: aClientFile() }) });

    const refusal = await refusalOfAsync(() => tokenSource.accessToken());

    expect(refusal.code).toBe(GmailRefusal.TOKEN_ENDPOINT_ERROR);
    expect(noSecretsIn(refusal.message)).toEqual([]);
  });
});

describe('exchanging the one-time authorization code', () => {
  const grant = { code: SENTINEL.authCode, verifier: 'v'.repeat(43), redirectUri: 'http://127.0.0.1:45871/callback' };

  it('sends the code with its PKCE verifier and redirect URI, and returns the tokens with the granted scope', async () => {
    const fake = createGmailFake();
    const { tokenSource } = aGmailSource({ fake });

    const tokens = await tokenSource.exchangeCode(grant);

    expect(tokens).toMatchObject({ accessToken: SENTINEL.accessToken, refreshToken: SENTINEL.refreshToken, scope: GMAIL_READONLY_SCOPE });
    expect(fake.requestsTo('token')[0].form).toMatchObject({
      grant_type: 'authorization_code',
      code: SENTINEL.authCode,
      code_verifier: grant.verifier,
      redirect_uri: grant.redirectUri,
    });
  });

  it('@error never retries an exchange that fails, because the code is single-use', async () => {
    const fake = createGmailFake();
    fake.override('token', () => serverError(503));
    const { tokenSource, sleeps } = aGmailSource({ fake });

    const refusal = await refusalOfAsync(() => tokenSource.exchangeCode(grant));

    expect(refusal.code).toBe(AuthRefusal.EXCHANGE_FAILED);
    expect(fake.requestsTo('token')).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('@error refuses a code the endpoint does not accept, naming the exchange and not echoing the code', async () => {
    const fake = createGmailFake({ authCode: 'a-different-code' });
    const { tokenSource } = aGmailSource({ fake });

    const refusal = await refusalOfAsync(() => tokenSource.exchangeCode(grant));

    expect(refusal.code).toBe(AuthRefusal.EXCHANGE_FAILED);
    expect(noSecretsIn(refusal.message)).toEqual([]);
  });

  it('@error refuses an exchange that returns no refresh token', async () => {
    const fake = createGmailFake({ omitRefreshToken: true });
    const { tokenSource } = aGmailSource({ fake });

    expect((await refusalOfAsync(() => tokenSource.exchangeCode(grant))).code).toBe(AuthRefusal.NO_REFRESH_TOKEN);
  });
});
