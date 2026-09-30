// The Google Sheets API, the Drive API and the token endpoint as one fake (Driven external ports).
//
// FAKE FIDELITY LEDGER. Each entry names Google behaviour the fake encodes and what the operator's live check (2026-09-30,
// a scratch Sheet imported from a synthetic workbook, then deleted) found. Evidence: docs/feature/sheets-api-target/deliver/
// live-findings.md and live-fixtures.json. verified = held live | corrected = refuted live and the fake changed | deferred = not settled.
//   L01 A1   VERIFIED  values:batchGet with UNFORMATTED_VALUE returns booleans, numbers and text as typed; an interior blank cell reads ''
//   L02 A2   VERIFIED  a converted .xlsx date is stored as the serial number SheetJS hands over (the fake performs no date conversion)
//   L03 A3   VERIFIED  spreadsheets:batchUpdate is all-or-nothing across every request and every tab (real 400 body captured)
//   L04 A4   VERIFIED  values:batchUpdate is all-or-nothing too; it and batchUpdateByDataFilter (write through a row-metadata filter
//                      WORKS live) are NOT modelled here (404): the design writes through spreadsheets.batchUpdate only
//   L05 A5   VERIFIED  no cell-level request accepts a data filter (a request carrying `dataFilter` is rejected 400)
//   L06 A6   VERIFIED  NO payload ceiling is modelled; 6,000 rows x 20 columns (9.0 MB) was accepted live and no ceiling was found,
//                      so plan-too-large stays the adapter's own decision (MAX_BATCH_BYTES = 9 MiB, the largest measured-good size)
//   L07 A7   VERIFIED  updateCells or appendCells beyond the grid's columns is a 400; appendDimension COLUMNS makes room
//   L08 A8   VERIFIED  updateCells with fields=userEnteredValue leaves the cell's format alone; fields='*' resets it
//   L09 A10  VERIFIED  developer metadata values up to 20,000 characters are accepted and 100,000 is refused (400); the fake models no
//                      length limit; DOCUMENT and PROJECT visibility are both accepted; DOCUMENT is recorded and never enforced
//   L10 A11  VERIFIED  a drive.file token cannot call users/me/profile: 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT (real body served)
//   L11 A12  DEFERRED  files.generateIds is not modelled (404): the live probe used a wrong path (files:generateIds); the real path is
//                      GET /drive/v3/files/generateIds?count=1; an optional import hardening; the narrow re-run settles it
//   L12 A13  VERIFIED  a Sheet or Drive file this app never created answers 404 (not 403) in the real Sheets and Drive shapes; a real
//                      429 is RESOURCE_EXHAUSTED with RATE_LIMIT_EXCEEDED in details[] and no Retry-After (served by rateLimited());
//                      the 403 rate-reason shape (errors[].reason) stays composed from memory and was not observed
//   L13 A14  PARTIAL   a 429 arrived after about 57 rapid write requests (60 write requests per minute per user), no Retry-After: the
//                      429 shape and the quota are verified but not modelled (scenarios script the 429); DEFERRED: 4 of 6 metadata
//                      chunks of 500 rows returned 400 and the cause was not captured
//   L14 A15  VERIFIED  appendCells adds rows after the last row holding data, growing the grid's rows if needed
//   L15 A16  VERIFIED  a stringValue starting with '=' is stored as literal text, never as a formula
//   L16 A17  CORRECTED a second developer metadata with the same key on one row is ACCEPTED, and so is one on an empty row inside the
//                      grid; only a row beyond the grid is a 400 here (unmeasured live). The adapter's read-back check is the only guard
//   L17 A18  VERIFIED  addSheet accepts a caller-chosen sheetId and rejects a duplicate title or id with a 400
//   L18 A19  VERIFIED  developerMetadata:search with a metadataKey lookup returns every match across tabs, as ROW locations
//   L19 DR-0007 COMPARED every captured body was compared with the fake's (sheets-fake.test.mjs pins the key shapes): corrected
//                      spreadsheets.get properties, gridProperties flags, batchUpdate replies and commentUpdateState, the 400/404 error
//                      envelopes, the Drive 404, files.get and files.create `fields` projection, the 429 and profile bodies; not modelled:
//                      properties.defaultFormat and spreadsheetTheme, valueRanges range normalisation, the data-filter bodies
//   L20 spike VERIFIED files.create with conversion, files.get fields=trashed and files.delete (204) under drive.file, and developer
//                      metadata following a row through sortRange/insertDimension, hold live; detail fidelity is L19
// The same handler is served two ways: called directly as an injected `fetch`, and behind a loopback-only node:http
// server for the one CLI seam. A dropped response (batch applied, response lost) is a fault this harness injects.

import { createServer } from 'node:http';
import * as XLSX from 'xlsx';

