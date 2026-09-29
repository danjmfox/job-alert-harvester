#!/usr/bin/env node
// Operator-run live verification of the Sheets target's API assumptions A1-A19 and Fake Fidelity Ledger L01-L20.
//
// Consents with drive.file only, imports a SYNTHETIC workbook as a scratch native Sheet, probes each assumption,
// saves redacted REAL response bodies to docs/feature/sheets-api-target/deliver/live-fixtures.json, deletes the
// scratch Sheet (only the id it created) in a finally, and prints a paste-back results table.
//
// NOT part of `npm test`: it calls the live Google APIs. It never reads the operator's tracker or .cache/, and
// never prints a token, code, verifier, client secret or Authorization header.
//
// Usage: node scripts/sheets-live-check.mjs              (live; see docs/feature/sheets-api-target/deliver/live-check-runbook.md)
//        node scripts/sheets-live-check.mjs --self-test  (offline, against the loopback fake)

import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as XLSX from 'xlsx';
import { createOAuthLoopback } from '../src/adapters/oauth-loopback.mjs';
import { ENDPOINT_OVERRIDE_ENV, resolveEndpoints } from '../src/core/endpoints.mjs';
import { authorizationCodeForm, buildConsentUrl, encodeForm, parseCallback, parseClientFile, pkceChallenge, refreshTokenForm, toBase64Url } from '../src/core/oauth.mjs';
import { DRIVE_FILE_SCOPE } from '../src/core/scope-profiles.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIRECTORY = join(homedir(), '.config', 'job-alert-harvester');
const CLIENT_PATH = join(CONFIG_DIRECTORY, 'client.json');
const TOKEN_SLOT_PATH = join(CONFIG_DIRECTORY, 'sheets-live-check-token.json');
const FIXTURES_PATH = join(HERE, '..', 'docs', 'feature', 'sheets-api-target', 'deliver', 'live-fixtures.json');

const NATIVE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ROW_KEY = 'harvester.row-key';
const PUBLIC_UNGRANTED_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const TRACKER_ROWS = 3000;
const METADATA_CHUNK = 500;
const BURST_WRITES = 100;
const CONSENT_TIMEOUT_MS = 5 * 60 * 1000;
const SCRATCH_ID = 7001;
const BULK_ID = 7002;
const TIGHT_ID = 7003;
const NO_SUCH_SHEET_ID = 999999;

const VERDICT = Object.freeze({ WORKS: 'WORKS', BROKEN: "DOESN'T WORK", UNTESTED: 'NOT TESTED' });

const ASSUMPTION_IDS = Array.from({ length: 19 }, (_, index) => `A${index + 1}`);
const LEDGER_IDS = Array.from({ length: 20 }, (_, index) => `L${String(index + 1).padStart(2, '0')}`);
const LEDGER_SOURCES = Object.freeze({
  L01: ['A1'], L02: ['A2'], L03: ['A3'], L04: ['A4', 'A9'], L05: ['A5'], L06: ['A6'], L07: ['A7'], L08: ['A8'], L09: ['A10'], L10: ['A11'],
  L11: ['A12'], L12: ['A13'], L13: ['A14'], L14: ['A15'], L15: ['A16'], L16: ['A17'], L17: ['A18'], L18: ['A19'], L19: [], L20: [],
});
const REQUIRED_FIXTURES = ['drive.files.create', 'spreadsheets.get', 'values.batchGet', 'developerMetadata.search', 'batchUpdate.ok', 'batchUpdate.invalid'];

// ------------------------------------------------------------------------------------------------ pure: redaction

const ID_KEYS = new Set(['spreadsheetId', 'id', 'ids', 'fileId', 'metadataId', 'spreadsheetUrl', 'emailAddress', 'permissionId', 'driveId', 'webViewLink', 'clientId']);
const hasDigit = (text) => /\d/.test(text);
const MASK_PATTERNS = [
  [/ya29\.[\w.-]+/g, '<TOKEN>'],
  [/1\/\/[\w.-]+/g, '<TOKEN>'],
  [/\b4\/[\w.-]{10,}/g, '<CODE>'],
  [/GOCSPX-[\w-]+/g, '<SECRET>'],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<EMAIL>'],
  [/https?:\/\/[^\s"'<>)]*/g, (url) => (/\/d\/|[A-Za-z0-9_-]{20,}|project=/.test(url) ? '<URL>' : url)],
  [/\b\d{9,}\b/g, '<NUM>'],
  [/[A-Za-z0-9_-]{20,}/g, (run) => (hasDigit(run) ? '<ID>' : run)],
];

/** @param {string[]} secrets literal values to blank wherever they occur, before the pattern masks run */
export const redactText = (text, secrets = []) => {
  const literal = secrets.filter((secret) => typeof secret === 'string' && secret.length >= 6).sort((a, b) => b.length - a.length);
  const blanked = literal.reduce((acc, secret) => acc.split(secret).join('<REDACTED>'), String(text));
  return MASK_PATTERNS.reduce((acc, [pattern, mask]) => acc.replace(pattern, mask), blanked);
};

const maskAll = (value) => (Array.isArray(value) ? value.map(() => '<ID>') : '<ID>');

export const redactDeep = (value, secrets = []) => {
  if (typeof value === 'string') return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, secrets));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, ID_KEYS.has(key) ? maskAll(item) : redactDeep(item, secrets)]));
  }
  return value;
};

