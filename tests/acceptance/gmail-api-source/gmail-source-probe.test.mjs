// @contract-shape:unbounded-preservation
// DR-0003 / DR-0011 probe contract: wire, then probe, then use. Everything a probe
// does is read-only, so a failed probe leaves nothing half-done. An empty window
// commits coverage, so a wrong sender or a wrong mailbox would mark every day
// "covered, zero messages": the silent-loss shape DR-0002 exists to prevent.
// Adapter level: an injected fetch over the fake, real credential files under a temp HOME.
import { describe, expect } from 'vitest';
import { chmodSync, rmSync } from 'node:fs';
import {
  aCredentialHome,
  aGmailAlert,
  aGmailResource,
  aGmailSource,
  aMessage,
  aTokenFile,
  fileDigests,
  fileModes,
  noSecretsIn,
  refusalOfAsync,
  writeText,
  GmailRefusal,
  GMAIL_READONLY_SCOPE,
} from './support/gmail-domain-types.mjs';
import { createGmailFake, forbiddenFor, json, rateLimited } from './support/gmail-fake.mjs';
import { assertStateDelta } from '../../common/state-delta.mjs';
import { scenario } from './support/red-gate.mjs';

const anAlert = () => aGmailAlert({ id: 'a1', date: '2026-09-01T09:48:30Z' });
const credentialsOf = (home) => ({ 'credentials.files': fileDigests(home.directory), 'credentials.modes': fileModes(home.directory) });

