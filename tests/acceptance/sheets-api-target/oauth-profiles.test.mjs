// @contract-shape:pure-function
// SD-10 (scope profiles, exact-set scope check, token file bound to its slot). `auth --target sheets` asks for
// drive.file and only drive.file; the Gmail checks must not weaken, so every Gmail default is pinned beside the
// Sheets profile. Pure layer: no I/O, property tests over the scope domain.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  buildConsentUrl,
  checkGrantedScope,
  directoryModeRefusal,
  fileModeRefusal,
  parseClientFile,
  parseTokenFile,
  parseTokenResponse,
} from '../../../src/core/oauth.mjs';
import { AuthRefusal, DRIVE_FILE_SCOPE, GMAIL, GMAIL_READONLY_SCOPE, NOW_MS, SENTINEL, SHEETS, SHEETS_SENTINEL, SheetsRefusal, aClientFile, aSheetsTokenFile, aTokenFile, refusalOf } from './support/sheets-domain-types.mjs';
import { holds } from './support/property.mjs';

const CONSENT = { authUri: 'https://accounts.google.com/o/oauth2/v2/auth', clientId: 'client-1.apps.googleusercontent.com', redirectUri: 'http://127.0.0.1:45871/callback', state: 'state-1', codeChallenge: 'challenge-1' };
const scopeOf = (url) => new URL(url).searchParams.get('scope');
const tokenBody = (scope, extra = {}) => ({ status: 200, body: { access_token: 'ya29.x', expires_in: 3599, scope, token_type: 'Bearer', ...extra } });
const OTHER_SCOPES = [GMAIL_READONLY_SCOPE, 'https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets', 'openid', 'email'];

describe('Gmail behaves exactly as before when no profile is named', () => {
  it('the consent URL asks for gmail.readonly and nothing else', () => {
    expect(scopeOf(buildConsentUrl(CONSENT))).toBe(GMAIL_READONLY_SCOPE);
  });

  it('@error a drive.file grant is refused for Gmail as gmail.scope-mismatch', () => {
    expect(refusalOf(() => checkGrantedScope(DRIVE_FILE_SCOPE))).toBe('gmail.scope-mismatch');
    expect(refusalOf(() => checkGrantedScope(GMAIL_READONLY_SCOPE))).toBeNull();
  });

  it('@error a Gmail token file without a mailbox is still invalid, and its refusals keep the gmail namespace', () => {
    const { emailAddress: _mailbox, ...withoutMailbox } = aTokenFile();

    expect(refusalOf(() => parseTokenFile(withoutMailbox))).toBe('gmail.credential-invalid');
    expect(refusalOf(() => parseClientFile({}))).toBe('gmail.credential-invalid');
    expect(fileModeRefusal(0o644)).toBe('gmail.credential-permissions');
    expect(directoryModeRefusal(0o750)).toBe('gmail.credential-permissions');
  });

  it('the two profiles name different scopes and different refusal namespaces, and neither can be changed', () => {
    expect(GMAIL).toEqual({ scope: GMAIL_READONLY_SCOPE, namespace: 'gmail' });
    expect(SHEETS).toEqual({ scope: DRIVE_FILE_SCOPE, namespace: 'sheets' });
    expect(Object.isFrozen(GMAIL) && Object.isFrozen(SHEETS)).toBe(true);
  });
});

describe('@driving_port the Sheets consent asks for drive.file only (DR-0012)', () => {
  it('the consent URL asks for drive.file, offline access, PKCE S256 and a state', () => {
    const url = new URL(buildConsentUrl({ ...CONSENT, profile: SHEETS }));

    expect(url.searchParams.get('scope')).toBe(DRIVE_FILE_SCOPE);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1');
    expect(url.searchParams.get('state')).toBe('state-1');
  });

  it('@property whatever the state, challenge and client, the scope is exactly drive.file and names no mail scope', () => {
    holds(
      fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), fc.stringMatching(/^[a-z0-9-]{1,20}$/), (state, codeChallenge, client) => {
        const scope = scopeOf(buildConsentUrl({ ...CONSENT, state, codeChallenge, clientId: `${client}.apps.googleusercontent.com`, profile: SHEETS }));
        expect(scope).toBe(DRIVE_FILE_SCOPE);
        expect(scope).not.toContain('gmail');
      }),
    );
  });
});

describe('the granted scope must be exactly the profile scope: set equality, never a superset or an alternative (SD-10)', () => {
  it('accepts exactly drive.file for Sheets', () => {
    expect(refusalOf(() => checkGrantedScope(DRIVE_FILE_SCOPE, SHEETS))).toBeNull();
  });

  it('@error @property refuses every scope set other than exactly drive.file, by name', () => {
    const scopeSets = fc
      .subarray([DRIVE_FILE_SCOPE, ...OTHER_SCOPES])
      .filter((scopes) => !(scopes.length === 1 && scopes[0] === DRIVE_FILE_SCOPE))
      .chain((scopes) => fc.shuffledSubarray(scopes, { minLength: scopes.length, maxLength: scopes.length }))
      .map((scopes) => scopes.join(' '));
    holds(
      fc.property(scopeSets, (scope) => {
        expect(refusalOf(() => checkGrantedScope(scope, SHEETS))).toBe(SheetsRefusal.SCOPE_MISMATCH);
      }),
    );
  });

  it('@error refuses an absent or non-text scope for Sheets', () => {
    for (const scope of [undefined, null, 42, '']) expect(refusalOf(() => checkGrantedScope(scope, SHEETS))).toBe(SheetsRefusal.SCOPE_MISMATCH);
  });

  it('@error refuses the Gmail scope under the Sheets profile, and drive.file under the Gmail profile', () => {
    expect(refusalOf(() => checkGrantedScope(GMAIL_READONLY_SCOPE, SHEETS))).toBe(SheetsRefusal.SCOPE_MISMATCH);
    expect(refusalOf(() => checkGrantedScope(DRIVE_FILE_SCOPE, GMAIL))).toBe('gmail.scope-mismatch');
  });
});