import { createGmailFake, json, forbiddenFor, serverError, consentUrlIn, consentRedirect, aFakeBrowser } from '../../gmail-api-source/support/gmail-fake.mjs';
import { DRIVE_FILE_SCOPE, NATIVE_SHEET_MIME, SHEETS_SENTINEL, SPREADSHEET_ID } from './sheets-constants.mjs';

export { json, forbiddenFor, serverError, consentUrlIn, consentRedirect, aFakeBrowser };

export { NATIVE_SHEET_MIME };
export const REAL_ROW_KEY_METADATA = 'harvester.row-key';
const WRITE_ROUTES = ['batch-update', 'drive-create', 'drive-delete'];
const DEFAULT_ROWS = 1000;
const DEFAULT_COLUMNS = 26;

const isBlank = (value) => value === null || value === undefined || value === '';
const STATUS_NAMES = { 400: 'INVALID_ARGUMENT', 404: 'NOT_FOUND' };
const error = (status, message) => json(status, { error: { code: status, message, status: STATUS_NAMES[status] } });
const driveError = (status, message, reason, detail = {}) => json(status, { error: { code: status, message, errors: [{ message, domain: 'global', reason, ...detail }] } });
const driveNotFound = (id) => driveError(404, `File not found: ${id}.`, 'notFound', { location: 'fileId', locationType: 'parameter' });
const QUOTA_MESSAGE = "Quota exceeded for quota metric 'Write requests' and limit 'Write requests per minute per user' of service 'sheets.googleapis.com' for consumer 'project_number:123456789012'.";

/** The real quota 429: RATE_LIMIT_EXCEEDED in details[], and no Retry-After unless the scenario asks for one. */
export const rateLimited = ({ retryAfter } = {}) =>
  json(
    429,
    {
      error: {
        code: 429,
        message: QUOTA_MESSAGE,
        status: 'RESOURCE_EXHAUSTED',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            reason: 'RATE_LIMIT_EXCEEDED',
            domain: 'googleapis.com',
            metadata: {
              quota_metric: 'sheets.googleapis.com/write_requests',
              quota_location: 'global',
              service: 'sheets.googleapis.com',
              quota_unit: '1/min/{project}/{user}',
              quota_limit: 'WriteRequestsPerMinutePerUser',
              consumer: 'projects/123456789012',
              quota_limit_value: '60',
              window_start_time: '1790000000',
            },
          },
          { '@type': 'type.googleapis.com/google.rpc.Help', links: [{ description: 'Request a higher quota limit.', url: 'https://cloud.google.com/docs/quotas/help/request_increase' }] },
        ],
      },
    },
    retryAfter === undefined ? {} : { 'retry-after': String(retryAfter) },
  );

const scopeInsufficient = () =>
  json(403, {
    error: {
      code: 403,
      message: 'Request had insufficient authentication scopes.',
      errors: [{ message: 'Insufficient Permission', domain: 'global', reason: 'insufficientPermissions' }],
      status: 'PERMISSION_DENIED',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT', domain: 'googleapis.com', metadata: { service: 'gmail.googleapis.com', method: 'caribou.api.proto.MailboxService.GetProfile' } },
      ],
    },
  });

const NO_FIELDS_DEFAULT = ['kind', 'id', 'name', 'mimeType'];
const projectFile = (file, fields) => {
  const names = fields ? fields.split(',').map((name) => name.trim()) : NO_FIELDS_DEFAULT;
  return Object.fromEntries(names.filter((name) => name in file).map((name) => [name, file[name]]));
};
const unauthenticated = () => json(401, { error: { code: 401, message: 'Invalid Credentials', status: 'UNAUTHENTICATED' } });

class Invalid extends Error {}
const invalid = (message) => {
  throw new Invalid(message);
};

