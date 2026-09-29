// @contract-shape:pure-function
// DR-0011: loopback + PKCE (S256) + state check; scope gmail.readonly; credential
// files with no group/other bits and a 0700 directory. Every decision is pure;
// hashing is injected because core imports no node: builtin.
import { describe, expect } from 'vitest';
import fc from 'fast-check';
import { createHash } from 'node:crypto';
import {
  pkceChallenge,
  buildConsentUrl,
  parseCallback,
  parseTokenResponse,
  checkGrantedScope,
  isExpired,
  fileModeRefusal,
  directoryModeRefusal,
  parseClientFile,
  buildTokenFile,
  parseTokenFile,
  GMAIL_READONLY_SCOPE,
  AuthRefusal,
  TokenRefusal,
  CredentialRefusal,
} from '../../../src/core/oauth.mjs';
import { refusalOf, aClientFile, aTokenFile, SENTINEL, NOW_MS } from './support/gmail-domain-types.mjs';
import { scenario } from './support/red-gate.mjs';
import { holds } from './support/property.mjs';

const sha256 = (text) => createHash('sha256').update(text).digest();
const REDIRECT = 'http://127.0.0.1:45871/callback';
const unreserved = fc.stringMatching(/^[A-Za-z0-9._~-]{43,128}$/);
const opaque = fc.stringMatching(/^[A-Za-z0-9_-]{8,64}$/);

describe('PKCE and the consent URL (DR-0011)', () => {
  scenario('derives the S256 challenge from the RFC 7636 published example', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', sha256)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  scenario('@property a challenge is the unpadded base64url SHA-256 of its verifier', () => {
    holds(
      fc.property(unreserved, (verifier) => {
        const challenge = pkceChallenge(verifier, sha256);
        expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
        expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
      }),
    );
  });

  scenario('the consent URL asks for read-only offline access with PKCE S256 and a state', () => {
    const url = new URL(
      buildConsentUrl({ authUri: 'https://accounts.google.com/o/oauth2/v2/auth', clientId: 'client-1', redirectUri: REDIRECT, state: 'state-1', codeChallenge: 'challenge-1' }),
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: REDIRECT,
      scope: GMAIL_READONLY_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      code_challenge: 'challenge-1',
      code_challenge_method: 'S256',
      state: 'state-1',
    });
  });
});

describe('the consent callback', () => {
  scenario('@property hands over the code when the state matches', () => {
    holds(
      fc.property(opaque, opaque, (state, code) => {
        expect(parseCallback(`${REDIRECT}?code=${code}&state=${state}`, { expectedState: state })).toEqual({ code });
      }),
    );
  });

  scenario('@error @property refuses a callback whose state is not the one issued', () => {
    holds(
      fc.property(opaque, opaque, opaque, (issued, returned, code) => {
        fc.pre(issued !== returned);
        expect(refusalOf(() => parseCallback(`${REDIRECT}?code=${code}&state=${returned}`, { expectedState: issued }))).toBe(AuthRefusal.STATE_MISMATCH);
      }),
    );
  });

  scenario('@error refuses when the operator denies consent', () => {
    expect(refusalOf(() => parseCallback(`${REDIRECT}?error=access_denied&state=s1`, { expectedState: 's1' }))).toBe(AuthRefusal.CONSENT_DENIED);
  });

  scenario('@error refuses a callback that carries no code', () => {
    expect(refusalOf(() => parseCallback(`${REDIRECT}?state=s1`, { expectedState: 's1' }))).toBe(AuthRefusal.NO_CODE);
  });
});