describe('token endpoint answers under the Sheets profile carry the sheets namespace', () => {
  it('a refresh answering drive.file yields an access token, its scope and its expiry', () => {
    const tokens = parseTokenResponse(tokenBody(DRIVE_FILE_SCOPE), { grant: 'refresh_token', nowMs: NOW_MS, profile: SHEETS });

    expect(tokens).toMatchObject({ accessToken: 'ya29.x', scope: DRIVE_FILE_SCOPE, expiresAtMs: NOW_MS + 3_599_000 });
  });

  const FAILURES = [
    ['a wider grant is refused for the scope', tokenBody(`${DRIVE_FILE_SCOPE} ${GMAIL_READONLY_SCOPE}`), 'refresh_token', SheetsRefusal.SCOPE_MISMATCH],
    ['the Gmail grant is refused for the scope', tokenBody(GMAIL_READONLY_SCOPE), 'refresh_token', SheetsRefusal.SCOPE_MISMATCH],
    ['invalid_grant on a refresh means the operator must consent again', { status: 400, body: { error: 'invalid_grant' } }, 'refresh_token', SheetsRefusal.REAUTH_REQUIRED],
    ['a server error on a refresh is a token-endpoint error', { status: 503, body: null }, 'refresh_token', SheetsRefusal.TOKEN_ENDPOINT_ERROR],
    ['a success without an access token is a token-endpoint error', { status: 200, body: { expires_in: 3599, scope: DRIVE_FILE_SCOPE } }, 'refresh_token', SheetsRefusal.TOKEN_ENDPOINT_ERROR],
    ['a failed code exchange stays auth.exchange-failed whatever the profile', { status: 400, body: { error: 'invalid_grant' } }, 'authorization_code', AuthRefusal.EXCHANGE_FAILED],
    ['a code exchange that yields no refresh token is auth.no-refresh-token', tokenBody(DRIVE_FILE_SCOPE), 'authorization_code', AuthRefusal.NO_REFRESH_TOKEN],
  ];
  for (const [title, response, grant, code] of FAILURES) {
    it(`@error ${title}: ${code}`, () => {
      expect(refusalOf(() => parseTokenResponse(response, { grant, nowMs: NOW_MS, profile: SHEETS }))).toBe(code);
    });
  }
});

describe('a token file is bound to its slot: the Sheets file needs no mailbox and carries drive.file, the Gmail file the reverse (SD-10)', () => {
  it('reads a Sheets token file that has no mailbox', () => {
    expect(parseTokenFile(aSheetsTokenFile(), SHEETS)).toEqual(aSheetsTokenFile());
  });

  it('@error a Gmail token file read as the Sheets slot is refused as sheets.scope-mismatch, and the reverse as gmail.scope-mismatch', () => {
    expect(refusalOf(() => parseTokenFile(aTokenFile(), SHEETS))).toBe(SheetsRefusal.SCOPE_MISMATCH);
    expect(refusalOf(() => parseTokenFile({ ...aSheetsTokenFile(), emailAddress: 'a@b.c' }, GMAIL))).toBe('gmail.scope-mismatch');
  });

  it('@error a Sheets token file with no refresh token, an unknown version or non-text fields is sheets.credential-invalid', () => {
    for (const broken of [{ ...aSheetsTokenFile(), refreshToken: '' }, { ...aSheetsTokenFile(), version: 99 }, { ...aSheetsTokenFile(), obtainedAt: 7 }, null, 'text']) {
      expect(refusalOf(() => parseTokenFile(broken, SHEETS))).toBe(SheetsRefusal.CREDENTIAL_INVALID);
    }
  });

  it('@error the Sheets slot names its own permission and shape refusals, so an operator is told which credential is wrong', () => {
    expect(fileModeRefusal(0o644, SHEETS)).toBe(SheetsRefusal.CREDENTIAL_PERMISSIONS);
    expect(fileModeRefusal(0o600, SHEETS)).toBeNull();
    expect(directoryModeRefusal(0o750, SHEETS)).toBe(SheetsRefusal.CREDENTIAL_PERMISSIONS);
    expect(refusalOf(() => parseClientFile({}, SHEETS))).toBe(SheetsRefusal.CREDENTIAL_INVALID);
    expect(parseClientFile(aClientFile(), SHEETS)).toEqual({ clientId: aClientFile().installed.client_id, clientSecret: SENTINEL.clientSecret });
  });

  it('@error no refusal message carries a credential value', () => {
    let refusal = null;
    try {
      parseTokenFile({ ...aSheetsTokenFile({ refreshToken: SHEETS_SENTINEL.refreshToken }), version: 99 }, SHEETS);
    } catch (error) {
      refusal = error;
    }

    expect(refusal?.code).toBe(SheetsRefusal.CREDENTIAL_INVALID);
    expect(refusal.message).not.toContain(SHEETS_SENTINEL.refreshToken);
  });
});
