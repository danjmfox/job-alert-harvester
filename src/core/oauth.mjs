// PURE. OAuth 2.0 loopback + PKCE helpers and the credential-file shape (DR-0011).
// Hashing is injected: core imports no node: builtin.
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

const GROUP_AND_OTHER_BITS = 0o077;
const CREDENTIAL_DIRECTORY_MODE = 0o700;

// Refusal messages name the refusal only: no credential value may reach an error.
const refuse = (code) => {
  throw Object.assign(new Error(code), { code });
};

const isNonEmptyString = (value) => typeof value === 'string' && value !== '';

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export const toBase64Url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

/** @param {(text: string) => Uint8Array} sha256 @returns {string} base64url, unpadded */
export const pkceChallenge = (verifier, sha256) => toBase64Url(sha256(verifier));

/** @returns {string} the application/x-www-form-urlencoded body for a token-endpoint request */
export const encodeForm = (form) => new URLSearchParams(form).toString();

export const authorizationCodeForm = ({ client, code, verifier, redirectUri }) => ({
  grant_type: 'authorization_code',
  code,
  code_verifier: verifier,
  redirect_uri: redirectUri,
  client_id: client.clientId,
  client_secret: client.clientSecret,
});

export const refreshTokenForm = ({ client, refreshToken }) => ({
  grant_type: 'refresh_token',
  refresh_token: refreshToken,
  client_id: client.clientId,
  client_secret: client.clientSecret,
});

/** @returns {string} the consent URL */
export const buildConsentUrl = ({ authUri, clientId, redirectUri, state, codeChallenge }) => {
  const url = new URL(authUri);
  const query = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: GMAIL_READONLY_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  };
  Object.entries(query).forEach(([name, value]) => url.searchParams.set(name, value));
  return url.toString();
};

/** @returns {{ code: string }} or throws an AuthRefusal */
export const parseCallback = (callbackUrl, { expectedState }) => {
  const params = new URL(callbackUrl).searchParams;
  if (params.get('state') !== expectedState) return refuse(AuthRefusal.STATE_MISMATCH);
  if (params.has('error')) return refuse(AuthRefusal.CONSENT_DENIED);
  const code = params.get('code');
  return isNonEmptyString(code) ? { code } : refuse(AuthRefusal.NO_CODE);
};

/** Throws TokenRefusal.SCOPE_MISMATCH unless the granted scope is exactly gmail.readonly. */
export const checkGrantedScope = (scope) => {
  const granted = typeof scope === 'string' ? new Set(scope.split(/\s+/).filter(Boolean)) : new Set();
  return granted.size === 1 && granted.has(GMAIL_READONLY_SCOPE) ? undefined : refuse(TokenRefusal.SCOPE_MISMATCH);
};

const failureRefusal = ({ status, body }, grant) => {
  if (grant === 'authorization_code') return AuthRefusal.EXCHANGE_FAILED;
  return status === 400 && body?.error === 'invalid_grant' ? TokenRefusal.REAUTH_REQUIRED : TokenRefusal.TOKEN_ENDPOINT_ERROR;
};

const malformedRefusal = (grant) =>
  grant === 'authorization_code' ? AuthRefusal.EXCHANGE_FAILED : TokenRefusal.TOKEN_ENDPOINT_ERROR;

const isUsableSuccess = ({ status, body }) =>
  status === 200 && isPlainObject(body) && isNonEmptyString(body.access_token) && Number.isFinite(body.expires_in);

/**
 * @param {{ status: number, body: object|null }} response
 * @param {{ grant: 'refresh_token'|'authorization_code', nowMs: number }} options
 * @returns {{ accessToken: string, refreshToken: string|null, scope: string, expiresAtMs: number }}
 */
export const parseTokenResponse = (response, { grant, nowMs }) => {
  if (response.status !== 200) return refuse(failureRefusal(response, grant));
  if (!isUsableSuccess(response)) return refuse(malformedRefusal(grant));
  const { body } = response;
  checkGrantedScope(body.scope);
  const refreshToken = isNonEmptyString(body.refresh_token) ? body.refresh_token : null;
  if (grant === 'authorization_code' && refreshToken === null) return refuse(AuthRefusal.NO_REFRESH_TOKEN);
  return { accessToken: body.access_token, refreshToken, scope: body.scope, expiresAtMs: nowMs + body.expires_in * 1000 };
};

export const isExpired = (expiresAtMs, nowMs, skewMs) => nowMs + skewMs >= expiresAtMs;

/** @param {number} mode permission bits (mode & 0o777) @returns {string|null} a CredentialRefusal or null */
export const fileModeRefusal = (mode) => ((mode & GROUP_AND_OTHER_BITS) === 0 ? null : CredentialRefusal.PERMISSIONS);

export const directoryModeRefusal = (mode) => (mode === CREDENTIAL_DIRECTORY_MODE ? null : CredentialRefusal.PERMISSIONS);

/** @returns {{ clientId: string, clientSecret: string }} or throws CredentialRefusal.INVALID */
export const parseClientFile = (json) => {
  const installed = isPlainObject(json) ? json.installed : undefined;
  if (!isPlainObject(installed) || !isNonEmptyString(installed.client_id) || !isNonEmptyString(installed.client_secret)) {
    return refuse(CredentialRefusal.INVALID);
  }
  return { clientId: installed.client_id, clientSecret: installed.client_secret };
};

export const buildTokenFile = ({ refreshToken, scope, emailAddress, obtainedAt }) => ({
  version: TOKEN_FILE_VERSION,
  refreshToken,
  scope,
  emailAddress,
  obtainedAt,
});

/** @returns {{ version: number, refreshToken: string, scope: string, emailAddress: string, obtainedAt: string }} */
export const parseTokenFile = (json) => {
  const isValid =
    isPlainObject(json) &&
    json.version === TOKEN_FILE_VERSION &&
    [json.refreshToken, json.scope, json.emailAddress, json.obtainedAt].every(isNonEmptyString);
  return isValid ? buildTokenFile(json) : refuse(CredentialRefusal.INVALID);
};
