// Domain vocabulary for the gmail-api-source acceptance tests (nWave Mandate-12).
//
// Production owns the domain nouns: refusal codes, scope, endpoint override are
// re-exported from src/. This module adds the builders that shape Gmail
// fixtures, the credential home, and the composition of the Gmail adapters.

import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveEndpoints } from '../../../../src/core/endpoints.mjs';
import { createCredentialStore } from '../../../../src/adapters/credential-store.mjs';
import { createGoogleTokenSource } from '../../../../src/adapters/google-token-source.mjs';
import { createGmailApiSource } from '../../../../src/adapters/gmail-api-source.mjs';
import { CredentialRefusal, TokenRefusal, AuthRefusal, GMAIL_READONLY_SCOPE, TOKEN_FILE_VERSION } from '../../../../src/core/oauth.mjs';
import { RetryRefusal, MAX_ATTEMPTS } from '../../../../src/core/retry-policy.mjs';
import { MessageRefusal } from '../../../../src/core/gmail-message.mjs';
import { EndpointRefusal, ENDPOINT_OVERRIDE_ENV } from '../../../../src/core/endpoints.mjs';
import { SourceRefusal } from '../../../../src/adapters/gmail-api-source.mjs';
import { PROJECT_ROOT, CLI, aMessage } from '../../job-alert-harvester/support/domain-types.mjs';

export {
  aWorkspace,
  writeJson,
  writeText,
  aMessage,
  refusalOf,
  fileDigests,
  cachedMessageIds,
  committedCoverage,
  PROJECT_ROOT,
  CLI,
} from '../../job-alert-harvester/support/domain-types.mjs';
export { FetchRefusal } from '../../../../src/cli/fetch-loop.mjs';
export { CredentialRefusal, TokenRefusal, AuthRefusal, GMAIL_READONLY_SCOPE, TOKEN_FILE_VERSION, RetryRefusal, MAX_ATTEMPTS };
export { MessageRefusal, EndpointRefusal, ENDPOINT_OVERRIDE_ENV, SourceRefusal };

/** Every refusal the Gmail source, token source and credential store can name. */
export const GmailRefusal = Object.freeze({
  ...CredentialRefusal,
  ...TokenRefusal,
  ...RetryRefusal,
  ...MessageRefusal,
  ...SourceRefusal,
  ...EndpointRefusal,
});

export const UNKNOWN_SOURCE_REFUSAL = 'fetch.unknown-source';

export const MAILBOX = 'daniel@daedaluscoaching.com';
export const SENDER = 'jobalerts-noreply@linkedin.com';
export const NOW_MS = Date.parse('2026-09-29T10:00:00Z');
export const NOW_ISO = '2026-09-29T10:00:00Z';

/** Recognisable secrets: none may ever appear in output, refusal text, cache or ledger. */
export const SENTINEL = Object.freeze({
  accessToken: 'ya29.SENTINEL-access-token-7f3a',
  accessTokenRefreshed: 'ya29.SENTINEL-access-token-refreshed-1b6c',
  refreshToken: '1//SENTINEL-refresh-token-9c2d',
  refreshTokenRotated: '1//SENTINEL-refresh-token-rotated-5d0a',
  clientSecret: 'GOCSPX-SENTINEL-client-secret-4b1e',
  authCode: '4/SENTINEL-auth-code-2e8f',
});
const SECRET_VALUES = Object.values(SENTINEL);

export const noSecretsIn = (text) => SECRET_VALUES.filter((secret) => String(text).includes(secret));

// ------------------------------------------------------------- credential home

export function aClientFile({ clientSecret = SENTINEL.clientSecret } = {}) {
  return {
    installed: {
      client_id: '1234567890-abcdefghijklmnop.apps.googleusercontent.com',
      project_id: 'job-alert-harvester',
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
      auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
      client_secret: clientSecret,
      redirect_uris: ['http://localhost'],
    },
  };
}

export function aTokenFile({ refreshToken = SENTINEL.refreshToken, emailAddress = MAILBOX, obtainedAt = '2026-09-13T08:00:00Z' } = {}) {
  return { version: TOKEN_FILE_VERSION, refreshToken, scope: GMAIL_READONLY_SCOPE, emailAddress, obtainedAt };
}

const writeMode = (path, content, mode) => {
  writeFileSync(path, content, 'utf8');
  chmodSync(path, mode);
  return path;
};

/**
 * A HOME holding ~/.config/job-alert-harvester as `auth` would have left it.
 * `client`/`token` accept an object, raw text, or null (absent); modes are set explicitly, never by umask.
 */
export function aCredentialHome({
  root,
  client = aClientFile(),
  token = aTokenFile(),
  clientMode = 0o600,
  tokenMode = 0o600,
  directoryMode = 0o700,
} = {}) {
  const home = root ?? join(mkdtempSync(join(tmpdir(), 'gmail-src-')), 'home');
  const directory = join(home, '.config', 'job-alert-harvester');
  mkdirSync(directory, { recursive: true });
  chmodSync(directory, 0o700);
  const clientPath = join(directory, 'client.json');
  const tokenPath = join(directory, 'token.json');
  const asText = (value) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  if (client !== null) writeMode(clientPath, asText(client), clientMode);
  if (token !== null) writeMode(tokenPath, asText(token), tokenMode);
  chmodSync(directory, directoryMode);
  return { home, directory, clientPath, tokenPath };
}

/** `relative/path -> octal mode` for every entry under `root`. Absent root reads as {}. */
export function fileModes(root) {
  const modes = {};
  const walk = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      modes[name] = (statSync(path).mode & 0o777).toString(8);
      if (entry.isDirectory()) walk(path, name);
    }
  };
  try {
    walk(root, '');
  } catch {
    return {};
  }
  return modes;
}