const shrink = (value) => {
  if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 200)}<...${value.length - 200} more chars>` : value;
  if (Array.isArray(value)) return value.length > 5 ? [...value.slice(0, 3).map(shrink), `<...${value.length - 3} more items>`] : value.map(shrink);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shrink(item)]));
  return value;
};

// ------------------------------------------------------------------------------------------------ pure: verdicts

const joinNotes = (...parts) => parts.filter(Boolean).join('; ');

/** @param {{ label: string, ok: boolean, detail?: string }[]} checks */
export const judge = (checks, extra = '') => {
  const failed = checks.filter((check) => !check.ok);
  return failed.length === 0
    ? { verdict: VERDICT.WORKS, note: joinNotes(`${checks.length} checks held`, extra) }
    : { verdict: VERDICT.BROKEN, note: joinNotes(`failed: ${failed.map((check) => (check.detail ? `${check.label} (${check.detail})` : check.label)).join(', ')}`, extra) };
};

const untested = (note) => ({ verdict: VERDICT.UNTESTED, note });

const worst = (verdicts) => (verdicts.includes(VERDICT.BROKEN) ? VERDICT.BROKEN : verdicts.includes(VERDICT.UNTESTED) ? VERDICT.UNTESTED : VERDICT.WORKS);

const rollUp = (outcomes, emptyNote) =>
  outcomes.length === 0
    ? untested(emptyNote)
    : { verdict: worst(outcomes.map((outcome) => outcome.verdict)), note: outcomes.map((outcome) => outcome.note).filter(Boolean).join(' | ') };

const outcomesFor = (results, id) => results.filter((result) => result.id === id);

const fixtureCompleteness = (fixtures) => {
  const missing = REQUIRED_FIXTURES.filter((name) => fixtures[name] === undefined);
  return missing.length === 0
    ? { verdict: VERDICT.WORKS, note: `real bodies captured for ${REQUIRED_FIXTURES.length} required shapes; compare them to the fake before trusting its detail` }
    : untested(`no captured body for: ${missing.join(', ')}`);
};

export const resultRows = (results, fixtures) => [
  ...ASSUMPTION_IDS.map((id) => ({ id, ...rollUp(outcomesFor(results, id), 'no probe result') })),
  ...LEDGER_IDS.map((id) => {
    if (id === 'L19') return { id, ...fixtureCompleteness(fixtures) };
    const sources = id === 'L20' ? [rollUp(outcomesFor(results, 'L20'), 'no probe result')] : LEDGER_SOURCES[id].map((source) => rollUp(outcomesFor(results, source), 'no probe result'));
    return { id, verdict: worst(sources.map((source) => source.verdict)), note: sources.map((source) => source.note).join(' | ') };
  }),
];

const tableCell = (text) => String(text ?? '').replace(/\s+/g, ' ').replaceAll('|', '/').slice(0, 160);

export const renderTable = (rows, secrets = []) =>
  ['| id | verdict | evidence |', '|----|---------|----------|', ...rows.map((row) => `| ${row.id} | ${row.verdict} | ${redactText(tableCell(row.note), secrets)} |`)].join('\n');

/** @returns {string|null} what the operator must change when Google answers 403 for a reason a setting explains */
export const diagnose = ({ status, body }, api) => {
  const text = JSON.stringify(body ?? {});
  if (status !== 403) return null;
  if (/SERVICE_DISABLED|accessNotConfigured|has not been used in project|is disabled/i.test(text)) return `enable the Google ${api} API in the GCP project (403 SERVICE_DISABLED)`;
  if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions|insufficient authentication scopes/i.test(text)) return 'drive.file is missing from the consent screen (or was not granted)';
  return null;
};

const basesFor = (endpoints, env) => {
  const override = env[ENDPOINT_OVERRIDE_ENV];
  if (override === undefined || override === '') {
    return { sheets: 'https://sheets.googleapis.com/v4/spreadsheets', drive: 'https://www.googleapis.com/drive/v3', upload: 'https://www.googleapis.com/upload/drive/v3', gmail: endpoints.gmailBase };
  }
  const origin = endpoints.tokenEndpoint.slice(0, -'/token'.length);
  return { sheets: `${origin}/v4/spreadsheets`, drive: `${origin}/drive/v3`, upload: `${origin}/upload/drive/v3`, gmail: endpoints.gmailBase };
};

// ------------------------------------------------------------------------------------------------ pure: synthetic data and request shapes

const DATE_SERIAL = Math.round((Date.UTC(2026, 0, 15) - Date.UTC(1899, 11, 30)) / 86_400_000);
const dateCell = { t: 'n', v: DATE_SERIAL, z: 'yyyy-mm-dd' };
const JOBS_HEADER = ['Dedup Key', 'Company', 'Title', 'Status', 'Score', 'Applied', 'Date Added', 'Notes'];
const JOBS_ROWS = [
  ['k-001', 'Acme', 'Engineer', 'New', 3.5, true, dateCell, 'note-1'],
  ['k-002', 'Beta', 'Analyst', null, 7, false, dateCell, null],
  ['k-003', 'Gamma', 'Designer', 'Applied', 0, true, dateCell, 'note-3'],
  ['k-004', 'Delta', 'Writer', 'New', 1, false, dateCell, 'note-4'],
  ['k-005', 'Epsilon', 'Editor', 'New', 2, true, dateCell, 'note-5'],
];
const COMPANIES_ROWS = [['Acme', 'acme.example', 'A'], ['Beta', 'beta.example', 'B'], ['Gamma', 'gamma.example', 'A']];
const SOURCES_ROWS = [['linkedin', 'engineer', '2026-01-15'], ['linkedin', 'analyst', '2026-01-15']];

const syntheticWorkbook = () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([JOBS_HEADER, ...JOBS_ROWS]), 'Jobs');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Company', 'Website', 'Tier'], ...COMPANIES_ROWS]), 'Companies');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Source', 'Search Term', 'Last Run'], ...SOURCES_ROWS]), 'Sources');
  return Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
};

const multipartBody = ({ metadata, content, contentType, boundary }) =>
  Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

const textCell = (text) => ({ userEnteredValue: { stringValue: text } });
const writeCells = (sheetId, rowIndex, columnIndex, values, fields = 'userEnteredValue') => ({ updateCells: { start: { sheetId, rowIndex, columnIndex }, rows: [{ values }], fields } });
const writeText = (sheetId, rowIndex, columnIndex, text) => writeCells(sheetId, rowIndex, columnIndex, [textCell(text)]);
const bindKey = (sheetId, rowIndex, key, value, visibility = 'DOCUMENT') => ({
  createDeveloperMetadata: { developerMetadata: { metadataKey: key, metadataValue: value, location: { dimensionRange: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 } }, visibility } },
});
const addTab = (title, sheetId, rowCount, columnCount) => ({ addSheet: { properties: { title, sheetId, gridProperties: { rowCount, columnCount } } } });
const rowKeyLookup = (value) => ({ developerMetadataLookup: { metadataKey: ROW_KEY, ...(value === undefined ? {} : { metadataValue: value, locationType: 'ROW' }) } });

const bulkRows = (rowCount, columnCount) =>
  Array.from({ length: rowCount }, (_, row) => ({ values: Array.from({ length: columnCount }, (_, column) => textCell(`r${row}c${column}-${'x'.repeat(30)}`)) }));

const megabytes = (bytes) => `${(bytes / 1_048_576).toFixed(1)} MB`;

// ------------------------------------------------------------------------------------------------ I/O: credentials

const refuse = (code, message = code) => {
  throw Object.assign(new Error(message), { code });
};

const parseJson = (text) => {
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const sha256 = (text) => createHash('sha256').update(text).digest();

const readJsonFile = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

const readClient = (clientPath) => {
  const file = readJsonFile(clientPath);
  if (file === null) return refuse('live.client-file-missing', `no OAuth client file at ${clientPath}: run \`harvest auth\` setup first (DR-0011)`);
  return parseClientFile(file);
};

const writeSlot = (slotPath, refreshToken, now) => {
  mkdirSync(dirname(slotPath), { recursive: true, mode: 0o700 });
  writeFileSync(slotPath, `${JSON.stringify({ version: 1, refreshToken, scope: DRIVE_FILE_SCOPE, obtainedAt: now().toISOString() })}\n`, { mode: 0o600 });
  chmodSync(slotPath, 0o600);
};

const postForm = async (fetch, url, form) => {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: encodeForm(form) });
  return { status: response.status, body: parseJson(await response.text()) };
};

const createTokens = ({ fetch, endpoints, client, refreshToken, accessToken = null }) => {
  const state = { access: accessToken };
  const refresh = async () => {
    const { status, body } = await postForm(fetch, endpoints.tokenEndpoint, refreshTokenForm({ client, refreshToken }));
    if (status !== 200 || typeof body?.access_token !== 'string') return refuse(body?.error === 'invalid_grant' ? 'live.reauth-required' : 'live.token-endpoint-error');
    state.access = body.access_token;
    return state.access;
  };
  return { accessToken: async () => state.access ?? refresh(), refresh, current: () => state.access, refreshToken: () => refreshToken };
};

const checkGranted = (scope) => {
  const granted = typeof scope === 'string' ? scope.split(/\s+/).filter(Boolean) : [];
  if (!granted.includes(DRIVE_FILE_SCOPE)) refuse('live.scope-missing', `drive.file is missing from the consent screen: add ${DRIVE_FILE_SCOPE} under Data Access, then run again`);
  if (granted.length !== 1) refuse('live.scope-too-broad', 'the grant carries more than drive.file: remove the other scopes from the consent screen and run again');
};

