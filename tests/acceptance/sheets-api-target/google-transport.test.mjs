// @contract-shape:bounded-change
// SD-12: one authorised transport hands adapters two capabilities. The read capability retries by decideRetry and
// cannot send a write; the write capability never replays a write on its own (the adapter re-verifies first, SD-03)
// but does refresh an expired token once. Every request carries the bearer and refuses redirects, so a redirect can
// never carry a token off the machine. Adapter level: an injected fetch over the fake, real credential files.
import { describe, expect, it } from 'vitest';
import {
  DriveRefusal,
  GOOGLE_ENDPOINTS,
  SHEETS_SENTINEL,
  SPREADSHEET_ID,
  SheetsRefusal,
  aTrackerFake,
  aTransport,
  noSecretsIn,
  refusalOfAsync,
} from './support/sheets-domain-types.mjs';
import { forbiddenFor, json, rateLimited, serverError } from './support/sheets-fake.mjs';
import { scenario } from './support/red-gate.mjs';

const SHEET_URL = `${GOOGLE_ENDPOINTS.sheetsBase}/spreadsheets/${SPREADSHEET_ID}`;
const BATCH_URL = `${SHEET_URL}:batchUpdate`;
const aBatch = () => JSON.stringify({ requests: [{ appendDimension: { sheetId: 1, dimension: 'COLUMNS', length: 1 } }] });
const wiredOver = (fake) => aTransport({ fake });
const post = (capability, body = aBatch()) => capability.request(BATCH_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

describe('the read capability (SD-12)', () => {
  scenario('returns the status, headers and parsed body of a read, with the bearer attached and never in the URL', async () => {
    const fake = aTrackerFake();
    const { transport } = wiredOver(fake);

    const response = await transport.read.request(SHEET_URL);

    expect(response.status).toBe(200);
    expect(response.body.spreadsheetId).toBe(SPREADSHEET_ID);
    expect(response.headers.get('content-type')).toContain('json');
    const [request] = fake.requestsTo('get');
    expect(request.authorization).toBe(`Bearer ${SHEETS_SENTINEL.accessToken}`);
    expect(request.path + JSON.stringify(request.query)).not.toContain(SHEETS_SENTINEL.accessToken);
  });

  scenario('@error refreshes an expired token once and repeats the same request with the new one', async () => {
    const fake = aTrackerFake();
    const { transport } = wiredOver(fake);
    await transport.read.request(SHEET_URL);
    fake.invalidateAccessToken();

    const response = await transport.read.request(SHEET_URL);

    expect(response.status).toBe(200);
    expect(fake.tokenRequests()).toHaveLength(2);
    expect(fake.requestsTo('get').map((request) => request.authorization)).toEqual([
      `Bearer ${SHEETS_SENTINEL.accessToken}`,
      `Bearer ${SHEETS_SENTINEL.accessToken}`,
      `Bearer ${SHEETS_SENTINEL.accessTokenRefreshed}`,
    ]);
  });

  scenario('@error a second 401 after the refresh is sheets.unauthorized, with one refresh and no third attempt', async () => {
    const fake = aTrackerFake();
    fake.override('get', () => json(401, { error: { code: 401, message: 'Invalid Credentials' } }));
    const { transport } = wiredOver(fake);

    const refusal = await refusalOfAsync(() => transport.read.request(SHEET_URL));

    expect(refusal.code).toBe(SheetsRefusal.UNAUTHORIZED);
    expect(fake.requestsTo('get')).toHaveLength(2);
    expect(fake.tokenRequests()).toHaveLength(2);
    expect(noSecretsIn(refusal.message)).toEqual([]);
  });

  scenario('@error retries a 429 honouring Retry-After, and succeeds on the third attempt', async () => {
    const fake = aTrackerFake();
    fake.override('get', () => rateLimited({ retryAfter: 2 }), { times: 2 });
    const wired = wiredOver(fake);

    const response = await wired.transport.read.request(SHEET_URL);

    expect(response.status).toBe(200);
    expect(fake.requestsTo('get')).toHaveLength(3);
    expect(wired.sleeps).toHaveLength(2);
    expect(wired.sleeps[0]).toBeGreaterThanOrEqual(2000);
  });

  scenario('@error retries a 403 carrying a rate reason as a 429', async () => {
    const fake = aTrackerFake();
    fake.override('get', () => forbiddenFor('userRateLimitExceeded'), { times: 1 });

    const response = await wiredOver(fake).transport.read.request(SHEET_URL);

    expect(response.status).toBe(200);
    expect(fake.requestsTo('get')).toHaveLength(2);
  });

  scenario('@error names sheets.quota-exhausted after three throttled attempts, and sheets.server-error after three failed ones', async () => {
    const throttled = aTrackerFake();
    throttled.override('get', () => rateLimited());
    const failing = aTrackerFake();
    failing.override('get', () => serverError(503));

    expect((await refusalOfAsync(() => wiredOver(throttled).transport.read.request(SHEET_URL))).code).toBe(SheetsRefusal.QUOTA_EXHAUSTED);
    expect(throttled.requestsTo('get')).toHaveLength(3);
    expect((await refusalOfAsync(() => wiredOver(failing).transport.read.request(SHEET_URL))).code).toBe(SheetsRefusal.SERVER_ERROR);
    expect(failing.requestsTo('get')).toHaveLength(3);
  });

  scenario('@error hands back a 403 authorisation failure and a 404 as they are, after one attempt, for the adapter to name', async () => {
    const forbidden = aTrackerFake();
    forbidden.override('get', () => forbiddenFor('forbidden'));
    const missing = aTrackerFake();
    missing.override('get', () => json(404, { error: { code: 404, message: 'Requested entity was not found.' } }));

    expect((await wiredOver(forbidden).transport.read.request(SHEET_URL)).status).toBe(403);
    expect(forbidden.requestsTo('get')).toHaveLength(1);
    expect((await wiredOver(missing).transport.read.request(SHEET_URL)).status).toBe(404);
  });

  scenario('@error a lost connection reads as status 0 and is retried like a server error, then named sheets.server-error', async () => {
    const fake = aTrackerFake();
    let attempts = 0;
    const lossy = { ...fake, handle: (url, init) => (String(url).includes('/spreadsheets/') ? (attempts += 1, Promise.reject(new TypeError('fetch failed'))) : fake.handle(url, init)) };

    const refusal = await refusalOfAsync(() => aTransport({ fake: lossy }).transport.read.request(SHEET_URL));

    expect(refusal.code).toBe(SheetsRefusal.SERVER_ERROR);
    expect(attempts).toBe(3);
  });

  scenario('@error refuses to send a write-class request at all, and names sheets.write-not-permitted', async () => {
    const fake = aTrackerFake();
    const { transport } = wiredOver(fake);

    const refusal = await refusalOfAsync(() => post(transport.read));

    expect(refusal.code).toBe(SheetsRefusal.WRITE_NOT_PERMITTED);
    expect(fake.writeRequests()).toEqual([]);
    expect(fake.apiRequests()).toEqual([]);
  });

  scenario('sends a metadata search through the read capability, because a search is a read', async () => {
    const fake = aTrackerFake();

    const response = await wiredOver(fake).transport.read.request(`${SHEET_URL}/developerMetadata:search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dataFilters: [{ developerMetadataLookup: { metadataKey: 'harvester.row-key' } }] }) });

    expect(response.status).toBe(200);
    expect(fake.writeRequests()).toEqual([]);
  });
});

describe('the write capability never replays a write on its own', () => {
  scenario('sends the write once and returns the answer', async () => {
    const fake = aTrackerFake();
    const { transport } = wiredOver(fake);

    const response = await post(transport.write);

    expect(response.status).toBe(200);
    expect(fake.requestsTo('batch-update')).toHaveLength(1);
  });

  scenario('@error hands a 429 and a 503 back after ONE attempt: the adapter must re-verify before any second try', async () => {
    for (const answer of [rateLimited({ retryAfter: 1 }), serverError(503)]) {
      const fake = aTrackerFake();
      fake.override('batch-update', () => answer.clone());
      const wired = wiredOver(fake);

      const response = await post(wired.transport.write);

      expect(response.status).toBe(answer.status);
      expect(fake.requestsTo('batch-update')).toHaveLength(1);
      expect(wired.sleeps).toEqual([]);
    }
  });

  scenario('@error a lost response is status 0, reported once and never retried', async () => {
    const fake = aTrackerFake();
    fake.dropResponseAfterApplying();
    const wired = wiredOver(fake);

    const response = await post(wired.transport.write);

    expect(response.status).toBe(0);
    expect(fake.requestsTo('batch-update')).toHaveLength(1);
  });

  scenario('@error an expired token is refreshed once and the same write is sent again, since a 401 means nothing was applied', async () => {
    const fake = aTrackerFake();
    const wired = wiredOver(fake);
    await wired.transport.read.request(SHEET_URL);
    fake.invalidateAccessToken();

    const response = await post(wired.transport.write);

    expect(response.status).toBe(200);
    expect(fake.requestsTo('batch-update')).toHaveLength(2);
    expect(fake.requestsTo('batch-update').map((request) => request.authorization)).toEqual([`Bearer ${SHEETS_SENTINEL.accessToken}`, `Bearer ${SHEETS_SENTINEL.accessTokenRefreshed}`]);
  });
});

describe('every request that carries a bearer refuses redirects (SD-15)', () => {
  scenario('@error passes redirect: error on each bearer-carrying request, reads and writes alike', async () => {
    const fake = aTrackerFake();
    const inits = [];
    const spying = { ...fake, handle: (url, init) => (inits.push(init), fake.handle(url, init)) };
    const { transport } = aTransport({ fake: spying });

    await transport.read.request(SHEET_URL);
    await post(transport.write);

    const bearing = inits.filter((init) => new Headers(init.headers).has('authorization'));
    expect(bearing).toHaveLength(2);
    expect(bearing.every((init) => init.redirect === 'error')).toBe(true);
  });
});

describe('the Drive namespace', () => {
  scenario('@error names drive.quota-exhausted, not a sheets code, when Drive throttles every attempt', async () => {
    const fake = aTrackerFake();
    fake.override('drive-get', () => rateLimited());
    const { transport } = aTransport({ fake, namespace: 'drive' });

    const refusal = await refusalOfAsync(() => transport.read.request(`${GOOGLE_ENDPOINTS.driveBase}/files/${SPREADSHEET_ID}?fields=trashed`));

    expect(refusal.code).toBe(DriveRefusal.QUOTA_EXHAUSTED);
  });
});