export const readJsonFile = (path) => JSON.parse(readFileSync(path, 'utf8'));

// ------------------------------------------------------------ Gmail fixtures

const REAL_ALERT_DIRECTORIES = ['fixtures/linkedin', 'fixtures/linkedin-variants'];

/** Every real cached alert record committed under fixtures/ (captured, never composed: DR-0007). */
export function realAlertRecords() {
  return REAL_ALERT_DIRECTORIES.flatMap((directory) =>
    readdirSync(join(PROJECT_ROOT, directory))
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => JSON.parse(readFileSync(join(PROJECT_ROOT, directory, name), 'utf8'))),
  );
}

export const realAlertOn = (day) => realAlertRecords().filter((record) => record.date.startsWith(day));

const base64url = (text) => Buffer.from(text, 'utf8').toString('base64url');

const textPart = (partId, mimeType, text) => ({
  partId,
  mimeType,
  filename: '',
  headers: [{ name: 'Content-Type', value: `${mimeType}; charset="UTF-8"` }],
  body: { size: Buffer.byteLength(text), data: base64url(text) },
});

/**
 * A `users.messages.get?format=full` resource carrying `record`. The parts tree
 * is multipart/alternative (text/plain + text/html), optionally nested under
 * `nesting` multipart/mixed levels that also carry an attachment.
 */
export function aGmailResource({
  record,
  fromHeader = `LinkedIn Job Alerts <${record.sender}>`,
  plaintext = true,
  html = true,
  htmlFirst = false,
  nesting = 0,
}) {
  const alternatives = [];
  if (plaintext) alternatives.push(textPart('0', 'text/plain', record.plaintextBody));
  if (html) alternatives.push(textPart('1', 'text/html', `<html><body>${record.subject}</body></html>`));
  if (htmlFirst) alternatives.reverse();

  let payload = { partId: '', mimeType: 'multipart/alternative', filename: '', headers: [], body: { size: 0 }, parts: alternatives };
  for (let level = 0; level < nesting; level += 1) {
    payload = {
      partId: '',
      mimeType: 'multipart/mixed',
      filename: '',
      headers: [],
      body: { size: 0 },
      parts: [{ partId: `a${level}`, mimeType: 'application/pdf', filename: 'brochure.pdf', body: { size: 9, attachmentId: 'ATTACHMENT' } }, payload],
    };
  }
  payload.headers = [
    { name: 'From', value: fromHeader },
    { name: 'To', value: MAILBOX },
    { name: 'Subject', value: record.subject },
    { name: 'Date', value: new Date(Date.parse(record.date)).toUTCString() },
  ];

  return {
    id: record.id,
    threadId: record.id,
    labelIds: ['UNREAD', 'INBOX'],
    snippet: record.snippet,
    sizeEstimate: 75295,
    historyId: '3362946',
    internalDate: String(Date.parse(record.date)),
    payload,
  };
}

/** A synthetic alert (digest body long enough to survive slimming) as Gmail would serve it. */
export const aGmailAlert = ({ id, date, ...rest }) => aGmailResource({ record: aMessage({ id, date }), ...rest });

/** The record the cache must hold for that alert. */
export const cachedRecordOf = ({ id, date }) => aMessage({ id, date });

// ------------------------------------------------------------- composition

/** The Gmail adapters wired as the composition root wires them, over a fake at the HTTP boundary. */
export function aGmailSource({ fake, home = aCredentialHome(), sender = SENDER, jitter = () => 0.5, endpoints = resolveEndpoints({}) }) {
  const sleeps = [];
  const sleep = async (milliseconds) => {
    sleeps.push(milliseconds);
  };
  const store = createCredentialStore({ directory: home.directory });
  const tokenSource = createGoogleTokenSource({ store, fetch: (url, init) => fake.handle(url, init), endpoints, nowMs: () => NOW_MS, sleep, jitter });
  const get = (url, init = {}) => fake.handle(url, { ...init, method: 'GET' });
  const source = createGmailApiSource({ store, tokenSource, get, endpoints, sender, sleep, jitter });
  return { source, store, tokenSource, sleeps, home, fake, endpoints };
}

// ------------------------------------------------------------------- running

/** The real command-line entry point with an environment; never throws on a non-zero exit. */
export function runHarvestWith(args, { cwd, env = {} }) {
  const result = spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** As runHarvestWith, but asynchronous so an in-process fake can answer while the CLI runs. `onLine` sees each stdout line. */
export function runHarvestAsync(args, { cwd, env = {}, onLine, timeoutMs = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI, ...args], { cwd, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    let pending = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      pending += chunk;
      let newline = pending.indexOf('\n');
      while (newline >= 0) {
        onLine?.(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

/** The named refusal an async action rejected with, or null if it resolved. An unnamed error is a defect, not a refusal, and escapes. */
export async function refusalOfAsync(action) {
  try {
    await action();
  } catch (error) {
    if (typeof error.code !== 'string' || !/^[a-z]+\.[a-z-]+$/.test(error.code)) throw error;
    return { code: error.code, message: error.message };
  }
  return null;
}

// ---------------------------------------------------------------- observables

export const coverageSummary = (intervals) =>
  intervals.map(({ source, from, to, messageCount }) => ({ source, from, to, messageCount }));

export const cachedRecord = (workspace, id, month) =>
  JSON.parse(readFileSync(join(workspace, '.cache/messages', month, `${id}.json`), 'utf8'));

const pad = (value) => String(value).padStart(2, '0');
export const utcDay = (offsetDays = 0) => {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};