const consent = async ({ fetch, endpoints, client, loopback, print, printConsent }) => {
  const verifier = toBase64Url(randomBytes(32));
  const state = toBase64Url(randomBytes(16));
  const listener = await loopback.listen();
  try {
    const url = new URL(buildConsentUrl({ authUri: endpoints.authUri, clientId: client.clientId, redirectUri: listener.redirectUri, state, codeChallenge: pkceChallenge(verifier, sha256) }));
    url.searchParams.set('scope', DRIVE_FILE_SCOPE);
    print('Open this URL in a browser and approve drive.file access:');
    printConsent(url.toString());
    const { code } = parseCallback(await listener.awaitCallback(), { expectedState: state });
    const { status, body } = await postForm(fetch, endpoints.tokenEndpoint, authorizationCodeForm({ client, code, verifier, redirectUri: listener.redirectUri }));
    if (status !== 200 || typeof body?.access_token !== 'string') return refuse('live.exchange-failed');
    checkGranted(body.scope);
    if (typeof body.refresh_token !== 'string') return refuse('live.no-refresh-token');
    return { accessToken: body.access_token, refreshToken: body.refresh_token };
  } finally {
    listener.close();
  }
};

const acquireTokens = async (deps) => {
  const { fetch, endpoints, client, slotPath, print, now } = deps;
  const stored = readJsonFile(slotPath);
  if (typeof stored?.refreshToken === 'string') {
    const reused = createTokens({ fetch, endpoints, client, refreshToken: stored.refreshToken });
    try {
      await reused.refresh();
      return reused;
    } catch (error) {
      if (error.code !== 'live.reauth-required') throw error;
      print('stored throwaway token was rejected; consenting again');
    }
  }
  const granted = await consent(deps);
  writeSlot(slotPath, granted.refreshToken, now);
  return createTokens({ fetch, endpoints, client, refreshToken: granted.refreshToken, accessToken: granted.accessToken });
};

// ------------------------------------------------------------------------------------------------ I/O: http and context

