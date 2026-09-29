#!/usr/bin/env node
// One-off operator procedure for DESIGN flag 6 (connector vs Gmail API message shape).
//
// Fetches ONE already-cached message through the real Gmail API and compares the
// record toMessage() builds against the cached record, field by field, plus the
// LinkedIn extractJobs output. Exit 0 on parity, 1 on any difference, 2 on misuse.
//
// Needs the operator's credential: run `harvest auth` first.
// NOT run in CI and NOT part of `npm test`: it calls the live Gmail API.
//
// Usage: node scripts/gmail-parity-check.mjs [<message-id>]   (default: first cached message)
// Never prints a credential, token, or the message body; only field verdicts and short diffs.

import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createCredentialStore } from '../src/adapters/credential-store.mjs';
import { createGoogleTokenSource } from '../src/adapters/google-token-source.mjs';
import { resolveEndpoints } from '../src/core/endpoints.mjs';
import { toMessage } from '../src/core/gmail-message.mjs';
import { extractJobs } from '../src/core/parse-linkedin.mjs';
import { linkedin } from '../src/core/sources/linkedin.mjs';

const CACHE_ROOT = '.cache/messages';
const CREDENTIAL_DIRECTORY = ['.config', 'job-alert-harvester'];
const FIELDS = ['sender', 'subject', 'date', 'snippet', 'plaintextBody'];

const cachedFiles = () =>
  readdirSync(CACHE_ROOT, { recursive: true })
    .filter((name) => name.endsWith('.json'))
    .sort();

const readCached = (id) => {
  const file = cachedFiles().find((name) => name.split(/[\\/]/).pop() === `${id}.json`);
  return file ? JSON.parse(readFileSync(join(CACHE_ROOT, file), 'utf8')) : null;
};

const firstCachedId = () => cachedFiles()[0]?.split(/[\\/]/).pop().replace(/\.json$/, '');

const visible = (text) => JSON.stringify(text.length > 80 ? `${text.slice(0, 80)}...` : text);

const firstDifference = (a, b) => {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  return index;
};

const describeDifference = (cached, api) => {
  const at = firstDifference(cached, api);
  const trimmedEqual = cached.trim() === api.trim();
  const whitespaceEqual = cached.replace(/\s+/g, ' ').trim() === api.replace(/\s+/g, ' ').trim();
  const kind = trimmedEqual ? 'edge whitespace only' : whitespaceEqual ? 'internal whitespace/line breaks only' : 'content differs';
  return `${kind}; first difference at index ${at}; cached ${visible(cached.slice(at))} vs api ${visible(api.slice(at))}`;
};

const compareField = (field, cached, api) =>
  cached[field] === api[field] ? { field, same: true } : { field, same: false, detail: describeDifference(String(cached[field]), String(api[field])) };

const jobsOf = (message) => JSON.stringify(linkedin.matches(message) ? extractJobs(message) : null);

const fetchFullResource = async (id) => {
  const endpoints = resolveEndpoints(process.env);
  const store = createCredentialStore({ directory: join(homedir(), ...CREDENTIAL_DIRECTORY) });
  const tokenSource = createGoogleTokenSource({ store, fetch, endpoints, nowMs: Date.now, sleep: (ms) => new Promise((done) => setTimeout(done, ms)), jitter: Math.random });
  const token = await tokenSource.accessToken();
  const response = await fetch(`${endpoints.gmailBase}/users/me/messages/${encodeURIComponent(id)}?format=full`, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Gmail API answered ${response.status} for message ${id}`);
  return response.json();
};

const main = async () => {
  const id = process.argv[2] ?? firstCachedId();
  const cached = id ? readCached(id) : null;
  if (!cached) {
    console.error(`parity: no cached message ${id ?? '(cache empty)'} under ${CACHE_ROOT}`);
    return 2;
  }

  const api = toMessage(await fetchFullResource(id));
  const results = FIELDS.map((field) => compareField(field, cached, api));
  for (const result of results) console.log(`${result.same ? 'same     ' : 'DIFFERENT'} ${result.field}${result.detail ? `: ${result.detail}` : ''}`);

  const jobsSame = jobsOf(cached) === jobsOf(api);
  console.log(`${jobsSame ? 'same     ' : 'DIFFERENT'} extractJobs (linkedin, matches: cached=${linkedin.matches(cached)} api=${linkedin.matches(api)})`);

  const parity = results.every((result) => result.same) && jobsSame;
  console.log(parity ? `parity: ${id} matches` : `parity: ${id} DIFFERS`);
  return parity ? 0 : 1;
};

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`parity: failed (${error.code ?? error.message})`);
    process.exit(2);
  },
);
