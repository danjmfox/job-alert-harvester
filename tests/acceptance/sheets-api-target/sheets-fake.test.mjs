// @contract-shape:pure-function
// The fake is test infrastructure and the RED classification leans on it, so its own behaviour is pinned here
// (active, not pending): what it models, and the ledger entries it stands behind. It proves nothing about Google.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSheetsFake, forbiddenFor, rateLimited, withLoopbackFake, NATIVE_SHEET_MIME, REAL_ROW_KEY_METADATA } from './support/sheets-fake.mjs';
import { GOOGLE_ENDPOINTS, SHEETS_SENTINEL, SPREADSHEET_ID, aTracker, aTrackedJob, aWorkbookBytes, tabRows } from './support/sheets-domain-types.mjs';

const LIVE = JSON.parse(readFileSync(new URL('../../../docs/feature/sheets-api-target/deliver/live-fixtures.json', import.meta.url), 'utf8')).bodies;

const bearer = (fake) => ({ authorization: `Bearer ${fake.accessToken() ?? ''}` });
const issued = async (fake) => {
  await fake.handle(GOOGLE_ENDPOINTS.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: SHEETS_SENTINEL.refreshToken, client_secret: 'GOCSPX-SENTINEL-client-secret-4b1e' }).toString(),
  });
  return { authorization: `Bearer ${fake.accessToken()}` };
};
const post = (fake, path, body, headers) => fake.handle(`${GOOGLE_ENDPOINTS.sheetsBase}${path}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = (fake, path, headers, base = GOOGLE_ENDPOINTS.sheetsBase) => fake.handle(`${base}${path}`, { method: 'GET', headers });
const batch = (fake, headers, requests) => post(fake, `/spreadsheets/${SPREADSHEET_ID}:batchUpdate`, { requests }, headers);

const isMarker = (item) => typeof item === 'string' && /^<\.\.\.\d+ more/.test(item);
const keyPaths = (value, prefix = '') => {
  if (Array.isArray(value)) {
    const first = value.find((item) => !isMarker(item));
    return first === undefined ? [`${prefix}[]`] : keyPaths(first, `${prefix}[]`);
  }
  if (value !== null && typeof value === 'object' && Object.keys(value).length > 0) return Object.entries(value).flatMap(([key, item]) => keyPaths(item, prefix === '' ? key : `${prefix}.${key}`));
  return [prefix];
};
const divergence = (captured, produced) => {
  const capturedPaths = new Set(keyPaths(captured));
  const producedPaths = new Set(keyPaths(produced));
  return { missing: [...capturedPaths].filter((path) => !producedPaths.has(path)).sort(), extra: [...producedPaths].filter((path) => !capturedPaths.has(path)).sort() };
};

const twoJobs = () => aTracker({ jobs: [aTrackedJob('1', { Status: 'Applied' }), aTrackedJob('2')] });
const fakeWithJobs = (options = {}) => createSheetsFake({ tabs: twoJobs(), ...options });

describe('the sheets fake models the Sheet a person sees', () => {
  it('refuses a call with no bearer token, and serves the token endpoint with drive.file', async () => {
    const fake = fakeWithJobs();
    expect((await get(fake, `/spreadsheets/${SPREADSHEET_ID}`, {})).status).toBe(401);
    const headers = await issued(fake);
    expect((await get(fake, `/spreadsheets/${SPREADSHEET_ID}`, headers)).status).toBe(200);
    expect(fake.tokenRequests()).toHaveLength(1);
  });

  it('answers spreadsheets.get with tab ids and grid sizes, and values:batchGet with a used range that omits `values` when empty', async () => {
    const fake = fakeWithJobs();
    const headers = await issued(fake);
    const sheet = await (await get(fake, `/spreadsheets/${SPREADSHEET_ID}`, headers)).json();
    expect(sheet.sheets[0].properties).toMatchObject({ title: 'Jobs', sheetId: 1, gridProperties: { rowCount: 1000, columnCount: 26 } });
    const ranges = new URLSearchParams([['ranges', 'Jobs!1:1'], ['ranges', "'Jobs'"]]);
    const values = await (await get(fake, `/spreadsheets/${SPREADSHEET_ID}/values:batchGet?${ranges}`, headers)).json();
    expect(values.valueRanges[0].values).toHaveLength(1);
    expect(values.valueRanges[1].values).toHaveLength(3);
    const empty = createSheetsFake({ tabs: { Jobs: { header: [], rows: [] } } });
    const emptyHeaders = await issued(empty);
    const none = await (await get(empty, `/spreadsheets/${SPREADSHEET_ID}/values:batchGet?ranges=Jobs`, emptyHeaders)).json();
    expect(none.valueRanges[0]).not.toHaveProperty('values');
  });

  it('applies a batch in one piece, and applies nothing when one request is invalid (L03)', async () => {
    const fake = fakeWithJobs();
    const headers = await issued(fake);
    const before = JSON.stringify(fake.snapshot());
    const good = { updateCells: { start: { sheetId: 1, rowIndex: 1, columnIndex: 0 }, fields: 'userEnteredValue', rows: [{ values: [{ userEnteredValue: { stringValue: 'changed' } }] }] } };
    const bad = { updateCells: { start: { sheetId: 99, rowIndex: 0, columnIndex: 0 }, fields: 'userEnteredValue', rows: [{ values: [{}] }] } };
    expect((await batch(fake, headers, [good, bad])).status).toBe(400);
    expect(JSON.stringify(fake.snapshot())).toBe(before);
    expect((await batch(fake, headers, [good])).status).toBe(200);
    expect(fake.snapshot().tabs.Jobs.cells[1][0]).toBe('changed');
  });

  it('rejects a write beyond the grid columns until appendDimension makes room (L07), and never writes a formula (L15)', async () => {
    const fake = fakeWithJobs({ grid: 'tight' });
    const headers = await issued(fake);
    const width = fake.snapshot().tabs.Jobs.grid.columnCount;
    const header = (text) => ({ updateCells: { start: { sheetId: 1, rowIndex: 0, columnIndex: width }, fields: 'userEnteredValue', rows: [{ values: [{ userEnteredValue: { stringValue: text } }] }] } });
    expect((await batch(fake, headers, [header('New')])).status).toBe(400);
    expect((await batch(fake, headers, [{ appendDimension: { sheetId: 1, dimension: 'COLUMNS', length: 1 } }, header('New')])).status).toBe(200);
    const formula = { updateCells: { start: { sheetId: 1, rowIndex: 1, columnIndex: 0 }, fields: 'userEnteredValue', rows: [{ values: [{ userEnteredValue: { formulaValue: '=1+1' } }] }] } };
    expect((await batch(fake, headers, [formula])).status).toBe(400);
    const literal = { updateCells: { start: { sheetId: 1, rowIndex: 1, columnIndex: 0 }, fields: 'userEnteredValue', rows: [{ values: [{ userEnteredValue: { stringValue: '=1+1' } }] }] } };
    expect((await batch(fake, headers, [literal])).status).toBe(200);
    expect(fake.snapshot().tabs.Jobs.cells[1][0]).toBe('=1+1');
  });

  it('keeps a cell format under fields=userEnteredValue and resets it under * (L08)', async () => {
    const fake = fakeWithJobs();
    fake.formatColumn('Jobs', 'Job', '0.00');
    const headers = await issued(fake);
    const column = fake.snapshot().tabs.Jobs.cells[0].indexOf('Job');
    const write = (fields) => ({ updateCells: { start: { sheetId: 1, rowIndex: 1, columnIndex: column }, fields, rows: [{ values: [{ userEnteredValue: { stringValue: 'x' } }] }] } });
    await batch(fake, headers, [write('userEnteredValue')]);
    expect(fake.formatAt('Jobs', 1, 'Job')).toBe('0.00');
    await batch(fake, headers, [write('*')]);
    expect(fake.formatAt('Jobs', 1, 'Job')).toBeUndefined();
  });

  it('appends rows after the last row holding data, and creates a tab with a chosen id (L14, L17)', async () => {
    const fake = fakeWithJobs();
    const headers = await issued(fake);
    fake.humanAppendsRow('Jobs', { 'Job': 'typed by a person' });
    const append = { appendCells: { sheetId: 1, fields: 'userEnteredValue', rows: [{ values: [{ userEnteredValue: { stringValue: 'linkedin:9' } }] }] } };
    const sheet = { addSheet: { properties: { title: 'Companies', sheetId: 7 } } };
    expect((await batch(fake, headers, [append, sheet])).status).toBe(200);
    const cells = fake.snapshot().tabs.Jobs.cells;
    expect(cells.at(-1)[0]).toBe('linkedin:9');
    expect(cells.at(-2)[cells[0].indexOf('Job')]).toBe('typed by a person');
    expect(fake.snapshot().tabOrder).toEqual(['Jobs', 'Companies']);
    expect((await batch(fake, headers, [sheet])).status).toBe(400);
  });

  it('binds row-key metadata that follows its row through a human sort and an insert (spike-proven, L20)', async () => {
    const fake = fakeWithJobs();
    const headers = await issued(fake);
    const search = async () => (await (await post(fake, `/spreadsheets/${SPREADSHEET_ID}/developerMetadata:search`, { dataFilters: [{ developerMetadataLookup: { metadataKey: REAL_ROW_KEY_METADATA } }] }, headers)).json()).matchedDeveloperMetadata;
    const rowOf = (matches, value) => matches.find((entry) => entry.developerMetadata.metadataValue === value).developerMetadata.location.dimensionRange.startIndex;
    expect(rowOf(await search(), 'linkedin:2')).toBe(2);
    fake.humanSortsRows('Jobs', 'Dedup Key', { descending: true });
    expect(rowOf(await search(), 'linkedin:2')).toBe(1);
    fake.humanInsertsRow('Jobs', 1, { 'Dedup Key': 'linkedin:inserted' });
    expect(rowOf(await search(), 'linkedin:2')).toBe(2);
  });

  it('lets a scenario act between two calls, reject the nth request, and lose a response after applying (L03)', async () => {
    const fake = fakeWithJobs();
    const headers = await issued(fake);
    fake.beforeNext('get', (human) => human.humanEditsCell('Jobs', 1, 'Status', 'Interview'));
    await get(fake, `/spreadsheets/${SPREADSHEET_ID}`, headers);
    expect(tabRows(fake.snapshot(), 'Jobs').rows[0].Status).toBe('Interview');
    const write = (text) => ({ updateCells: { start: { sheetId: 1, rowIndex: 1, columnIndex: 0 }, fields: 'userEnteredValue', rows: [{ values: [{ userEnteredValue: { stringValue: text } }] }] } });
    fake.rejectRequestAt(1);
    expect((await batch(fake, headers, [write('a'), write('b')])).status).toBe(400);
    fake.dropResponseAfterApplying();
    await expect(batch(fake, headers, [write('kept')])).rejects.toThrow('fetch failed');
    expect(fake.snapshot().tabs.Jobs.cells[1][0]).toBe('kept');
    expect(fake.writeRequests()).toHaveLength(2);
  });

  it('answers rate limits, authorisation failures and scripted overrides ahead of the auth check', async () => {
    const fake = fakeWithJobs();
    fake.override('get', () => rateLimited({ retryAfter: 2 }), { times: 1 });
    fake.override('get', () => forbiddenFor('forbidden'), { times: 1 });
    const first = await get(fake, `/spreadsheets/${SPREADSHEET_ID}`, {});
    expect([first.status, first.headers.get('retry-after')]).toEqual([429, '2']);
    expect((await get(fake, `/spreadsheets/${SPREADSHEET_ID}`, {})).status).toBe(403);
    expect((await get(fake, `/spreadsheets/${SPREADSHEET_ID}`, {})).status).toBe(401);
  });

  it('converts an uploaded workbook into a native Sheet, reports trashed, and deletes only by id (spike-proven, L20)', async () => {
    const fake = createSheetsFake();
    await withLoopbackFake(fake, async (baseUrl) => {
      const tokenResponse = await fetch(`${baseUrl}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: SHEETS_SENTINEL.refreshToken, client_secret: 'GOCSPX-SENTINEL-client-secret-4b1e' }),
      });
      const headers = { authorization: `Bearer ${(await tokenResponse.json()).access_token}` };
      const boundary = 'fake-boundary-1';
      const metadata = JSON.stringify({ name: 'Job tracker', mimeType: NATIVE_SHEET_MIME });
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
        aWorkbookBytes(twoJobs()),
        Buffer.from(`\r\n--${boundary}--`),
      ]);
      const created = await (await fetch(`${baseUrl}/upload/drive/v3/files?uploadType=multipart`, { method: 'POST', headers: { ...headers, 'content-type': `multipart/related; boundary=${boundary}` }, body })).json();
      expect(created.mimeType).toBe(NATIVE_SHEET_MIME);
      expect(tabRows(fake.snapshot(created.id), 'Jobs').rows.map((row) => row['Dedup Key'])).toEqual(['linkedin:1', 'linkedin:2']);
      expect(await (await fetch(`${baseUrl}/drive/v3/files/${created.id}?fields=trashed`, { headers })).json()).toEqual({ trashed: false });
      expect((await fetch(`${baseUrl}/drive/v3/files/${created.id}`, { method: 'DELETE', headers })).status).toBe(204);
      expect(fake.files()).toEqual([]);
    });
    expect(fake.writeRequests().map((request) => request.route)).toEqual(['drive-create', 'drive-delete']);
  });

  it('models Drive conversion that loses data, for the import fidelity check (L02, L19)', async () => {
    const fake = createSheetsFake({ conversion: 'drops-last-data-row' });
    const headers = await issued(fake);
    const boundary = 'b2';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ name: 'x', mimeType: NATIVE_SHEET_MIME })}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
      aWorkbookBytes(twoJobs()),
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const created = await (await fake.handle(`${GOOGLE_ENDPOINTS.driveUploadBase}/files?uploadType=multipart`, { method: 'POST', headers: { ...headers, 'content-type': `multipart/related; boundary=${boundary}` }, body })).json();
    expect(tabRows(fake.snapshot(created.id), 'Jobs').rows).toHaveLength(1);
  });

  it('refuses the drive.file profile call as Google does, and has no values-API write route (L04, L10)', async () => {
    const fake = fakeWithJobs();
    const headers = await issued(fake);
    const profile = await get(fake, '/users/me/profile', headers, 'https://gmail.googleapis.com/gmail/v1');
    expect(profile.status).toBe(403);
    expect(await profile.json()).toEqual(LIVE['gmail.profile'].body);
    expect((await post(fake, `/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate`, { data: [] }, headers)).status).toBe(404);
    expect(fake.writeRequests().map((request) => request.route)).toEqual(['unknown']);
  });

  it('accepts a second metadata binding with the same key on one row, and a binding on an empty row inside the grid (L16)', async () => {
    const fake = fakeWithJobs();
    const headers = await issued(fake);
    const bind = (rowIndex, value) => ({ createDeveloperMetadata: { developerMetadata: { metadataKey: REAL_ROW_KEY_METADATA, metadataValue: value, location: { dimensionRange: { sheetId: 1, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 } }, visibility: 'DOCUMENT' } } });
    expect((await batch(fake, headers, [bind(2, 'second-on-row-2')])).status).toBe(200);
    expect((await batch(fake, headers, [bind(500, 'on-an-empty-row')])).status).toBe(200);
    expect((await batch(fake, headers, [bind(5000, 'beyond-the-grid')])).status).toBe(400);
    const onRowTwo = fake.snapshot().tabs.Jobs.metadata.filter((meta) => meta.rowIndex === 2).map((meta) => meta.value);
    expect(onRowTwo).toEqual(['linkedin:2', 'second-on-row-2']);
    expect(fake.snapshot().tabs.Jobs.metadata.find((meta) => meta.rowIndex === 500).value).toBe('on-an-empty-row');
    const search = await (await post(fake, `/spreadsheets/${SPREADSHEET_ID}/developerMetadata:search`, { dataFilters: [{ developerMetadataLookup: { metadataKey: REAL_ROW_KEY_METADATA } }] }, headers)).json();
    expect(search.matchedDeveloperMetadata.filter((entry) => entry.developerMetadata.location.dimensionRange.startIndex === 2)).toHaveLength(2);
  });

  it('answers a quota 429 with the real body and no Retry-After unless the scenario asks (L12, L13)', async () => {
    const bare = rateLimited();
    expect(bare.status).toBe(429);
    expect(bare.headers.has('retry-after')).toBe(false);
    expect(rateLimited({ retryAfter: 3 }).headers.get('retry-after')).toBe('3');
    const { error } = await bare.json();
    expect([error.code, error.status]).toEqual([429, 'RESOURCE_EXHAUSTED']);
    expect(error.details[0]).toMatchObject({ reason: 'RATE_LIMIT_EXCEEDED', metadata: { quota_limit: 'WriteRequestsPerMinutePerUser', quota_limit_value: '60' } });
  });

  it('answers a file this app never created with 404, in the real Sheets and Drive shapes (L12)', async () => {
    const fake = fakeWithJobs();
    const headers = await issued(fake);
    const sheets = await get(fake, '/spreadsheets/1NeverCreatedByThisApp', headers);
    expect(sheets.status).toBe(404);
    expect(await sheets.json()).toEqual(LIVE['error.sheets-not-granted'].body);
    const drive = await get(fake, '/files/1NeverCreatedByThisApp?fields=id', headers, GOOGLE_ENDPOINTS.driveBase);
    expect(drive.status).toBe(404);
    const driveBody = await drive.json();
    expect(driveBody.error.message).toBe('File not found: 1NeverCreatedByThisApp.');
    expect(keyPaths(driveBody)).toEqual(keyPaths(LIVE['error.drive-not-granted'].body));
    expect(driveBody.error.errors[0]).toMatchObject({ reason: 'notFound', domain: 'global', location: 'fileId', locationType: 'parameter' });
  });

  it('answers an invalid batch with the real 400 envelope, with no errors array (L03, L19)', async () => {
    const fake = fakeWithJobs();
    const headers = await issued(fake);
    const bad = { updateCells: { start: { sheetId: 999999, rowIndex: 0, columnIndex: 0 }, fields: 'userEnteredValue', rows: [{ values: [{ userEnteredValue: { stringValue: 'x' } }] }] } };
    const response = await batch(fake, headers, [bad, bad]);
    expect(response.status).toBe(400);
    expect(keyPaths(await response.json())).toEqual(keyPaths(LIVE['batchUpdate.invalid'].body));
  });

  it('answers each captured call in the shape Google did, apart from the bodies it declares not modelled (L19)', async () => {
    const fake = fakeWithJobs();
    const headers = await issued(fake);
    const boundary = 'shape-boundary';
    const upload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ name: 'x', mimeType: NATIVE_SHEET_MIME })}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
      aWorkbookBytes(twoJobs()),
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const created = await fake.handle(`${GOOGLE_ENDPOINTS.driveUploadBase}/files?uploadType=multipart&fields=id,name,mimeType`, { method: 'POST', headers: { ...headers, 'content-type': `multipart/related; boundary=${boundary}` }, body: upload });
    const createdBody = await created.json();
    const addSheet = { addSheet: { properties: { title: 'Scratch', sheetId: 7001, gridProperties: { rowCount: 100, columnCount: 30 } } } };
    const answers = {
      'drive.files.create': createdBody,
      'spreadsheets.get': await (await get(fake, `/spreadsheets/${SPREADSHEET_ID}`, headers)).json(),
      'batchUpdate.ok': await (await batch(fake, headers, [addSheet])).json(),
      'values.batchGet': await (await get(fake, `/spreadsheets/${SPREADSHEET_ID}/values:batchGet?ranges=Jobs!A1:H3&majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`, headers)).json(),
      'developerMetadata.search': await (await post(fake, `/spreadsheets/${SPREADSHEET_ID}/developerMetadata:search`, { dataFilters: [{ developerMetadataLookup: { metadataKey: REAL_ROW_KEY_METADATA } }] }, headers)).json(),
      'drive.files.get': await (await get(fake, `/files/${createdBody.id}?fields=trashed`, headers, GOOGLE_ENDPOINTS.driveBase)).json(),
      'error.429': await rateLimited().json(),
    };
    const NOT_MODELLED = { 'spreadsheets.get': ['properties.defaultFormat', 'properties.spreadsheetTheme'] };
    for (const [name, answer] of Object.entries(answers)) {
      const { missing, extra } = divergence(LIVE[name].body, answer);
      const unmodelled = NOT_MODELLED[name] ?? [];
      expect({ name, extra }).toEqual({ name, extra: [] });
      expect({ name, missing: missing.filter((path) => !unmodelled.some((prefix) => path.startsWith(prefix))) }).toEqual({ name, missing: [] });
    }
    expect(answers['batchUpdate.ok'].replies[0].addSheet.properties).toMatchObject({ sheetId: 7001, title: 'Scratch', index: 1, sheetType: 'GRID', gridProperties: { rowCount: 100, columnCount: 30 } });
    expect(answers['batchUpdate.ok'].commentUpdateState).toBe('NO_UPDATES_REQUESTED');
  });
});