const createHttp = ({ fetch, tokens, say }) => {
  const hinted = new Set();
  const send = async (url, { method = 'GET', query = {}, json, body, headers = {}, api = 'Sheets', hints = true } = {}) => {
    const target = new URL(url);
    for (const [name, value] of Object.entries(query)) for (const item of [].concat(value)) target.searchParams.append(name, item);
    const payload = json === undefined ? body : JSON.stringify(json);
    const attempt = async () =>
      fetch(target, { method, headers: { authorization: `Bearer ${await tokens.accessToken()}`, ...(json === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body: payload });
    let response = await attempt();
    if (response.status === 401) {
      await tokens.refresh();
      response = await attempt();
    }
    const result = { status: response.status, ok: response.ok, body: parseJson(await response.text()), retryAfter: response.headers.get('retry-after'), sentBytes: payload === undefined ? 0 : Buffer.byteLength(payload) };
    const hint = hints ? diagnose(result, api) : null;
    if (hint !== null && !hinted.has(hint)) {
      hinted.add(hint);
      say(`HINT: ${hint}`);
    }
    return result;
  };
  return { send };
};

const unwrap = (response, label) => {
  if (!response.ok) refuse(`${label}: HTTP ${response.status}`);
  return response.body;
};

const createContext = ({ http, bases, say, trackerRows, scratch }) => {
  const fixtures = {};
  const flags = { captured429: false };
  const tabs = {};
  const sheetsUrl = (suffix) => `${bases.sheets}/${encodeURIComponent(scratch.id)}${suffix}`;
  const sheets = (method, suffix, options) => http.send(sheetsUrl(suffix), { method, ...options });
  return {
    say, trackerRows, flags, fixtures, tabs,
    sheets,
    drive: (method, path, options) => http.send(`${bases.drive}${path}`, { method, api: 'Drive', ...options }),
    gmail: (method, path, options) => http.send(`${bases.gmail}${path}`, { method, api: 'Gmail', hints: false, ...options }),
    otherSheets: (id) => http.send(`${bases.sheets}/${encodeURIComponent(id)}`, {}),
    scratchId: () => scratch.id,
    capture: (name, response, request) => {
      if (fixtures[name] !== undefined) return;
      fixtures[name] = { request, status: response.status, ...(response.retryAfter === null ? {} : { retryAfter: response.retryAfter }), body: shrink(redactDeep(response.body, [scratch.id])) };
    },
    batch: (requests) => sheets('POST', ':batchUpdate', { json: { requests } }),
    values: (ranges, params = {}) => sheets('GET', '/values:batchGet', { query: { ranges, majorDimension: 'ROWS', valueRenderOption: 'UNFORMATTED_VALUE', ...params } }),
    search: async (lookup) => {
      const response = await sheets('POST', '/developerMetadata:search', { json: { dataFilters: [lookup] } });
      return { response, found: (response.body?.matchedDeveloperMetadata ?? []).map((match) => match.developerMetadata) };
    },
    refreshTabs: async () => {
      const response = await sheets('GET', '', { query: { fields: 'sheets.properties' } });
      Object.keys(tabs).forEach((title) => delete tabs[title]);
      for (const sheet of unwrap(response, 'read tabs').sheets ?? []) tabs[sheet.properties.title] = sheet.properties;
      return tabs;
    },
    tab: (title) => tabs[title] ?? refuse(`tab ${title} is not in the Sheet`),
  };
};

const grid = async (ctx, range) => unwrap(await ctx.values([range]), `read ${range.split('!')[0]}`).valueRanges?.[0]?.values ?? [];

// ------------------------------------------------------------------------------------------------ probes

const statusOf = (response) => `HTTP ${response.status}`;

async function probeCallerSheetId(ctx) {
  const added = await ctx.batch([addTab('Scratch', SCRATCH_ID, 100, 30)]);
  ctx.capture('batchUpdate.ok', added, 'POST spreadsheets/{id}:batchUpdate (addSheet)');
  const duplicateTitle = await ctx.batch([addTab('Scratch', SCRATCH_ID + 10, 10, 10)]);
  const duplicateId = await ctx.batch([addTab('Scratch duplicate', SCRATCH_ID, 10, 10)]);
  const others = await ctx.batch([addTab('Tight', TIGHT_ID, 3, 3), addTab('Bulk', BULK_ID, ctx.trackerRows * 2 + 50, 20)]);
  const tabs = await ctx.refreshTabs();
  return judge([
    { label: 'addSheet with a caller sheetId accepted and honoured', ok: added.ok && tabs.Scratch?.sheetId === SCRATCH_ID, detail: statusOf(added) },
    { label: 'duplicate title rejected', ok: duplicateTitle.status === 400, detail: statusOf(duplicateTitle) },
    { label: 'duplicate sheetId rejected', ok: duplicateId.status === 400, detail: statusOf(duplicateId) },
    { label: 'the Tight and Bulk tabs were added', ok: others.ok && tabs.Tight !== undefined && tabs.Bulk !== undefined, detail: statusOf(others) },
  ]);
}

async function probeTypedReadback(ctx) {
  const response = await ctx.values([`Jobs!A1:H${JOBS_ROWS.length + 1}`]);
  ctx.capture('values.batchGet', response, 'GET spreadsheets/{id}/values:batchGet (UNFORMATTED_VALUE)');
  const rows = unwrap(response, 'read Jobs').valueRanges?.[0]?.values ?? [];
  const at = (row, column) => rows[row]?.[column] ?? '';
  return {
    A1: judge([
      { label: 'a decimal reads as a number', ok: at(1, 4) === 3.5 },
      { label: 'zero reads as a number', ok: at(3, 4) === 0 },
      { label: 'true reads as a boolean', ok: at(1, 5) === true },
      { label: 'false reads as a boolean', ok: at(2, 5) === false },
      { label: 'text reads as text', ok: at(1, 1) === 'Acme' },
      { label: 'an interior blank reads as an empty string', ok: rows[2]?.[3] === '' },
    ]),
    A2: judge([{ label: 'a converted date reads back as its serial number', ok: at(1, 6) === DATE_SERIAL, detail: `got a ${typeof at(1, 6)}` }]),
  };
}

async function probeBatchAtomicity(ctx) {
  const jobs = ctx.tab('Jobs');
  const companies = ctx.tab('Companies');
  const marker = 'a3-marker';
  const invalid = await ctx.batch([writeText(jobs.sheetId, 5, 7, marker), writeText(companies.sheetId, 3, 2, marker), writeText(NO_SUCH_SHEET_ID, 0, 0, marker)]);
  ctx.capture('batchUpdate.invalid', invalid, 'POST spreadsheets/{id}:batchUpdate (one invalid request among valid ones on two tabs)');
  const after = await ctx.values(['Jobs!H6', 'Companies!C4']);
  const applied = (after.body?.valueRanges ?? []).some((range) => range.values?.[0]?.[0] === marker);
  return judge([
    { label: 'the batch with one invalid request is rejected', ok: invalid.status === 400, detail: statusOf(invalid) },
    { label: 'neither tab kept a request of the rejected batch', ok: after.ok && !applied },
  ]);
}

async function probeCellDataFilter(ctx) {
  const { sheetId } = ctx.tab('Scratch');
  const filter = rowKeyLookup();
  const refused = await ctx.batch([
    { updateCells: { start: { sheetId, rowIndex: 3, columnIndex: 0 }, rows: [{ values: [{ ...textCell('a5'), dataFilter: filter }] }], fields: 'userEnteredValue', dataFilter: filter } },
  ]);
  const written = await grid(ctx, 'Scratch!A4');
  return judge([
    { label: 'updateCells carrying a data filter is rejected', ok: refused.status === 400, detail: statusOf(refused) },
    { label: 'nothing was written', ok: written.length === 0 },
  ]);
}

async function probeAppendDimension(ctx) {
  const { sheetId, gridProperties } = ctx.tab('Scratch');
  const beyond = gridProperties.columnCount;
  const refused = await ctx.batch([writeText(sheetId, 0, beyond, 'a7')]);
  const grown = await ctx.batch([{ appendDimension: { sheetId, dimension: 'COLUMNS', length: 5 } }]);
  const accepted = await ctx.batch([writeText(sheetId, 0, beyond, 'a7')]);
  const tabs = await ctx.refreshTabs();
  return judge([
    { label: 'a write beyond the grid columns is refused', ok: refused.status === 400, detail: statusOf(refused) },
    { label: 'appendDimension COLUMNS makes room', ok: grown.ok && tabs.Scratch.gridProperties.columnCount === beyond + 5, detail: statusOf(grown) },
    { label: 'the same write then succeeds', ok: accepted.ok, detail: statusOf(accepted) },
  ]);
}

async function readFormat(ctx, a1) {
  const response = await ctx.sheets('GET', '', { query: { ranges: `Scratch!${a1}`, includeGridData: 'true', fields: 'sheets.data.rowData.values(userEnteredValue,userEnteredFormat.textFormat.bold)' } });
  const cell = response.body?.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0];
  return { response, cell };
}

async function probeFieldMask(ctx) {
  const { sheetId } = ctx.tab('Scratch');
  const bold = { userEnteredFormat: { textFormat: { bold: true } } };
  const styled = await ctx.batch([writeCells(sheetId, 5, 0, [{ ...textCell('before'), ...bold }], 'userEnteredValue,userEnteredFormat')]);
  const kept = await ctx.batch([writeCells(sheetId, 5, 0, [textCell('after')])]);
  const afterKeep = await readFormat(ctx, 'A6');
  if (afterKeep.cell === undefined) return untested(`formatting is not readable through spreadsheets.get gridData (${statusOf(afterKeep.response)})`);
  const reset = await ctx.batch([writeCells(sheetId, 5, 0, [textCell('reset')], '*')]);
  const afterReset = await readFormat(ctx, 'A6');
  return judge([
    { label: 'a bold cell was written', ok: styled.ok, detail: statusOf(styled) },
    { label: 'fields=userEnteredValue changed the value', ok: kept.ok && afterKeep.cell.userEnteredValue?.stringValue === 'after' },
    { label: 'fields=userEnteredValue kept the formatting', ok: afterKeep.cell.userEnteredFormat?.textFormat?.bold === true },
    { label: "fields='*' resets the formatting", ok: reset.ok && afterReset.cell?.userEnteredFormat?.textFormat?.bold !== true },
  ]);
}

async function probeAppendPosition(ctx) {
  const scratch = ctx.tab('Scratch');
  const tight = ctx.tab('Tight');
  const seeded = await ctx.batch([writeText(scratch.sheetId, 0, 9, 'top'), writeText(scratch.sheetId, 10, 9, 'gap')]);
  const appended = await ctx.batch([{ appendCells: { sheetId: scratch.sheetId, rows: [{ values: [textCell('appended')] }], fields: 'userEnteredValue' } }]);
  const landed = await grid(ctx, 'Scratch!A12');
  const filled = await ctx.batch([{ updateCells: { start: { sheetId: tight.sheetId, rowIndex: 0, columnIndex: 0 }, rows: ['t0', 't1', 't2'].map((text) => ({ values: [textCell(text)] })), fields: 'userEnteredValue' } }]);
  const grew = await ctx.batch([{ appendCells: { sheetId: tight.sheetId, rows: [{ values: [textCell('t3')] }], fields: 'userEnteredValue' } }]);
  const tabs = await ctx.refreshTabs();
  const tightRow = await grid(ctx, 'Tight!A4');
  return judge([
    { label: 'the seed rows were written', ok: seeded.ok && filled.ok },
    { label: 'appendCells lands after the last row holding data, past a gap', ok: appended.ok && landed[0]?.[0] === 'appended', detail: statusOf(appended) },
    { label: 'appendCells on a full grid grows the rows', ok: grew.ok && tabs.Tight.gridProperties.rowCount > 3 && tightRow[0]?.[0] === 't3', detail: statusOf(grew) },
  ]);
}

async function probeLeadingEquals(ctx) {
  const { sheetId } = ctx.tab('Scratch');
  const written = await ctx.batch([writeText(sheetId, 20, 0, '=1+1')]);
  const back = await grid(ctx, 'Scratch!A21');
  return judge([
    { label: 'the write was accepted', ok: written.ok, detail: statusOf(written) },
    { label: 'a leading = string reads back as the same text, not a formula result', ok: back[0]?.[0] === '=1+1', detail: `got a ${typeof back[0]?.[0]}` },
  ]);
}

async function probeDuplicateMetadata(ctx) {
  const jobs = ctx.tab('Jobs');
  const first = await ctx.batch([bindKey(jobs.sheetId, 1, 'probe.dup', 'one')]);
  const second = await ctx.batch([bindKey(jobs.sheetId, 1, 'probe.dup', 'two')]);
  const beyondGrid = await ctx.batch([bindKey(jobs.sheetId, jobs.gridProperties.rowCount + 5, 'probe.orphan', 'x')]);
  const emptyInGrid = await ctx.batch([bindKey(jobs.sheetId, JOBS_ROWS.length + 3, 'probe.empty', 'x')]);
  return judge(
    [
      { label: 'the first binding is accepted', ok: first.ok, detail: statusOf(first) },
      { label: 'a second binding with the same key on the row is rejected', ok: second.status === 400, detail: statusOf(second) },
      { label: 'a binding beyond the grid is rejected', ok: beyondGrid.status === 400, detail: statusOf(beyondGrid) },
    ],
    `binding an empty row inside the grid: ${statusOf(emptyInGrid)}`,
  );
}

async function probeMetadataLimits(ctx) {
  const jobs = ctx.tab('Jobs');
  const ladder = { accepted: 0, refused: null };
  for (const length of [1000, 5000, 20000, 100000]) {
    if (ladder.refused !== null) break;
    const response = await ctx.batch([bindKey(jobs.sheetId, 2, `probe.len.${length}`, 'v'.repeat(length))]);
    if (response.ok) ladder.accepted = length;
    else ladder.refused = { length, status: response.status };
  }
  const project = await ctx.batch([bindKey(jobs.sheetId, 3, 'probe.project', 'x', 'PROJECT')]);
  const { found } = await ctx.search({ developerMetadataLookup: { metadataKey: 'probe.len.1000' } });
  return judge(
    [
      { label: 'a 1000-character DOCUMENT-visibility value is accepted', ok: ladder.accepted >= 1000 },
      { label: 'it is found again by key', ok: found.length === 1 },
    ],
    `largest value accepted ${ladder.accepted} chars${ladder.refused === null ? ' (top of ladder)' : `; ${ladder.refused.length} refused HTTP ${ladder.refused.status}`}; PROJECT visibility ${statusOf(project)}`,
  );
}

async function probeMetadataSearch(ctx) {
  const jobs = ctx.tab('Jobs');
  const companies = ctx.tab('Companies');
  const requests = [
    ...JOBS_ROWS.map((row, index) => bindKey(jobs.sheetId, index + 1, ROW_KEY, row[0])),
    ...COMPANIES_ROWS.map((row, index) => bindKey(companies.sheetId, index + 1, ROW_KEY, row[0])),
  ];
  const bound = await ctx.batch(requests);
  const { response, found } = await ctx.search(rowKeyLookup());
  ctx.capture('developerMetadata.search', response, 'POST spreadsheets/{id}/developerMetadata:search (metadataKey lookup)');
  const sheetIds = new Set(found.map((meta) => meta.location?.dimensionRange?.sheetId));
  return judge([
    { label: 'the row keys were bound on two tabs', ok: bound.ok, detail: statusOf(bound) },
    { label: 'one search returns every match', ok: found.length === requests.length, detail: `${found.length} of ${requests.length}` },
    { label: 'matches span both tabs', ok: sheetIds.has(jobs.sheetId) && sheetIds.has(companies.sheetId) },
    { label: 'every match is a ROW location with a start index', ok: found.every((meta) => meta.location?.dimensionRange?.dimension === 'ROWS' && Number.isInteger(meta.location.dimensionRange.startIndex)) },
  ]);
}

const alignedRows = async (ctx, jobsSheetId) => {
  const { found } = await ctx.search(rowKeyLookup());
  const mine = found.filter((meta) => meta.location?.dimensionRange?.sheetId === jobsSheetId);
  const column = await grid(ctx, 'Jobs!A1:A20');
  return { total: mine.length, aligned: mine.filter((meta) => column[meta.location.dimensionRange.startIndex]?.[0] === meta.metadataValue).length };
};

async function probeMetadataFollowsRows(ctx) {
  const jobs = ctx.tab('Jobs');
  const sort = await ctx.batch([{ sortRange: { range: { sheetId: jobs.sheetId, startRowIndex: 1, endRowIndex: JOBS_ROWS.length + 1, startColumnIndex: 0, endColumnIndex: JOBS_HEADER.length }, sortSpecs: [{ dimensionIndex: 0, sortOrder: 'DESCENDING' }] } }]);
  const afterSort = await alignedRows(ctx, jobs.sheetId);
  const insert = await ctx.batch([{ insertDimension: { range: { sheetId: jobs.sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 }, inheritFromBefore: false } }]);
  const afterInsert = await alignedRows(ctx, jobs.sheetId);
  const byFilter = await ctx.sheets('POST', '/values:batchGetByDataFilter', { json: { dataFilters: [rowKeyLookup('k-002')], valueRenderOption: 'UNFORMATTED_VALUE' } });
  ctx.capture('values.batchGetByDataFilter', byFilter, 'POST spreadsheets/{id}/values:batchGetByDataFilter (row-key lookup)');
  const row = byFilter.body?.valueRanges?.[0]?.valueRange?.values?.[0];
  return judge(
    [
      { label: 'sortRange applied', ok: sort.ok, detail: statusOf(sort) },
      { label: 'every row key still marks its own row after the sort', ok: afterSort.total === JOBS_ROWS.length && afterSort.aligned === afterSort.total, detail: `${afterSort.aligned} of ${afterSort.total}` },
      { label: 'insertDimension applied', ok: insert.ok, detail: statusOf(insert) },
      { label: 'every row key still marks its own row after the insert', ok: afterInsert.total === JOBS_ROWS.length && afterInsert.aligned === afterInsert.total, detail: `${afterInsert.aligned} of ${afterInsert.total}` },
      { label: 'batchGetByDataFilter returns the keyed row', ok: byFilter.ok && row?.[0] === 'k-002', detail: statusOf(byFilter) },
    ],
    'sortRange, insertDimension, batchGetByDataFilter',
  );
}

async function probeValuesAtomicity(ctx) {
  const valid = await ctx.sheets('POST', '/values:batchUpdate', { json: { valueInputOption: 'RAW', data: [{ range: 'Scratch!A31', values: [['a4-valid']] }] } });
  const invalid = await ctx.sheets('POST', '/values:batchUpdate', { json: { valueInputOption: 'RAW', data: [{ range: 'Scratch!A32', values: [['a4-first']] }, { range: 'NoSuchTab!A1', values: [['a4-second']] }] } });
  ctx.capture('values.batchUpdate.invalid', invalid, 'POST spreadsheets/{id}/values:batchUpdate (one invalid range among valid ones)');
  const applied = await grid(ctx, 'Scratch!A32');
  return judge(
    [
      { label: 'a valid values.batchUpdate is accepted', ok: valid.ok, detail: statusOf(valid) },
      { label: 'a batch with one invalid range is rejected', ok: invalid.status === 400, detail: statusOf(invalid) },
      { label: 'nothing of the rejected batch was applied (atomic)', ok: applied.length === 0 },
    ],
    'atomicity of values.batchUpdate',
  );
}

async function probeValuesByDataFilter(ctx) {
  const jobs = ctx.tab('Jobs');
  const { found } = await ctx.search(rowKeyLookup('k-003'));
  const start = found.find((meta) => meta.location?.dimensionRange?.sheetId === jobs.sheetId)?.location?.dimensionRange?.startIndex;
  if (start === undefined) return untested('no row keyed k-003 was found to write through');
  const write = (values) => ctx.sheets('POST', '/values:batchUpdateByDataFilter', { json: { valueInputOption: 'RAW', data: [{ dataFilter: rowKeyLookup('k-003'), majorDimension: 'ROWS', values: [values] }] } });
  const first = await write(['a9-first', 'a9-second']);
  ctx.capture('values.batchUpdateByDataFilter', first, 'POST spreadsheets/{id}/values:batchUpdateByDataFilter (row-key filter)');
  const afterFirst = (await grid(ctx, `Jobs!A${start + 1}:B${start + 1}`))[0] ?? [];
  const second = await write([null, 'a9-third']);
  const afterSecond = (await grid(ctx, `Jobs!A${start + 1}:B${start + 1}`))[0] ?? [];
  return judge(
    [
      { label: 'a write through a row-metadata filter is accepted', ok: first.ok, detail: statusOf(first) },
      { label: 'it writes from the first column of the keyed row', ok: afterFirst[0] === 'a9-first' && afterFirst[1] === 'a9-second', detail: `row now starts ${JSON.stringify(afterFirst).slice(0, 60)}` },
      { label: 'a null entry is skipped, not written as empty', ok: second.ok && afterSecond[0] === 'a9-first' && afterSecond[1] === 'a9-third', detail: `row now starts ${JSON.stringify(afterSecond).slice(0, 60)}` },
    ],
    'values.batchUpdateByDataFilter',
  );
}

async function probeProfileRoute(ctx) {
  const response = await ctx.gmail('GET', '/users/me/profile');
  ctx.capture('gmail.profile', response, 'GET gmail/v1/users/me/profile with the drive.file token');
  return judge([{ label: 'a drive.file token cannot read users/me/profile', ok: response.status === 401 || response.status === 403 || response.status === 404, detail: statusOf(response) }]);
}

async function probeGenerateIds(ctx) {
  const response = await ctx.drive('GET', '/files:generateIds', { query: { count: '1', space: 'drive' } });
  ctx.capture('drive.generateIds', response, 'GET drive/v3/files:generateIds?count=1');
  return judge([{ label: 'files.generateIds returns an id under drive.file', ok: response.ok && Array.isArray(response.body?.ids) && response.body.ids.length === 1, detail: statusOf(response) }]);
}

async function probePayloadCeiling(ctx) {
  const { sheetId } = ctx.tab('Bulk');
  const rungs = [ctx.trackerRows, ctx.trackerRows * 2];
  const outcomes = [];
  for (const rowCount of rungs) {
    if (outcomes.some((outcome) => !outcome.response.ok)) break;
    const response = await ctx.batch([{ updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: bulkRows(rowCount, 20), fields: 'userEnteredValue' } }]);
    outcomes.push({ rowCount, response });
  }
  const summary = outcomes.map(({ rowCount, response }) => `${rowCount} rows x 20 cols (${megabytes(response.sentBytes)}): ${statusOf(response)}`).join('; ');
  return judge([{ label: 'one batch at tracker size is accepted', ok: outcomes[0]?.response.ok === true }], summary);
}

