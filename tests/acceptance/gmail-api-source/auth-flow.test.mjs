// @contract-shape:bounded-change
// `harvest auth` (DR-0011): loopback + PKCE (S256) + state check, one consent, one
// refresh token written 0600 under a 0700 directory, never printed. The orchestration is
// driven with an injected fetch and an in-process browser; the subprocess scenario for the
// same port is in fetch-cli.test.mjs. Bounded change: <credential directory>/token.json only.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { runAuth } from '../../../src/cli/auth.mjs';
import {
  aCredentialHome,
  aGmailAlert,
  aGmailSource,
  aTokenFile,
  fileDigests,
  fileModes,
  noSecretsIn,
  readJsonFile,
  refusalOfAsync,
  AuthRefusal,
  GmailRefusal,
  GMAIL_READONLY_SCOPE,
  MAILBOX,
  NOW_ISO,
  SENTINEL,
  TOKEN_FILE_VERSION,
} from './support/gmail-domain-types.mjs';
import { createGmailFake, aFakeBrowser } from './support/gmail-fake.mjs';
import { createCredentialStore } from '../../../src/adapters/credential-store.mjs';
import { resolveEndpoints } from '../../../src/core/endpoints.mjs';
import { assertStateDelta, appendedWith } from '../../common/state-delta.mjs';

const aRandomness = () => {
  let draw = 0;
  return (bytes) => Uint8Array.from({ length: bytes }, (_, index) => (index * 37 + draw++ * 101 + 11) % 256);
};
const sha256 = (text) => createHash('sha256').update(text).digest();

/** The operator runs `auth` with a client file in place and no token yet. */
function anOperatorConsenting({ browser = aFakeBrowser(), fake = createGmailFake(), home = aCredentialHome({ token: null }) } = {}) {
  const run = () =>
    runAuth({
      store: createCredentialStore({ directory: home.directory }),
      fetch: (url, init) => fake.handle(url, init),
      loopback: browser.loopback,
      endpoints: resolveEndpoints({}),
      random: aRandomness(),
      sha256,
      now: () => NOW_ISO,
      print: browser.print,
    });
  return { run, browser, fake, home };
}

const credentialsOf = (home) => {
  const digests = fileDigests(home.directory);
  return { 'credentials.fileNames': Object.keys(digests), 'credentials.clientDigest': digests['client.json'], 'credentials.modes': fileModes(home.directory) };
};
const UNIVERSE = ['credentials.fileNames', 'credentials.clientDigest', 'credentials.modes'];

