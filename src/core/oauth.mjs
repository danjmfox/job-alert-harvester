// PURE. OAuth 2.0 loopback + PKCE helpers and the credential-file shape (DR-0011).
// Hashing is injected: core imports no node: builtin.
export const __SCAFFOLD__ = true;

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const TOKEN_FILE_VERSION = 1;

export const AuthRefusal = Object.freeze({
  STATE_MISMATCH: 'auth.state-mismatch',
  CONSENT_DENIED: 'auth.consent-denied',
  NO_CODE: 'auth.no-code',
  NO_REFRESH_TOKEN: 'auth.no-refresh-token',
  EXCHANGE_FAILED: 'auth.exchange-failed',
  CONSENT_TIMEOUT: 'auth.consent-timeout',
});

export const TokenRefusal = Object.freeze({
  REAUTH_REQUIRED: 'gmail.reauth-required',
  TOKEN_ENDPOINT_ERROR: 'gmail.token-endpoint-error',
  SCOPE_MISMATCH: 'gmail.scope-mismatch',
});

export const CredentialRefusal = Object.freeze({
  MISSING: 'gmail.credential-missing',
  INVALID: 'gmail.credential-invalid',
  PERMISSIONS: 'gmail.credential-permissions',
});

const scaffold = (name) => {
  throw new Error(`RED scaffold: ${name} is not implemented`);
};

/** @param {(text: string) => Uint8Array} sha256 @returns {string} base64url, unpadded */
export const pkceChallenge = (_verifier, _sha256) => scaffold('pkceChallenge');

/** @returns {string} the consent URL */
export const buildConsentUrl = (_params) => scaffold('buildConsentUrl');

/** @returns {{ code: string }} or throws an AuthRefusal */
export const parseCallback = (_callbackUrl, _options) => scaffold('parseCallback');

/**
 * @param {{ status: number, body: object|null }} response
 * @param {{ grant: 'refresh_token'|'authorization_code', nowMs: number }} options
 * @returns {{ accessToken: string, refreshToken: string|null, scope: string, expiresAtMs: number }}
 */
export const parseTokenResponse = (_response, _options) => scaffold('parseTokenResponse');

/** Throws TokenRefusal.SCOPE_MISMATCH unless the granted scope is exactly gmail.readonly. */
export const checkGrantedScope = (_scope) => scaffold('checkGrantedScope');

export const isExpired = (_expiresAtMs, _nowMs, _skewMs) => scaffold('isExpired');

/** @param {number} mode permission bits (mode & 0o777) @returns {string|null} a CredentialRefusal or null */
export const fileModeRefusal = (_mode) => scaffold('fileModeRefusal');

export const directoryModeRefusal = (_mode) => scaffold('directoryModeRefusal');

/** @returns {{ clientId: string, clientSecret: string }} or throws CredentialRefusal.INVALID */
export const parseClientFile = (_json) => scaffold('parseClientFile');

export const buildTokenFile = (_fields) => scaffold('buildTokenFile');

/** @returns {{ version: number, refreshToken: string, scope: string, emailAddress: string, obtainedAt: string }} */
export const parseTokenFile = (_json) => scaffold('parseTokenFile');