async function probeWriteQuota(ctx) {
  const { sheetId } = ctx.tab('Bulk');
  const scratch = ctx.tab('Scratch');
  const chunks = [];
  for (let start = 0; start < ctx.trackerRows; start += METADATA_CHUNK) {
    const end = Math.min(start + METADATA_CHUNK, ctx.trackerRows);
    const rows = Array.from({ length: end - start }, (_, offset) => start + offset);
    chunks.push(await ctx.batch(rows.map((row) => bindKey(sheetId, row, ROW_KEY, `bulk-${row}`))));
  }
  let burst = `no 429 in ${BURST_WRITES} rapid writes`;
  for (let index = 0; index < BURST_WRITES; index += 1) {
    const response = await ctx.batch([writeText(scratch.sheetId, 40 + (index % 10), 0, `burst-${index}`)]);
    if (response.status === 429) {
      ctx.flags.captured429 = true;
      ctx.capture('error.429', response, 'POST spreadsheets/{id}:batchUpdate (rapid writes)');
      burst = `429 after ${index + 1} rapid writes, Retry-After ${response.retryAfter ?? 'absent'}`;
      break;
    }
    if (!response.ok) {
      burst = `burst stopped at ${statusOf(response)}`;
      break;
    }
  }
  return judge([{ label: `all ${chunks.length} import-sized metadata chunks (${METADATA_CHUNK} rows) accepted with no 429`, ok: chunks.every((response) => response.ok), detail: chunks.map((response) => response.status).join(',') }], burst);
}