describe('@driving_port harvest auth consents once and records the refresh token (DR-0011)', () => {
  it('records the refresh token, the granted scope and the mailbox it belongs to, at mode 0600, and prints no secret', async () => {
    const consent = anOperatorConsenting();
    const before = credentialsOf(consent.home);

    const result = await consent.run();

    expect(result).toEqual({ emailAddress: MAILBOX });
    expect(readJsonFile(consent.home.tokenPath)).toEqual({
      version: TOKEN_FILE_VERSION,
      refreshToken: SENTINEL.refreshToken,
      scope: GMAIL_READONLY_SCOPE,
      emailAddress: MAILBOX,
      obtainedAt: NOW_ISO,
    });
    assertStateDelta(before, credentialsOf(consent.home), {
      universe: UNIVERSE,
      expected: {
        'credentials.fileNames': appendedWith('token.json'),
        'credentials.modes': { description: 'token file added at 0600, directory still 0700', holds: (b, a) => a['token.json'] === '600' && a['client.json'] === b['client.json'] },
      },
    });
    expect(consent.browser.lines.flatMap(noSecretsIn)).toEqual([]);
    expect(consent.browser.seen.closed).toBe(true);
  });

  it('asks for read-only offline access with PKCE S256, and proves the verifier on the wire', async () => {
    const consent = anOperatorConsenting();

    await consent.run();

    const url = consent.browser.seen.consentUrl;
    expect(url.searchParams.get('scope')).toBe(GMAIL_READONLY_SCOPE);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    const [exchange] = consent.fake.requestsTo('token');
    expect(createHash('sha256').update(exchange.form.code_verifier).digest('base64url')).toBe(url.searchParams.get('code_challenge'));
    expect(exchange.form.redirect_uri).toBe(url.searchParams.get('redirect_uri'));
    expect(url.searchParams.get('state')).not.toBe(url.searchParams.get('code_challenge'));
  });

  it('records the mailbox by asking Gmail who the new token belongs to', async () => {
    const consent = anOperatorConsenting({ fake: createGmailFake({ mailbox: 'someone.else@example.invalid' }) });

    await consent.run();

    expect(readJsonFile(consent.home.tokenPath).emailAddress).toBe('someone.else@example.invalid');
    expect(consent.fake.requestsTo('profile')[0].authorization).toBe(`Bearer ${SENTINEL.accessToken}`);
  });

  it('re-running auth after a revoked token replaces it, and the source then proves it can fetch again', async () => {
    // Given a token the operator revoked, which the probe refuses
    const fake = createGmailFake({ issuedRefreshToken: SENTINEL.refreshTokenRotated, messages: [aGmailAlert({ id: 'a1', date: '2026-09-01T09:48:30Z' })] });
    const home = aCredentialHome({ token: aTokenFile() });
    fake.revokeRefreshToken();
    expect((await refusalOfAsync(() => aGmailSource({ fake, home }).source.probe())).code).toBe(GmailRefusal.REAUTH_REQUIRED);

    // When the operator re-runs auth
    await anOperatorConsenting({ fake, home }).run();

    // Then the new token is recorded and the probe passes on it
    expect(readJsonFile(home.tokenPath).refreshToken).toBe(SENTINEL.refreshTokenRotated);
    await expect(aGmailSource({ fake, home }).source.probe()).resolves.not.toThrow();
  });

  const REFUSALS = [
    ['the redirect carries a state that was not issued', { answer: 'wrong-state' }, AuthRefusal.STATE_MISMATCH],
    ['the operator denies consent', { answer: 'deny' }, AuthRefusal.CONSENT_DENIED],
    ['the redirect carries no code', { answer: 'no-code' }, AuthRefusal.NO_CODE],
    ['the operator never answers before the timeout', { failWith: AuthRefusal.CONSENT_TIMEOUT }, AuthRefusal.CONSENT_TIMEOUT],
  ];
  for (const [title, options, code] of REFUSALS) {
    it(`@error refuses ${code} when ${title}: no code is exchanged, nothing is written, the listener is closed`, async () => {
      const consent = anOperatorConsenting({ browser: aFakeBrowser(options) });
      const before = credentialsOf(consent.home);

      const refusal = await refusalOfAsync(consent.run);

      expect(refusal.code).toBe(code);
      expect(consent.fake.requestsTo('token')).toEqual([]);
      assertStateDelta(before, credentialsOf(consent.home), { universe: UNIVERSE });
      expect(consent.browser.seen.closed).toBe(true);
    });
  }

  it('@error refuses when Google grants no refresh token, and writes nothing', async () => {
    const consent = anOperatorConsenting({ fake: createGmailFake({ omitRefreshToken: true }) });
    const before = credentialsOf(consent.home);

    const refusal = await refusalOfAsync(consent.run);

    expect(refusal.code).toBe(AuthRefusal.NO_REFRESH_TOKEN);
    assertStateDelta(before, credentialsOf(consent.home), { universe: UNIVERSE });
  });

  it('@error refuses a grant that is not exactly read-only mail, and writes nothing', async () => {
    const consent = anOperatorConsenting({ fake: createGmailFake({ grantedScope: `${GMAIL_READONLY_SCOPE} https://www.googleapis.com/auth/gmail.modify` }) });
    const before = credentialsOf(consent.home);

    expect((await refusalOfAsync(consent.run)).code).toBe(GmailRefusal.SCOPE_MISMATCH);
    assertStateDelta(before, credentialsOf(consent.home), { universe: UNIVERSE });
  });

  it('@error refuses a code the token endpoint rejects, exactly once, without echoing it', async () => {
    const consent = anOperatorConsenting({ fake: createGmailFake({ authCode: 'a-different-code' }) });
    const before = credentialsOf(consent.home);

    const refusal = await refusalOfAsync(consent.run);

    expect(refusal.code).toBe(AuthRefusal.EXCHANGE_FAILED);
    expect(noSecretsIn(refusal.message)).toEqual([]);
    expect(consent.fake.requestsTo('token')).toHaveLength(1);
    assertStateDelta(before, credentialsOf(consent.home), { universe: UNIVERSE });
  });

  it('@error refuses a client file that is readable by its group before it opens a listener', async () => {
    const consent = anOperatorConsenting({ home: aCredentialHome({ token: null, clientMode: 0o640 }) });

    expect((await refusalOfAsync(consent.run)).code).toBe(GmailRefusal.PERMISSIONS);
    expect(consent.browser.seen.listenCalls).toBe(0);
    expect(consent.fake.requests).toEqual([]);
  });

  it('@error refuses when there is no client file to consent with, before it opens a listener', async () => {
    const home = aCredentialHome({ token: null });
    rmSync(home.clientPath);
    const consent = anOperatorConsenting({ home });

    expect((await refusalOfAsync(consent.run)).code).toBe(GmailRefusal.MISSING);
    expect(consent.browser.seen.listenCalls).toBe(0);
  });
});