describe('probe: the source proves it can fetch before anything is fetched (DR-0003)', () => {
  scenario('passes when the credential, token, mailbox and sender all check out, and reads no message', async () => {
    const fake = createGmailFake({ messages: [anAlert()] });
    const { source, home } = aGmailSource({ fake });
    const before = credentialsOf(home);

    await source.probe();

    assertStateDelta(before, credentialsOf(home), { universe: ['credentials.files', 'credentials.modes'] });
    expect(fake.requestsTo('get')).toEqual([]);
    expect(fake.requestsTo('profile')).toHaveLength(1);
    expect(fake.gmailRequests().every((request) => request.method === 'GET')).toBe(true);
  });

  const REFUSALS = [
    ['the client file is absent', GmailRefusal.MISSING, ({ home }) => rmSync(home.clientPath)],
    ['the token file is absent', GmailRefusal.MISSING, ({ home }) => rmSync(home.tokenPath)],
    ['the client file is not valid', GmailRefusal.INVALID, ({ home }) => { writeText(home.clientPath, '{nope'); chmodSync(home.clientPath, 0o600); }],
    ['the token file names no refresh token', GmailRefusal.INVALID, ({ home }) => { writeText(home.tokenPath, JSON.stringify({ ...aTokenFile(), refreshToken: undefined })); chmodSync(home.tokenPath, 0o600); }],
    ['the client file is readable by its group', GmailRefusal.PERMISSIONS, ({ home }) => chmodSync(home.clientPath, 0o640)],
    ['the token file is readable by everyone', GmailRefusal.PERMISSIONS, ({ home }) => chmodSync(home.tokenPath, 0o644)],
    ['the credential directory is open to its group', GmailRefusal.PERMISSIONS, ({ home }) => chmodSync(home.directory, 0o750)],
    ['the refresh token has been revoked', GmailRefusal.REAUTH_REQUIRED, ({ fake }) => fake.revokeRefreshToken()],
    ['the token endpoint rejects the client', GmailRefusal.TOKEN_ENDPOINT_ERROR, ({ fake }) => fake.override('token', () => json(401, { error: 'invalid_client' }))],
    ['the token endpoint answers with no access token', GmailRefusal.TOKEN_ENDPOINT_ERROR, ({ fake }) => fake.override('token', () => json(200, { expires_in: 3599, scope: GMAIL_READONLY_SCOPE }))],
    ['the granted scope is narrower than read-only mail', GmailRefusal.SCOPE_MISMATCH, ({ fake }) => fake.override('token', () => json(200, { access_token: 'x', expires_in: 3599, scope: 'openid' }))],
    ['the granted scope is wider than read-only mail', GmailRefusal.SCOPE_MISMATCH, ({ fake }) => fake.override('token', () => json(200, { access_token: 'x', expires_in: 3599, scope: `${GMAIL_READONLY_SCOPE} https://www.googleapis.com/auth/gmail.modify` }))],
    ['the profile call is unauthenticated', GmailRefusal.UNAUTHORIZED, ({ fake }) => fake.override('profile', () => json(401, { error: { code: 401, message: 'Invalid Credentials' } }))],
    ['the profile call is forbidden', GmailRefusal.UNAUTHORIZED, ({ fake }) => fake.override('profile', () => forbiddenFor('forbidden'))],
    ['the token belongs to a different mailbox than the one recorded at auth', GmailRefusal.WRONG_MAILBOX, ({ home }) => { writeText(home.tokenPath, JSON.stringify(aTokenFile({ emailAddress: 'someone.else@example.invalid' }))); chmodSync(home.tokenPath, 0o600); }],
    ['Gmail rejects the sender query', GmailRefusal.QUERY_REJECTED, ({ fake }) => fake.override('list', () => json(400, { error: { code: 400, message: 'Invalid query', errors: [{ reason: 'invalidArgument' }] } }))],
    ['quota is exhausted (429 on every attempt)', GmailRefusal.QUOTA_EXHAUSTED, ({ fake }) => fake.override('list', () => rateLimited())],
    ['quota is exhausted (403 rate reason on every attempt)', GmailRefusal.QUOTA_EXHAUSTED, ({ fake }) => fake.override('list', () => forbiddenFor('userRateLimitExceeded'))],
    ['the list answer is an empty object', GmailRefusal.LIST_MALFORMED, ({ fake }) => fake.override('list', () => json(200, {}))],
    ['the list answer has no size estimate', GmailRefusal.LIST_MALFORMED, ({ fake }) => fake.override('list', () => json(200, { messages: [] }))],
    ['the list answer is an error page rather than JSON', GmailRefusal.LIST_MALFORMED, ({ fake }) => fake.override('list', () => new Response('<html>Service Unavailable</html>', { status: 200, headers: { 'content-type': 'text/html' } }))],
  ];

  for (const [title, code, arrange] of REFUSALS) {
    scenario(`@error refuses ${code} when ${title}, and leaves the credentials untouched and no secret in the refusal`, async () => {
      const fake = createGmailFake({ messages: [anAlert()] });
      const wired = aGmailSource({ fake });
      arrange(wired);
      const before = credentialsOf(wired.home);

      const refusal = await refusalOfAsync(() => wired.source.probe());

      expect(refusal?.code).toBe(code);
      expect(noSecretsIn(refusal.message)).toEqual([]);
      assertStateDelta(before, credentialsOf(wired.home), { universe: ['credentials.files'] });
      expect(fake.gmailRequests().every((request) => request.method === 'GET')).toBe(true);
    });
  }

  scenario('@error a revoked refresh token tells the operator to re-run auth, never a raw HTTP error', async () => {
    const fake = createGmailFake({ messages: [anAlert()] });
    fake.revokeRefreshToken();
    const { source } = aGmailSource({ fake });

    const refusal = await refusalOfAsync(() => source.probe());

    expect(refusal.code).toBe(GmailRefusal.REAUTH_REQUIRED);
    expect(refusal.message).toContain('harvest auth');
    expect(refusal.message).not.toMatch(/\b400\b/);
  });

  scenario('@error refuses when no message in the mailbox comes from the sender, so no day can be marked covered with zero', async () => {
    const stranger = aGmailResource({ record: aMessage({ id: 'x1', date: '2026-09-01T09:48:30Z', sender: 'newsletter@example.invalid' }), fromHeader: 'News <newsletter@example.invalid>' });
    const fake = createGmailFake({ messages: [stranger] });
    const { source } = aGmailSource({ fake });

    const refusal = await refusalOfAsync(() => source.probe());

    expect(refusal.code).toBe(GmailRefusal.SENDER_MATCHES_NOTHING);
  });
});