async function probeErrorBodies(ctx) {
  const sheets = await ctx.otherSheets(PUBLIC_UNGRANTED_ID);
  ctx.capture('error.sheets-not-granted', sheets, 'GET spreadsheets/{id} for a Sheet this app never created');
  const drive = await ctx.drive('GET', `/files/${PUBLIC_UNGRANTED_ID}`, { query: { fields: 'id' } });
  ctx.capture('error.drive-not-granted', drive, 'GET drive/v3/files/{id} for a file this app never created');
  const reasonOf = (response) => `${response.status} ${response.body?.error?.status ?? '?'}/${response.body?.error?.errors?.[0]?.reason ?? 'no reason'}`;
  const summary = `Sheets ${reasonOf(sheets)}; Drive ${reasonOf(drive)}`;
  const denied = [sheets, drive].every((response) => [403, 404].includes(response.status) && response.body?.error !== undefined);
  if (!denied) return { verdict: VERDICT.BROKEN, note: `not-granted bodies were not 403/404 errors: ${summary}` };
  return ctx.flags.captured429 ? { verdict: VERDICT.WORKS, note: `403/404 and 429 bodies captured: ${summary}` } : untested(`429 was not provoked; 403/404 bodies captured: ${summary}`);
}

async function probeFileTrashed(ctx) {
  const response = await ctx.drive('GET', `/files/${encodeURIComponent(ctx.scratchId())}`, { query: { fields: 'trashed' } });
  ctx.capture('drive.files.get', response, 'GET drive/v3/files/{id}?fields=trashed');
  return judge([{ label: 'files.get fields=trashed reads false for the created file', ok: response.ok && response.body?.trashed === false, detail: statusOf(response) }], 'files.get trashed');
}

const PROBES = [
  { name: 'caller-chosen sheetId', ids: ['A18'], run: probeCallerSheetId },
  { name: 'typed readback and date serials', ids: ['A1', 'A2'], run: probeTypedReadback },
  { name: 'all-or-nothing batchUpdate', ids: ['A3'], run: probeBatchAtomicity },
  { name: 'data filter in a cell-level request', ids: ['A5'], run: probeCellDataFilter },
  { name: 'appendDimension', ids: ['A7'], run: probeAppendDimension },
  { name: 'field mask keeps formatting', ids: ['A8'], run: probeFieldMask },
  { name: 'appendCells position', ids: ['A15'], run: probeAppendPosition },
  { name: 'leading equals stored as text', ids: ['A16'], run: probeLeadingEquals },
  { name: 'duplicate and orphan metadata', ids: ['A17'], run: probeDuplicateMetadata },
  { name: 'metadata length and visibility', ids: ['A10'], run: probeMetadataLimits },
  { name: 'metadata search across tabs', ids: ['A19'], run: probeMetadataSearch },
  { name: 'metadata follows sort and insert', ids: ['L20'], run: probeMetadataFollowsRows },
  { name: 'values.batchUpdate atomicity', ids: ['A4'], run: probeValuesAtomicity },
  { name: 'values.batchUpdateByDataFilter', ids: ['A9'], run: probeValuesByDataFilter },
  { name: 'users/me/profile under drive.file', ids: ['A11'], run: probeProfileRoute },
  { name: 'files.generateIds', ids: ['A12'], run: probeGenerateIds },
  { name: 'file trashed flag', ids: ['L20'], run: probeFileTrashed },
  { name: 'payload ceiling at tracker size', ids: ['A6'], run: probePayloadCeiling },
  { name: 'write quota and 429', ids: ['A14'], run: probeWriteQuota },
  { name: '403, 404 and 429 bodies', ids: ['A13'], run: probeErrorBodies },
];