describe('reading the token endpoint response', () => {
  const refreshed = (overrides = {}) => ({
    status: 200,
    body: { access_token: SENTINEL.accessToken, expires_in: 3599, scope: GMAIL_READONLY_SCOPE, token_type: 'Bearer', ...overrides },
  });

  scenario('reads a refresh response into a token with an absolute expiry and no rotated refresh token', () => {
    expect(parseTokenResponse(refreshed(), { grant: 'refresh_token', nowMs: NOW_MS })).toEqual({
      accessToken: SENTINEL.accessToken,
      refreshToken: null,
      scope: GMAIL_READONLY_SCOPE,
      expiresAtMs: NOW_MS + 3599 * 1000,
    });
  });

  scenario('reads a rotated refresh token out of a refresh response', () => {
    const token = parseTokenResponse(refreshed({ refresh_token: SENTINEL.refreshTokenRotated }), { grant: 'refresh_token', nowMs: NOW_MS });
    expect(token.refreshToken).toBe(SENTINEL.refreshTokenRotated);
  });

  scenario('@error maps invalid_grant on a refresh to a named request to re-run auth', () => {
    const response = { status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } };
    expect(refusalOf(() => parseTokenResponse(response, { grant: 'refresh_token', nowMs: NOW_MS }))).toBe(TokenRefusal.REAUTH_REQUIRED);
  });

  const OTHER_FAILURES = [
    ['a client the endpoint does not recognise', { status: 401, body: { error: 'invalid_client' } }],
    ['a server error', { status: 503, body: { error: 'backend_error' } }],
    ['a success with no access token', { status: 200, body: { expires_in: 3599, scope: GMAIL_READONLY_SCOPE } }],
    ['a success that is not JSON', { status: 200, body: null }],
  ];
  for (const [title, response] of OTHER_FAILURES) {
    scenario(`@error refuses ${title} by name, never as a raw HTTP error`, () => {
      expect(refusalOf(() => parseTokenResponse(response, { grant: 'refresh_token', nowMs: NOW_MS }))).toBe(TokenRefusal.TOKEN_ENDPOINT_ERROR);
    });
  }

  scenario('@error refuses a code exchange that returns no refresh token', () => {
    expect(refusalOf(() => parseTokenResponse(refreshed(), { grant: 'authorization_code', nowMs: NOW_MS }))).toBe(AuthRefusal.NO_REFRESH_TOKEN);
  });

  scenario('@error refuses a failed code exchange as an exchange failure, whatever the status', () => {
    for (const status of [400, 401, 503]) {
      const response = { status, body: { error: 'invalid_grant' } };
      expect(refusalOf(() => parseTokenResponse(response, { grant: 'authorization_code', nowMs: NOW_MS }))).toBe(AuthRefusal.EXCHANGE_FAILED);
    }
  });

  scenario('accepts a scope of exactly gmail.readonly', () => {
    expect(refusalOf(() => checkGrantedScope(GMAIL_READONLY_SCOPE))).toBeNull();
  });

  scenario('@error @property refuses any granted scope other than exactly gmail.readonly, narrower or wider', () => {
    const scopes = fc.array(fc.constantFrom('https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/userinfo.email', 'openid'), { maxLength: 4 });
    holds(
      fc.property(scopes, (granted) => {
        const isExactlyReadonly = new Set(granted).size === 1 && granted.every((scope) => scope === GMAIL_READONLY_SCOPE);
        fc.pre(!isExactlyReadonly);
        expect(refusalOf(() => checkGrantedScope(granted.join(' ')))).toBe(TokenRefusal.SCOPE_MISMATCH);
      }),
    );
  });

  scenario('@property a token is expired once the skew reaches its expiry, and not before', () => {
    holds(
      fc.property(fc.integer({ min: 0, max: 4e12 }), fc.integer({ min: 0, max: 4e12 }), fc.integer({ min: 0, max: 600_000 }), (expiresAtMs, nowMs, skewMs) => {
        expect(isExpired(expiresAtMs, nowMs, skewMs)).toBe(nowMs + skewMs >= expiresAtMs);
      }),
    );
  });
});

describe('the credential files (DR-0011)', () => {
  scenario('@property a credential file is refused exactly when a group or other permission bit is set', () => {
    holds(
      fc.property(fc.integer({ min: 0, max: 0o777 }), (mode) => {
        expect(fileModeRefusal(mode)).toBe((mode & 0o077) === 0 ? null : CredentialRefusal.PERMISSIONS);
      }),
    );
  });

  scenario('a credential file may carry owner bits beyond read and write', () => {
    expect([0o400, 0o600, 0o700].map(fileModeRefusal)).toEqual([null, null, null]);
  });

  scenario('@property the credential directory is accepted exactly when it is 0700', () => {
    holds(
      fc.property(fc.integer({ min: 0, max: 0o777 }), (mode) => {
        expect(directoryModeRefusal(mode)).toBe(mode === 0o700 ? null : CredentialRefusal.PERMISSIONS);
      }),
    );
  });

  scenario('reads the client id and secret out of the JSON Google Cloud hands out', () => {
    expect(parseClientFile(aClientFile())).toEqual({
      clientId: '1234567890-abcdefghijklmnop.apps.googleusercontent.com',
      clientSecret: SENTINEL.clientSecret,
    });
  });

  const BAD_CLIENT_FILES = [
    ['a file with no installed client', {}],
    ['a client with no secret', { installed: { client_id: 'id-only' } }],
    ['text that is not a client file', 'nope'],
  ];
  for (const [title, json] of BAD_CLIENT_FILES) {
    scenario(`@error refuses ${title} as an invalid credential`, () => {
      expect(refusalOf(() => parseClientFile(json))).toBe(CredentialRefusal.INVALID);
    });
  }

  scenario('@property a token file reads back exactly what was built', () => {
    holds(
      fc.property(opaque, fc.emailAddress(), (refreshToken, emailAddress) => {
        const fields = { refreshToken, scope: GMAIL_READONLY_SCOPE, emailAddress, obtainedAt: '2026-09-29T10:00:00Z' };
        expect(parseTokenFile(buildTokenFile(fields))).toEqual({ version: 1, ...fields });
      }),
    );
  });

  const BAD_TOKEN_FILES = [
    ['a token file with no refresh token', { ...aTokenFile(), refreshToken: undefined }],
    ['a token file with no recorded mailbox', { ...aTokenFile(), emailAddress: undefined }],
    ['a token file from a future version', { ...aTokenFile(), version: 99 }],
  ];
  for (const [title, json] of BAD_TOKEN_FILES) {
    scenario(`@error refuses ${title}`, () => {
      expect(refusalOf(() => parseTokenFile(json))).toBe(CredentialRefusal.INVALID);
    });
  }
});