const columnLetter = (index) => {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};
const columnIndexOf = (letters) => [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;

const encodeKey = (values) => (values.length === 1 ? String(values[0]) : JSON.stringify(values));
const KEY_COLUMNS = { Jobs: ['Dedup Key'], Companies: ['Company'], Sources: ['Source', 'Search Term'] };

const newRow = (cells = []) => ({ cells: [...cells], formats: {}, meta: [] });
const usedRowCount = (tab) => {
  for (let index = tab.rows.length - 1; index >= 0; index -= 1) if (tab.rows[index].cells.some((cell) => !isBlank(cell))) return index + 1;
  return 0;
};
const ensureRows = (tab, count) => {
  while (tab.rows.length < count) tab.rows.push(newRow());
  tab.rowCount = Math.max(tab.rowCount, count);
};

const parseRangeText = (text) => {
  const bang = text.lastIndexOf('!');
  const rawTitle = bang === -1 ? text : text.slice(0, bang);
  const rest = bang === -1 ? null : text.slice(bang + 1);
  const title = rawTitle.startsWith("'") && rawTitle.endsWith("'") ? rawTitle.slice(1, -1).replaceAll("''", "'") : rawTitle;
  const bound = (part) => {
    const match = /^([A-Z]+)?(\d+)?$/.exec(part ?? '');
    if (!match) invalid(`Unable to parse range: ${text}`);
    return { column: match[1] ? columnIndexOf(match[1]) : null, row: match[2] ? Number(match[2]) - 1 : null };
  };
  if (rest === null) return { title, r0: 0, r1: Infinity, c0: 0, c1: Infinity, rest };
  const [from, to = from] = rest.split(':');
  const a = bound(from);
  const b = bound(to);
  return { title, r0: a.row ?? 0, r1: b.row ?? Infinity, c0: a.column ?? 0, c1: b.column ?? Infinity, rest };
};

const cellData = (cell, fields) => {
  const value = cell?.userEnteredValue;
  if (value === undefined) return { value: null, formula: false };
  if ('formulaValue' in value) return { value: value.formulaValue, formula: true };
  if ('numberValue' in value) return { value: value.numberValue, formula: false };
  if ('boolValue' in value) return { value: value.boolValue, formula: false };
  if ('stringValue' in value) return { value: value.stringValue, formula: false };
  return invalid(`unsupported userEnteredValue ${JSON.stringify(value)} (fields ${fields})`);
};

const toBuffer = (body) => {
  if (body === undefined || body === null) return Buffer.alloc(0);
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  return Buffer.from(body.buffer ? Buffer.from(body.buffer, body.byteOffset, body.byteLength) : body);
};

const parseMultipart = (body, contentType) => {
  const boundary = /boundary=("?)([^";]+)\1/.exec(contentType ?? '')?.[2];
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let position = body.indexOf(delimiter);
  while (position !== -1) {
    const next = body.indexOf(delimiter, position + delimiter.length);
    if (next === -1) break;
    let segment = body.subarray(position + delimiter.length, next);
    if (segment.subarray(0, 2).toString() === '\r\n') segment = segment.subarray(2);
    const split = segment.indexOf('\r\n\r\n');
    if (split === -1) return null;
    const content = segment.subarray(split + 4);
    parts.push({ headers: segment.subarray(0, split).toString('utf8'), content: content.subarray(0, content.length >= 2 ? content.length - 2 : 0) });
    position = next;
  }
  return parts.length === 2 ? parts : null;
};

const applyConversion = (tabs, conversion) => {
  if (conversion === 'drops-last-data-row') {
    return tabs.map((tab, index) => (index === 0 && tab.rows.length > 1 ? { ...tab, rows: tab.rows.slice(0, -1) } : tab));
  }
  if (conversion === 'renames-first-header') {
    return tabs.map((tab, index) => (index === 0 ? { ...tab, rows: [tab.rows[0].map((cell, column) => (column === 0 ? `${cell} (renamed)` : cell)), ...tab.rows.slice(1)] } : tab));
  }
  if (conversion === 'drops-tab') return tabs.slice(0, -1);
  return tabs;
};

/**
 * @param {object} options
 * @param {Record<string, { header: string[], rows: (object|unknown[])[] }>} [options.tabs] the Sheet the operator's tracker already is
 * @param {'tight'|'default'} [options.grid] tight = grid exactly the used range; default = at least 1000 x 26
 * @param {boolean} [options.bindMetadata] bind row-key metadata to every keyed row of a known tab, as import leaves it
 * @param {'faithful'|'drops-last-data-row'|'renames-first-header'|'drops-tab'} [options.conversion] what Drive's conversion does to an upload
 */