// ------------------------------------------------------------------------------------------------ run

const describeError = (error) => String(error?.code ?? error?.message ?? error).slice(0, 120);

const runProbe = async (probe, ctx) => {
  try {
    const outcome = await probe.run(ctx);
    return probe.ids.map((id) => {
      const own = outcome.verdict === undefined ? outcome[id] : outcome;
      return own === undefined ? { id, ...untested('probe returned no verdict for this id') } : { id, ...own };
    });
  } catch (error) {
    return probe.ids.map((id) => ({ id, ...untested(`probe aborted: ${describeError(error)}`) }));
  }
};

const createScratch = async (ctx, http, bases, scratch) => {
  const boundary = `harvester-live-${randomBytes(8).toString('hex')}`;
  const metadata = { name: `harvester-live-check-${Date.now()}`, mimeType: NATIVE_SHEET_MIME };
  const upload = await http.send(`${bases.upload}/files`, {
    method: 'POST',
    api: 'Drive',
    query: { uploadType: 'multipart', fields: 'id,name,mimeType' },
    headers: { 'content-type': `multipart/related; boundary=${boundary}` },
    body: multipartBody({ metadata, content: syntheticWorkbook(), contentType: XLSX_MIME, boundary }),
  });
  ctx.capture('drive.files.create', upload, 'POST upload/drive/v3/files?uploadType=multipart (xlsx to native Sheet)');
  if (!upload.ok || typeof upload.body?.id !== 'string') return refuse(`drive.files.create: HTTP ${upload.status}`);
  scratch.id = upload.body.id;
  const read = await ctx.sheets('GET', '');
  ctx.capture('spreadsheets.get', read, 'GET spreadsheets/{id}');
  if (!read.ok) return refuse(`spreadsheets.get: HTTP ${read.status}`);
  const tabs = await ctx.refreshTabs();
  const shape = ['Jobs', 'Companies', 'Sources'].every((title) => tabs[title] !== undefined);
  return judge(
    [
      { label: 'conversion returned a native Sheet', ok: upload.body.mimeType === NATIVE_SHEET_MIME },
      { label: 'the three synthetic tabs survived import', ok: shape },
      { label: 'drive.file token reads the created Sheet', ok: read.ok },
    ],
    'files.create with conversion',
  );
};

const deleteScratch = async (http, bases, id) => {
  if (id === null) return { ok: true, outcome: untested('nothing was created, so nothing was deleted') };
  try {
    const target = `${bases.drive}/files/${encodeURIComponent(id)}`;
    const removed = await http.send(target, { method: 'DELETE', api: 'Drive' });
    const after = removed.status === 204 ? await http.send(target, { query: { fields: 'trashed' }, api: 'Drive' }) : null;
    return { ok: removed.status === 204, outcome: judge([{ label: 'files.delete answers 204', ok: removed.status === 204, detail: `HTTP ${removed.status}` }, { label: 'the file is gone afterwards', ok: after !== null && after.status === 404, detail: after === null ? 'not checked' : `HTTP ${after.status}` }], 'files.delete') };
  } catch (error) {
    return { ok: false, outcome: untested(`delete failed: ${describeError(error)}`) };
  }
};

/**
 * @returns {Promise<{ exitCode: number, rows: object[], fixtures: object, createdId: string|null, table: string }>}
 */
export async function runLiveCheck({ env, fetch, loopback, print, printConsent = print, clientPath, slotPath, fixturesPath, probes = PROBES, trackerRows = TRACKER_ROWS, now = () => new Date() }) {
  const endpoints = resolveEndpoints(env);
  const bases = basesFor(endpoints, env);
  const client = readClient(clientPath);
  const scratch = { id: null };
  const secretsNow = () => [client.clientSecret, client.clientId, tokensRef.current?.current(), tokensRef.current?.refreshToken(), scratch.id];
  const tokensRef = { current: null };
  const say = (line) => print(redactText(line, secretsNow()));
  tokensRef.current = await acquireTokens({ fetch, endpoints, client, loopback, print: say, printConsent, slotPath, now });
  const http = createHttp({ fetch, tokens: tokensRef.current, say });
  const ctx = createContext({ http, bases, say, trackerRows, scratch });
  const results = [];
  let setupFailure = null;
  let deletion = { ok: true, outcome: null };
  try {
    say('creating the scratch Sheet from a synthetic workbook');
    results.push({ id: 'L20', ...(await createScratch(ctx, http, bases, scratch)) });
    for (const probe of probes) {
      say(`probe ${probe.name}`);
      results.push(...(await runProbe(probe, ctx)));
    }
  } catch (error) {
    setupFailure = describeError(error);
    say(`live-check: setup failed (${setupFailure})`);
  } finally {
    deletion = await deleteScratch(http, bases, scratch.id);
    if (scratch.id !== null && !deletion.ok) say('live-check: the scratch Sheet was NOT deleted: delete the file named "harvester-live-check-<timestamp>" from Drive by hand');
  }
  if (deletion.outcome !== null && scratch.id !== null) results.push({ id: 'L20', ...deletion.outcome });
  const rows = resultRows(results, ctx.fixtures);
  mkdirSync(dirname(fixturesPath), { recursive: true });
  writeFileSync(fixturesPath, `${JSON.stringify({ note: 'Real response bodies captured by scripts/sheets-live-check.mjs; ids, tokens and emails redacted.', capturedAt: now().toISOString(), bodies: ctx.fixtures }, null, 2)}\n`);
  const table = renderTable(rows, secretsNow());
  say(`\n${table}`);
  say(`scratch Sheet deleted: ${scratch.id === null ? 'none was created' : deletion.ok ? 'yes (HTTP 204)' : 'NO'}`);
  say(`fixtures written to ${fixturesPath}`);
  return { exitCode: setupFailure === null && deletion.ok ? 0 : 1, rows, fixtures: ctx.fixtures, createdId: scratch.id, table };
}

// ------------------------------------------------------------------------------------------------ self-test

const selfTest = async () => {
  const support = join(HERE, '..', 'tests', 'acceptance');
  const { createSheetsFake, startLoopbackFake } = await import(pathToFileURL(join(support, 'sheets-api-target', 'support', 'sheets-fake.mjs')));
  const { SHEETS_SENTINEL, SPREADSHEET_ID } = await import(pathToFileURL(join(support, 'sheets-api-target', 'support', 'sheets-constants.mjs')));
  const { aFakeBrowser, serverError } = await import(pathToFileURL(join(support, 'gmail-api-source', 'support', 'gmail-fake.mjs')));
  const { SENTINEL, aClientFile } = await import(pathToFileURL(join(support, 'gmail-api-source', 'support', 'gmail-domain-types.mjs')));

  const directory = mkdtempSync(join(tmpdir(), 'sheets-live-check-'));
  const clientPath = join(directory, 'client.json');
  const slotPath = join(directory, 'slot', 'sheets-live-check-token.json');
  writeFileSync(clientPath, JSON.stringify(aClientFile()));
  const checks = [];
  const check = (label, ok, detail = '') => checks.push({ label, ok: Boolean(ok), detail });

  const scenario = async (name, { fake, probes = PROBES }) => {
    const server = await startLoopbackFake(fake);
    const browser = aFakeBrowser();
    const lines = [];
    const fixturesPath = join(directory, `${name}-fixtures.json`);
    try {
      const outcome = await runLiveCheck({ env: { [ENDPOINT_OVERRIDE_ENV]: server.baseUrl }, fetch: globalThis.fetch, loopback: browser.loopback, print: (line) => lines.push(line), printConsent: browser.print, clientPath, slotPath, fixturesPath, probes, trackerRows: 40 });
      return { ...outcome, lines, browser, fixturesText: readFileSync(fixturesPath, 'utf8') };
    } finally {
      await server.close();
    }
  };

  const trackerFake = () => createSheetsFake({ tabs: { Jobs: { header: ['Dedup Key', 'Company'], rows: [['operator-1', 'Operator Co']] } } });
  const secretsIn = (text, created) => [...Object.values(SHEETS_SENTINEL), ...Object.values(SENTINEL), created].filter((secret) => secret && text.includes(secret));
  const deletionHeld = (name, fake, outcome) => {
    const deletes = fake.requestsTo('drive-delete');
    check(`${name}: exactly one delete, on the id it created`, deletes.length === 1 && deletes[0].id === outcome.createdId);
    check(`${name}: the scratch Sheet is gone and the operator's file is untouched`, !fake.files().some((file) => file.id === outcome.createdId) && fake.files().some((file) => file.id === SPREADSHEET_ID));
    check(`${name}: no write and no read ever addressed another Sheet of the operator's`, fake.writeRequests().every((request) => request.id === null || request.id === outcome.createdId) && fake.apiRequests().every((request) => request.id !== SPREADSHEET_ID));
  };

  const coveredIds = new Set(PROBES.flatMap((probe) => probe.ids));
  const uncovered = [...ASSUMPTION_IDS, 'L20'].filter((id) => !coveredIds.has(id));
  check('every assumption A1-A19 and the spike-proven L20 items have a probe', uncovered.length === 0, `missing probes: ${uncovered.join(', ')}`);

  const sample = `token ya29.abcDEF123 and 1//0gRefresh-xyz for me@example.com at https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUv/edit id 1AbCdEfGhIjKlMnOpQrStUvWxYz012 project 123456789012`;
  const redacted = redactText(sample);
  check('redaction masks tokens, emails, id-bearing urls, long ids and project numbers', !/ya29|1\/\/0g|@|1AbCdEf|123456789012/.test(redacted), redacted);
  check('redaction keeps error reasons readable', redactText('ACCESS_TOKEN_SCOPE_INSUFFICIENT rateLimitExceeded') === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT rateLimitExceeded');
  check('403 SERVICE_DISABLED names the API to enable, a scope 403 names drive.file', /Google Sheets API/.test(diagnose({ status: 403, body: { error: { status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] } } }, 'Sheets')) && /drive\.file/.test(diagnose({ status: 403, body: { error: { message: 'Request had insufficient authentication scopes.' } } }, 'Drive')));

  const first = trackerFake();
  const full = await scenario('full', { fake: first });
  const expectedIds = [...ASSUMPTION_IDS, ...LEDGER_IDS];
  check('the results table lists every A1-A19 and L01-L20 id, each with a verdict', JSON.stringify(full.rows.map((row) => row.id)) === JSON.stringify(expectedIds) && full.rows.every((row) => Object.values(VERDICT).includes(row.verdict)));
  check('every row is backed by a probe, not by a placeholder', full.rows.every((row) => !/no probe result/.test(row.note)), full.rows.filter((row) => /no probe result/.test(row.note)).map((row) => row.id).join(','));
  check('the run completed and printed the table', full.exitCode === 0 && full.lines.join('\n').includes('| id | verdict | evidence |'));
  const printed = full.lines.join('\n');
  check('no token, client secret, code or created id in any output or in the fixtures file', secretsIn(`${printed}\n${full.fixturesText}`, full.createdId).length === 0, secretsIn(`${printed}\n${full.fixturesText}`, full.createdId).join(','));
  check('no email address, bearer header or long id in the fixtures file', !/@|Bearer|[A-Za-z0-9_-]{20,}\d/.test(full.fixturesText.replace(/"(?:note|request)": "[^"]*"/g, '')));
  check('the fixtures file holds every required body', REQUIRED_FIXTURES.every((name) => JSON.parse(full.fixturesText).bodies[name] !== undefined));
  check('the consent asked for drive.file and nothing else', full.browser.seen.consentUrl?.searchParams.get('scope') === DRIVE_FILE_SCOPE);
  deletionHeld('full run', first, full);
  check('the throwaway token slot is 0600 and holds no access token', (statSync(slotPath).mode & 0o777) === 0o600 && !readFileSync(slotPath, 'utf8').includes(SHEETS_SENTINEL.accessToken));

  const failing = trackerFake();
  failing.override('values', () => serverError(500));
  failing.override('batch-update', () => serverError(500), { when: (request) => request.requestTypes.includes('appendCells') });
  const failed = await scenario('probe-failure', { fake: failing });
  check('probe failures still yield a complete table and delete the scratch Sheet', failed.rows.length === expectedIds.length && failed.exitCode === 0);
  check('the second run reused the stored token instead of consenting again', failed.browser.seen.listenCalls === 0);
  deletionHeld('probe-failure run', failing, failed);

  const broken = trackerFake();
  broken.override('get', () => serverError(500));
  const aborted = await scenario('setup-failure', { fake: broken });
  check('a failure after the Sheet was created deletes it and exits non-zero', aborted.exitCode === 1);
  deletionHeld('setup-failure run', broken, aborted);

  rmSync(directory, { recursive: true, force: true });
  for (const item of checks) console.log(`${item.ok ? 'pass' : 'FAIL'}  ${item.label}${item.ok || item.detail === '' ? '' : ` [${item.detail.slice(0, 160)}]`}`);
  const failures = checks.filter((item) => !item.ok).length;
  console.log(failures === 0 ? `self-test: ${checks.length} checks passed` : `self-test: ${failures} of ${checks.length} checks FAILED`);
  return failures === 0 ? 0 : 1;
};

// ------------------------------------------------------------------------------------------------ main

const main = async (argv, env) => {
  if (argv.includes('--self-test')) return selfTest();
  if (argv.length > 0) {
    console.error('usage: node scripts/sheets-live-check.mjs [--self-test]');
    return 2;
  }
  const outcome = await runLiveCheck({
    env,
    fetch: globalThis.fetch,
    loopback: createOAuthLoopback({ timeoutMs: CONSENT_TIMEOUT_MS }),
    print: (line) => console.log(line),
    clientPath: CLIENT_PATH,
    slotPath: TOKEN_SLOT_PATH,
    fixturesPath: FIXTURES_PATH,
  });
  return outcome.exitCode;
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`live-check: failed (${redactText(describeError(error))})`);
      process.exit(2);
    },
  );
}