export function createSheetsFake({
  spreadsheetId = SPREADSHEET_ID,
  tabs = {},
  grid = 'default',
  bindMetadata = true,
  conversion = 'faithful',
  accessTokens = [SHEETS_SENTINEL.accessToken, SHEETS_SENTINEL.accessTokenRefreshed],
  refreshToken = SHEETS_SENTINEL.refreshToken,
  issuedRefreshToken = SHEETS_SENTINEL.refreshToken,
  rotateRefreshTo = null,
  grantedScope = DRIVE_FILE_SCOPE,
  omitRefreshToken = false,
} = {}) {
  const auth = createGmailFake({ accessTokens, refreshToken, issuedRefreshToken, rotateRefreshTo, grantedScope, omitRefreshToken });
  const requests = [];
  const overrides = [];
  const hooks = [];
  const state = { invalid: false, sequence: 0, dropResponses: 0, failNextBatchAt: null, nextMetadataId: 900001, nextSheetId: 1 };
  const spreadsheets = new Map();
  const files = new Map();

  const makeTab = ({ sheetId, title, header, rows, rowCount, columnCount }) => {
    const tab = { sheetId, title, rows: [newRow(header), ...rows.map((row) => newRow(row))], rowCount: 0, columnCount: 0 };
    const usedColumns = Math.max(header.length, ...rows.map((row) => row.length), 0);
    tab.rowCount = rowCount ?? (grid === 'tight' ? tab.rows.length : Math.max(DEFAULT_ROWS, tab.rows.length));
    tab.columnCount = columnCount ?? (grid === 'tight' ? usedColumns : Math.max(DEFAULT_COLUMNS, usedColumns));
    return tab;
  };

  const rowArray = (header, row) => (Array.isArray(row) ? row : header.map((name) => row[name] ?? null));

  const addSpreadsheet = (id, tabConfigs, { bind = false } = {}) => {
    const sheet = { id, title: 'Job tracker', tabs: [], trashed: false };
    for (const [title, config] of Object.entries(tabConfigs)) {
      const tab = makeTab({ sheetId: state.nextSheetId++, title, header: config.header, rows: config.rows.map((row) => rowArray(config.header, row)) });
      sheet.tabs.push(tab);
      const keyColumns = KEY_COLUMNS[title];
      if (bind && keyColumns) {
        const indices = keyColumns.map((name) => config.header.indexOf(name));
        if (indices.every((index) => index >= 0)) {
          tab.rows.slice(1).forEach((row) => {
            const values = indices.map((index) => row.cells[index]);
            if (values.every((value) => !isBlank(value))) row.meta.push({ id: state.nextMetadataId++, key: REAL_ROW_KEY_METADATA, value: encodeKey(values) });
          });
        }
      }
    }
    spreadsheets.set(id, sheet);
    files.set(id, { kind: 'drive#file', id, name: sheet.title, mimeType: NATIVE_SHEET_MIME, trashed: false });
    return sheet;
  };

  if (Object.keys(tabs).length > 0) addSpreadsheet(spreadsheetId, tabs, { bind: bindMetadata });

  const tabOf = (sheet, title) => sheet.tabs.find((tab) => tab.title === title);
  const tabById = (sheet, sheetId) => sheet.tabs.find((tab) => tab.sheetId === sheetId);

  // ------------------------------------------------------------ classification

  const classify = (url, init) => {
    const parsed = new URL(String(url));
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = parsed.pathname;
    const headers = new Headers(init?.headers ?? {});
    const raw = toBuffer(init?.body);
    let route = 'unknown';
    let id = null;
    let match;
    if (path.endsWith('/token')) route = 'token';
    else if ((match = /\/spreadsheets\/([^/:]+):batchUpdate$/.exec(path))) [route, id] = ['batch-update', match[1]];
    else if ((match = /\/spreadsheets\/([^/:]+)\/values:batchGet$/.exec(path))) [route, id] = ['values', match[1]];
    else if ((match = /\/spreadsheets\/([^/:]+)\/developerMetadata:search$/.exec(path))) [route, id] = ['metadata-search', match[1]];
    else if ((match = /\/spreadsheets\/([^/:]+)$/.exec(path))) [route, id] = ['get', match[1]];
    else if (/\/upload\/drive\/v3\/files$/.test(path)) route = 'drive-create';
    else if ((match = /\/drive\/v3\/files\/([^/]+)$/.exec(path))) [route, id] = [method === 'DELETE' ? 'drive-delete' : 'drive-get', match[1]];
    else if (path.endsWith('/users/me/profile')) route = 'profile';
    const isForm = route === 'token';
    let jsonBody = null;
    if (!isForm && raw.length > 0 && route !== 'drive-create') {
      try {
        jsonBody = JSON.parse(raw.toString('utf8'));
      } catch {
        jsonBody = undefined;
      }
    }
    return {
      route,
      method,
      path,
      id: id === null ? null : decodeURIComponent(id),
      query: Object.fromEntries(parsed.searchParams),
      ranges: parsed.searchParams.getAll('ranges'),
      authorization: headers.get('authorization'),
      contentType: headers.get('content-type'),
      body: jsonBody,
      raw,
      bytes: raw.length,
      requestTypes: Array.isArray(jsonBody?.requests) ? jsonBody.requests.map((entry) => Object.keys(entry)[0]) : [],
    };
  };

  // ------------------------------------------------------------ reads

  const spreadsheetBody = (sheet) => ({
    spreadsheetId: sheet.id,
    properties: { title: sheet.title, locale: 'en_GB', autoRecalc: 'ON_CHANGE', timeZone: 'America/Los_Angeles' },
    sheets: sheet.tabs.map((tab, index) => ({
      properties: { sheetId: tab.sheetId, title: tab.title, index, sheetType: 'GRID', gridProperties: { rowCount: tab.rowCount, columnCount: tab.columnCount, rowGroupControlAfter: true, columnGroupControlAfter: true } },
    })),
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${sheet.id}/edit`,
  });

  const valuesFor = (sheet, text) => {
    const range = parseRangeText(text);
    const tab = tabOf(sheet, range.title);
    if (!tab) invalid(`Unable to parse range: ${text}`);
    const last = Math.min(range.r1, usedRowCount(tab) - 1);
    const values = [];
    for (let rowIndex = range.r0; rowIndex <= last; rowIndex += 1) {
      const cells = (tab.rows[rowIndex]?.cells ?? []).slice(range.c0, range.c1 === Infinity ? undefined : range.c1 + 1);
      let end = cells.length;
      while (end > 0 && isBlank(cells[end - 1])) end -= 1;
      values.push(cells.slice(0, end).map((cell) => (isBlank(cell) ? '' : cell)));
    }
    while (values.length > 0 && values[values.length - 1].length === 0) values.pop();
    const valueRange = { range: `${tab.title}!${range.rest ?? `A1:${columnLetter(tab.columnCount - 1)}${tab.rowCount}`}`, majorDimension: 'ROWS' };
    if (values.length > 0) valueRange.values = values;
    return valueRange;
  };

  const metadataSearch = (sheet, body) => {
    const keys = (body?.dataFilters ?? []).map((filter) => filter.developerMetadataLookup?.metadataKey).filter(Boolean);
    const matched = [];
    for (const tab of sheet.tabs) {
      tab.rows.forEach((row, rowIndex) => {
        for (const meta of row.meta) {
          if (!keys.includes(meta.key)) continue;
          matched.push({
            developerMetadata: {
              metadataId: meta.id,
              metadataKey: meta.key,
              metadataValue: meta.value,
              location: { locationType: 'ROW', dimensionRange: { sheetId: tab.sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 } },
              visibility: 'DOCUMENT',
            },
            dataFilters: [{ developerMetadataLookup: { metadataKey: meta.key } }],
          });
        }
      });
    }
    return matched.length > 0 ? { matchedDeveloperMetadata: matched } : {};
  };

  // ------------------------------------------------------------ writes

  const writeCells = (tab, rowIndex, columnIndex, data, fields) => {
    if (data.formula) invalid('formulaValue: the harvester never writes a formula');
    ensureRows(tab, rowIndex + 1);
    const row = tab.rows[rowIndex];
    while (row.cells.length <= columnIndex) row.cells.push(null);
    row.cells[columnIndex] = data.value;
    if (fields !== 'userEnteredValue') delete row.formats[columnIndex];
  };

  const handlers = {
    updateCells(request, sheet, index) {
      const { rows, fields, start } = request;
      if (typeof fields !== 'string' || fields === '') invalid(`Invalid requests[${index}].updateCells: fields: field mask required`);
      if (!start) invalid(`Invalid requests[${index}].updateCells: only a start coordinate is modelled`);
      const tab = tabById(sheet, start.sheetId) ?? invalid(`Invalid requests[${index}].updateCells: No grid with id: ${start.sheetId}`);
      if (start.rowIndex + rows.length > tab.rowCount) invalid(`Invalid requests[${index}].updateCells: Range exceeds grid limits. Max rows: ${tab.rowCount}`);
      rows.forEach((row, rowOffset) => {
        if (start.columnIndex + row.values.length > tab.columnCount) invalid(`Invalid requests[${index}].updateCells: Range exceeds grid limits. Max columns: ${tab.columnCount}`);
        row.values.forEach((cell, columnOffset) => {
          if (cell?.dataFilter) invalid(`Invalid requests[${index}].updateCells: data filters are not accepted`);
          writeCells(tab, start.rowIndex + rowOffset, start.columnIndex + columnOffset, cellData(cell, fields), fields);
        });
      });
    },
    appendCells(request, sheet, index) {
      const tab = tabById(sheet, request.sheetId) ?? invalid(`Invalid requests[${index}].appendCells: No grid with id: ${request.sheetId}`);
      if (typeof request.fields !== 'string' || request.fields === '') invalid(`Invalid requests[${index}].appendCells: fields: field mask required`);
      let position = usedRowCount(tab);
      for (const row of request.rows) {
        if (row.values.length > tab.columnCount) invalid(`Invalid requests[${index}].appendCells: Range exceeds grid limits. Max columns: ${tab.columnCount}`);
        row.values.forEach((cell, columnIndex) => writeCells(tab, position, columnIndex, cellData(cell, request.fields), request.fields));
        ensureRows(tab, position + 1);
        position += 1;
      }
    },
    appendDimension(request, sheet, index) {
      const tab = tabById(sheet, request.sheetId) ?? invalid(`Invalid requests[${index}].appendDimension: No grid with id: ${request.sheetId}`);
      if (!Number.isInteger(request.length) || request.length < 1) invalid(`Invalid requests[${index}].appendDimension: length must be positive`);
      if (request.dimension === 'COLUMNS') tab.columnCount += request.length;
      else if (request.dimension === 'ROWS') tab.rowCount += request.length;
      else invalid(`Invalid requests[${index}].appendDimension: dimension`);
    },
    addSheet(request, sheet, index) {
      const { title, sheetId, gridProperties } = request.properties ?? {};
      if (!title) invalid(`Invalid requests[${index}].addSheet: title required`);
      if (tabOf(sheet, title)) invalid(`Invalid requests[${index}].addSheet: A sheet with the name "${title}" already exists. Please enter another name.`);
      const id = sheetId ?? state.nextSheetId++;
      if (!Number.isInteger(id) || id < 0 || tabById(sheet, id)) invalid(`Invalid requests[${index}].addSheet: sheetId ${id} is unusable`);
      const tab = { sheetId: id, title, rows: [], rowCount: gridProperties?.rowCount ?? DEFAULT_ROWS, columnCount: gridProperties?.columnCount ?? DEFAULT_COLUMNS };
      sheet.tabs.push(tab);
      state.nextSheetId = Math.max(state.nextSheetId, id + 1);
      return { addSheet: { properties: { sheetId: id, title, index: sheet.tabs.length - 1, sheetType: 'GRID', gridProperties: { rowCount: tab.rowCount, columnCount: tab.columnCount } } } };
    },
    createDeveloperMetadata(request, sheet, index) {
      const meta = request.developerMetadata;
      const range = meta?.location?.dimensionRange;
      if (!meta?.metadataKey || !range || range.dimension !== 'ROWS' || range.endIndex !== range.startIndex + 1) invalid(`Invalid requests[${index}].createDeveloperMetadata: only a single-row location is modelled`);
      const tab = tabById(sheet, range.sheetId) ?? invalid(`Invalid requests[${index}].createDeveloperMetadata: No grid with id: ${range.sheetId}`);
      if (range.startIndex >= tab.rowCount) invalid(`Invalid requests[${index}].createDeveloperMetadata: the row is beyond the grid`);
      ensureRows(tab, range.startIndex + 1);
      const row = tab.rows[range.startIndex];
      row.meta.push({ id: state.nextMetadataId++, key: meta.metadataKey, value: meta.metadataValue });
    },
  };

  const batchUpdate = (request, sheet) => {
    const list = request.body?.requests;
    if (!Array.isArray(list) || list.length === 0) return error(400, 'Invalid JSON payload: requests required');
    const before = { tabs: structuredClone(sheet.tabs), nextSheetId: state.nextSheetId, nextMetadataId: state.nextMetadataId };
    let replies;
    try {
      replies = list.map((entry, index) => {
        const [type, ...others] = Object.keys(entry);
        if (others.length > 0) invalid(`Invalid requests[${index}]: exactly one request type per entry`);
        if (state.failNextBatchAt === index) invalid(`Invalid requests[${index}]: rejected by the test`);
        if (!handlers[type]) invalid(`Invalid requests[${index}].${type}: not modelled by this fake`);
        return handlers[type](entry[type], sheet, index) ?? {};
      });
    } catch (thrown) {
      state.failNextBatchAt = null;
      sheet.tabs = before.tabs;
      state.nextSheetId = before.nextSheetId;
      state.nextMetadataId = before.nextMetadataId;
      if (thrown instanceof Invalid) return error(400, thrown.message);
      throw thrown;
    }
    state.failNextBatchAt = null;
    return json(200, { spreadsheetId: sheet.id, replies, commentUpdateState: 'NO_UPDATES_REQUESTED' });
  };

  // ------------------------------------------------------------ drive

  const driveCreate = (request) => {
    const parts = parseMultipart(request.raw, request.contentType);
    if (!request.query.uploadType || request.query.uploadType !== 'multipart' || !parts) return driveError(400, 'Multipart upload required', 'badRequest');
    let metadata;
    try {
      metadata = JSON.parse(parts[0].content.toString('utf8'));
    } catch {
      return driveError(400, 'Bad metadata', 'badRequest');
    }
    const id = `1SHEETS-fake-created-${++state.sequence}`;
    request.driveMetadata = metadata;
    if (metadata.mimeType !== NATIVE_SHEET_MIME) {
      files.set(id, { kind: 'drive#file', id, name: metadata.name, mimeType: parts[1].headers.match(/content-type:\s*([^\r\n]+)/i)?.[1] ?? 'application/octet-stream', trashed: false });
      return json(200, projectFile(files.get(id), request.query.fields));
    }
    const book = XLSX.read(parts[1].content);
    const converted = applyConversion(
      book.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: null }) })),
      conversion,
    );
    const tabConfigs = Object.fromEntries(converted.map((tab) => [tab.name, { header: tab.rows[0] ?? [], rows: tab.rows.slice(1) }]));
    addSpreadsheet(id, tabConfigs, { bind: false });
    spreadsheets.get(id).title = metadata.name;
    files.get(id).name = metadata.name;
    return json(200, projectFile(files.get(id), request.query.fields));
  };

  // ------------------------------------------------------------ dispatch

  const handle = async (url, init) => {
    const request = classify(url, init);
    requests.push(request);
    const hookIndex = hooks.findIndex((hook) => hook.route === request.route && !hook.done);
    if (hookIndex >= 0) {
      hooks[hookIndex].done = true;
      hooks[hookIndex].mutate(api);
    }
    const override = overrides.find((o) => o.route === request.route && o.remaining > 0 && o.when(request));
    if (override) {
      override.remaining -= 1;
      override.calls += 1;
      return override.respond(request, override.calls);
    }
    if (request.route === 'token') {
      const response = await auth.handle(url, init);
      if (response.status === 200) state.invalid = false;
      return response;
    }
    const authorised = !state.invalid && request.authorization === `Bearer ${auth.accessToken()}`;
    if (!authorised) return unauthenticated();
    const sheet = request.id ? spreadsheets.get(request.id) : null;
    let response;
    if (request.route === 'drive-create') response = driveCreate(request);
    else if (request.route === 'drive-get') {
      const file = files.get(request.id);
      response = file ? json(200, projectFile(file, request.query.fields)) : driveNotFound(request.id);
    } else if (request.route === 'drive-delete') {
      response = files.delete(request.id) ? new Response(null, { status: 204 }) : driveNotFound(request.id);
      spreadsheets.delete(request.id);
    } else if (['get', 'values', 'metadata-search', 'batch-update'].includes(request.route)) {
      if (!sheet) response = error(404, 'Requested entity was not found.');
      else if (request.route === 'get') response = json(200, spreadsheetBody(sheet));
      else if (request.route === 'values') {
        try {
          response = json(200, { spreadsheetId: sheet.id, valueRanges: request.ranges.map((text) => valuesFor(sheet, text)) });
        } catch (thrown) {
          if (!(thrown instanceof Invalid)) throw thrown;
          response = error(400, thrown.message);
        }
      } else if (request.route === 'metadata-search') response = json(200, metadataSearch(sheet, request.body));
      else response = batchUpdate(request, sheet);
    } else if (request.route === 'profile') response = scopeInsufficient();
    else response = error(404, 'Not found');
    if (request.route === 'batch-update' && state.dropResponses > 0 && response.status === 200) {
      state.dropResponses -= 1;
      throw new TypeError('fetch failed');
    }
    return response;
  };

  // ------------------------------------------------------------ a human at the keyboard

  const headerOf = (tab) => tab.rows[0]?.cells ?? [];
  const sheetNamed = (id = spreadsheetId) => spreadsheets.get(id);
  const columnOf = (tab, header) => {
    const index = headerOf(tab).indexOf(header);
    if (index < 0) throw new Error(`no header ${header} in ${tab.title}`);
    return index;
  };
  const humanTab = (title, id) => tabOf(sheetNamed(id), title) ?? (() => { throw new Error(`no tab ${title}`); })();

  const api = {
    /** A human types into a cell; `row` is the 0-based sheet row index, `header` the column's header text. */
    humanEditsCell(title, row, header, value) {
      const tab = humanTab(title);
      const column = columnOf(tab, header);
      ensureRows(tab, row + 1);
      while (tab.rows[row].cells.length <= column) tab.rows[row].cells.push(null);
      tab.rows[row].cells[column] = value;
    },
    humanSortsRows(title, header, { descending = false } = {}) {
      const tab = humanTab(title);
      const column = columnOf(tab, header);
      const data = tab.rows.slice(1, usedRowCount(tab));
      data.sort((a, b) => String(a.cells[column] ?? '').localeCompare(String(b.cells[column] ?? '')) * (descending ? -1 : 1));
      tab.rows.splice(1, data.length, ...data);
    },
    humanInsertsRow(title, atIndex, cells) {
      const tab = humanTab(title);
      const header = headerOf(tab);
      tab.rows.splice(atIndex, 0, newRow(Array.isArray(cells) ? cells : header.map((name) => cells[name] ?? null)));
      tab.rowCount += 1;
    },
    humanAppendsRow(title, cells) {
      const tab = humanTab(title);
      const header = headerOf(tab);
      const position = usedRowCount(tab);
      ensureRows(tab, position + 1);
      tab.rows[position] = newRow(Array.isArray(cells) ? cells : header.map((name) => cells[name] ?? null));
    },
    humanRenamesHeader(title, from, to) {
      const tab = humanTab(title);
      tab.rows[0].cells[columnOf(tab, from)] = to;
    },
    humanDeletesColumn(title, header) {
      const tab = humanTab(title);
      const column = columnOf(tab, header);
      for (const row of tab.rows) {
        row.cells.splice(column, 1);
        row.formats = Object.fromEntries(Object.entries(row.formats).filter(([index]) => Number(index) !== column).map(([index, value]) => [Number(index) > column ? Number(index) - 1 : index, value]));
      }
      tab.columnCount -= 1;
    },
    humanReordersColumns(title, order) {
      const tab = humanTab(title);
      const header = headerOf(tab);
      const from = order.map((name) => header.indexOf(name));
      if (from.some((index) => index < 0)) throw new Error('reorder names a missing column');
      for (const row of tab.rows) {
        const cells = from.map((index) => row.cells[index] ?? null);
        const formats = Object.fromEntries(from.map((index, target) => [target, row.formats[index]]).filter(([, value]) => value !== undefined));
        row.cells = cells;
        row.formats = formats;
      }
    },
    humanAddsColumn(title, header, valuesByRow = []) {
      const tab = humanTab(title);
      const column = headerOf(tab).length;
      if (column >= tab.columnCount) tab.columnCount = column + 1;
      tab.rows[0].cells[column] = header;
      valuesByRow.forEach((value, index) => {
        ensureRows(tab, index + 2);
        while (tab.rows[index + 1].cells.length <= column) tab.rows[index + 1].cells.push(null);
        tab.rows[index + 1].cells[column] = value;
      });
    },
    /** Gives every data row in the column a number format: the fake's stand-in for anything but the value itself. */
    formatColumn(title, header, format) {
      const tab = humanTab(title);
      const column = columnOf(tab, header);
      tab.rows.slice(1).forEach((row) => {
        row.formats[column] = format;
      });
    },
    trash(id = spreadsheetId) {
      files.get(id).trashed = true;
    },
  };

  const cellsOf = (tab) => tab.rows.slice(0, usedRowCount(tab)).map((row) => row.cells.map((cell) => (isBlank(cell) ? null : cell)));

  return {
    handle,
    requests,
    spreadsheetId,
    ...api,
    /** Answer `route` with `respond(request, callNumber)` for the next `times` matching calls. Token overrides reach the token endpoint. */
    override: (route, respond, { times = Number.POSITIVE_INFINITY, when = () => true } = {}) => {
      if (route === 'token') auth.override('token', respond, { times, when });
      else overrides.push({ route, respond, remaining: times, when, calls: 0 });
    },
    /** Runs `mutate(fake)` immediately before the next request to `route` is handled: a human acting between two calls. */
    beforeNext: (route, mutate) => {
      hooks.push({ route, mutate, done: false });
    },
    /** The next batchUpdate treats its `index`th request as invalid, as Google would for one bad request. */
    rejectRequestAt: (index) => {
      state.failNextBatchAt = index;
    },
    /** The next `times` batchUpdates are applied, then the response is lost. */
    dropResponseAfterApplying: (times = 1) => {
      state.dropResponses = times;
    },
    revokeRefreshToken: () => auth.revokeRefreshToken(),
    invalidateAccessToken: () => {
      state.invalid = true;
    },
    accessToken: () => auth.accessToken(),
    requestsTo: (route) => requests.filter((request) => request.route === route),
    tokenRequests: () => requests.filter((request) => request.route === 'token'),
    /** Every request that could change anything, judged by route alone (independent of the production classifier). */
    writeRequests: () => requests.filter((request) => WRITE_ROUTES.includes(request.route) || (request.route === 'unknown' && request.method !== 'GET')),
    apiRequests: () => requests.filter((request) => request.route !== 'token'),
    batchRequestTypes: () => requests.filter((request) => request.route === 'batch-update').flatMap((request) => request.requestTypes),
    driveCreates: () => requests.filter((request) => request.route === 'drive-create'),
    files: () => [...files.values()].map((file) => ({ ...file })),
    /** Everything a person could see in the Sheet: per tab the cells, the row-key metadata by row, and the grid size. */
    snapshot: (id = spreadsheetId) => {
      const sheet = sheetNamed(id);
      return {
        tabOrder: sheet.tabs.map((tab) => tab.title),
        tabs: Object.fromEntries(
          sheet.tabs.map((tab) => [
            tab.title,
            {
              cells: cellsOf(tab),
              metadata: tab.rows.flatMap((row, rowIndex) => row.meta.map((meta) => ({ rowIndex, key: meta.key, value: meta.value }))),
              grid: { rowCount: tab.rowCount, columnCount: tab.columnCount },
              formats: tab.rows.map((row) => ({ ...row.formats })),
            },
          ]),
        ),
      };
    },
    formatAt: (title, rowIndex, header, id = spreadsheetId) => {
      const tab = tabOf(sheetNamed(id), title);
      return tab.rows[rowIndex]?.formats[columnOf(tab, header)];
    },
  };
}

// ---------------------------------------------------------------- the fake behind a real socket

/** Binary-safe (the Drive upload carries an .xlsx), loopback-only. A handler that throws drops the connection. */
export async function startLoopbackFake(fake) {
  const server = createServer((incoming, outgoing) => {
    const chunks = [];
    incoming.on('data', (chunk) => chunks.push(chunk));
    incoming.on('end', async () => {
      try {
        const port = server.address().port;
        const body = Buffer.concat(chunks);
        const response = await fake.handle(`http://127.0.0.1:${port}${incoming.url}`, {
          method: incoming.method,
          headers: incoming.headers,
          body: body.length > 0 ? body : undefined,
        });
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        incoming.socket.destroy();
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function withLoopbackFake(fake, action) {
  const server = await startLoopbackFake(fake);
  try {
    return await action(server.baseUrl);
  } finally {
    await server.close();
  }
}
