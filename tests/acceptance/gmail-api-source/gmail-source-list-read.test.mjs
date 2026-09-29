// @contract-shape:bounded-change
// MessageSource over Gmail: list a UTC day (paginated to exhaustion), read a message
// (format=full), retry only what is worth retrying. `list`, `read` and the cache's
// own view are three independent calls, so the source cannot self-certify a window.
// Adapter level: an injected fetch over the fake; sleep and jitter are injected.
import { describe, expect, it } from 'vitest';
import { gmailWindowQuery } from '../../../src/core/gmail-query.mjs';
import {
  aGmailAlert,
  aGmailResource,
  aGmailSource,
  aMessage,
  refusalOfAsync,
  cachedRecordOf,
  noSecretsIn,
  GmailRefusal,
  SENDER,
  MAX_ATTEMPTS,
} from './support/gmail-domain-types.mjs';
import { createGmailFake, forbiddenFor, json, rateLimited, serverError } from './support/gmail-fake.mjs';

const DAY = { from: '2026-09-01', to: '2026-09-01' };
const at = (time, id) => aGmailAlert({ id, date: `2026-09-01T${time}Z` });
const ids = (listing) => listing.map((entry) => entry.id).sort();

describe('list: every message Gmail reports for one UTC day', () => {
  it('asks for exactly that day from that sender and returns id and date for each message', async () => {
    const fake = createGmailFake({ messages: [at('09:48:30', 'a'), at('17:02:10', 'b'), aGmailAlert({ id: 'other-day', date: '2026-09-02T09:00:00Z' })] });
    const { source } = aGmailSource({ fake });

    const listing = await source.list(DAY);

    expect(listing).toHaveLength(2);
    expect(listing).toEqual(expect.arrayContaining([
      { id: 'a', date: '2026-09-01T09:48:30Z' },
      { id: 'b', date: '2026-09-01T17:02:10Z' },
    ]));
    const [request] = fake.requestsTo('list');
    expect(request.query.q).toBe(gmailWindowQuery(DAY, { sender: SENDER }));
    expect(request.query.maxResults).toBe('500');
    expect(request.query.includeSpamTrash ?? 'false').toBe('false');
  });

  it('follows the page token to exhaustion', async () => {
    const fake = createGmailFake({ pageSize: 2, messages: ['a', 'b', 'c', 'd', 'e'].map((id, n) => at(`0${n}:00:00`, id)) });
    const { source } = aGmailSource({ fake });

    expect(ids(await source.list(DAY))).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(fake.requestsTo('list')).toHaveLength(3);
  });

  it('lists an id that appears on two pages once', async () => {
    const fake = createGmailFake({ pageSize: 2, messages: ['a', 'b', 'c', 'd', 'e'].map((id, n) => at(`0${n}:00:00`, id)) });
    fake.override('list', () => json(200, { messages: [{ id: 'd', threadId: 'd' }, { id: 'c', threadId: 'c' }], nextPageToken: 'page-4', resultSizeEstimate: 5 }), {
      when: (request) => request.query.pageToken === 'page-2',
    });
    const { source } = aGmailSource({ fake });

    const listing = await source.list(DAY);

    expect(listing.filter((entry) => entry.id === 'd')).toHaveLength(1);
  });

  it('an empty day is a valid empty listing when the envelope says so', async () => {
    const fake = createGmailFake({ messages: [aGmailAlert({ id: 'other-day', date: '2026-09-02T09:00:00Z' })] });
    const { source } = aGmailSource({ fake });

    await expect(source.list(DAY)).resolves.toEqual([]);
  });

  it('@error an answer with no size estimate is never read as an empty day', async () => {
    const fake = createGmailFake({ messages: [at('09:00:00', 'a')] });
    fake.override('list', () => json(200, {}));
    const { source } = aGmailSource({ fake });

    expect((await refusalOfAsync(() => source.list(DAY))).code).toBe(GmailRefusal.LIST_MALFORMED);
  });

  it('@error a page that fails part-way refuses the whole listing rather than returning a prefix', async () => {
    const fake = createGmailFake({ pageSize: 2, messages: ['a', 'b', 'c', 'd'].map((id, n) => at(`0${n}:00:00`, id)) });
    fake.override('list', () => serverError(503), { when: (request) => request.query.pageToken === 'page-2' });
    const { source } = aGmailSource({ fake });

    expect((await refusalOfAsync(() => source.list(DAY))).code).toBe(GmailRefusal.LIST_INCOMPLETE);
  });

  it('@error a page token that repeats refuses the listing rather than looping', async () => {
    const fake = createGmailFake({ messages: [at('09:00:00', 'a')] });
    fake.override('list', () => json(200, { messages: [{ id: 'a', threadId: 'a' }], nextPageToken: 'same', resultSizeEstimate: 1 }));
    const { source } = aGmailSource({ fake });

    expect((await refusalOfAsync(() => source.list(DAY))).code).toBe(GmailRefusal.LIST_INCOMPLETE);
    expect(fake.requestsTo('list').length).toBeLessThanOrEqual(3);
  });

  it('the size estimate is never used as a count', async () => {
    const lyingLow = createGmailFake({ messages: [at('09:00:00', 'a'), at('10:00:00', 'b')], estimate: 0 });
    const lyingHigh = createGmailFake({ messages: [at('09:00:00', 'a'), at('10:00:00', 'b')], estimate: 999 });

    expect(ids(await aGmailSource({ fake: lyingLow }).source.list(DAY))).toEqual(['a', 'b']);
    expect(ids(await aGmailSource({ fake: lyingHigh }).source.list(DAY))).toEqual(['a', 'b']);
  });

  it('@error a message dated outside the requested day is refused, never silently listed', async () => {
    const fake = createGmailFake({ honourQuery: false, messages: [aGmailAlert({ id: 'drift', date: '2026-08-31T23:59:59Z' })] });
    const { source } = aGmailSource({ fake });

    expect((await refusalOfAsync(() => source.list(DAY))).code).toBe(GmailRefusal.OUTSIDE_WINDOW);
  });
});

describe('read: one message as the cache record shape', () => {
  it('asks for the full format and returns the spill-shaped message with a bare sender address', async () => {
    const fake = createGmailFake({ messages: [at('09:48:30', 'a')] });
    const { source } = aGmailSource({ fake });

    const message = await source.read('a');

    expect(message).toEqual(cachedRecordOf({ id: 'a', date: '2026-09-01T09:48:30Z' }));
    expect(fake.requestsTo('get')[0].format).toBe('full');
  });

  it('a message Gmail no longer has reads as null, for the loop to refuse as unreadable', async () => {
    const { source } = aGmailSource({ fake: createGmailFake({ messages: [] }) });

    await expect(source.read('gone')).resolves.toBeNull();
  });

  it('@error refuses a resource whose id is not the one requested', async () => {
    const fake = createGmailFake({ messages: [at('09:48:30', 'a')] });
    fake.override('get', () => json(200, at('09:48:30', 'someone-elses')));
    const { source } = aGmailSource({ fake });

    expect((await refusalOfAsync(() => source.read('a'))).code).toBe(GmailRefusal.ID_MISMATCH);
  });

  it('@error refuses a message with no plain-text body, naming the id', async () => {
    const htmlOnly = aGmailResource({ record: aMessage({ id: 'html-only', date: '2026-09-01T09:00:00Z' }), plaintext: false });
    const { source } = aGmailSource({ fake: createGmailFake({ messages: [htmlOnly] }) });

    const refusal = await refusalOfAsync(() => source.read('html-only'));

    expect(refusal.code).toBe(GmailRefusal.MISSING_PLAINTEXT_BODY);
    expect(refusal.message).toContain('html-only');
  });
});

describe('retrying what is worth retrying (OQ-3)', () => {
  it('honours Retry-After, then succeeds', async () => {
    const fake = createGmailFake({ messages: [at('09:00:00', 'a')] });
    fake.override('list', () => rateLimited({ retryAfter: 2 }), { times: 1 });
    const { source, sleeps } = aGmailSource({ fake });

    expect(ids(await source.list(DAY))).toEqual(['a']);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(2000);
  });

  it('treats a 403 rate-limit reason like a 429', async () => {
    const fake = createGmailFake({ messages: [at('09:00:00', 'a')] });
    fake.override('list', () => forbiddenFor('rateLimitExceeded'), { times: 1 });
    const { source, sleeps } = aGmailSource({ fake });

    expect(ids(await source.list(DAY))).toEqual(['a']);
    expect(sleeps).toHaveLength(1);
  });

  it('@error refuses with the server-error name after three attempts on a persistent 503, sleeping between them', async () => {
    const fake = createGmailFake({ messages: [at('09:00:00', 'a')] });
    fake.override('get', () => serverError(503));
    const { source, sleeps } = aGmailSource({ fake });

    const refusal = await refusalOfAsync(() => source.read('a'));

    expect(refusal.code).toBe(GmailRefusal.SERVER_ERROR);
    expect(fake.requestsTo('get')).toHaveLength(MAX_ATTEMPTS);
    expect(sleeps).toHaveLength(MAX_ATTEMPTS - 1);
  });

  it('@error refuses quota-exhausted after three attempts on a persistent 429', async () => {
    const fake = createGmailFake({ messages: [at('09:00:00', 'a')] });
    fake.override('list', () => rateLimited());
    const { source } = aGmailSource({ fake });

    expect((await refusalOfAsync(() => source.list(DAY))).code).toBe(GmailRefusal.QUOTA_EXHAUSTED);
    expect(fake.requestsTo('list')).toHaveLength(MAX_ATTEMPTS);
  });

  it('@error a bad query is refused at once, never retried', async () => {
    const fake = createGmailFake({ messages: [at('09:00:00', 'a')] });
    fake.override('list', () => json(400, { error: { code: 400, message: 'Invalid', errors: [{ reason: 'invalidArgument' }] } }));
    const { source, sleeps } = aGmailSource({ fake });

    expect((await refusalOfAsync(() => source.list(DAY))).code).toBe(GmailRefusal.QUERY_REJECTED);
    expect(fake.requestsTo('list')).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('a token that expires mid-run is refreshed once and the call retried once', async () => {
    const fake = createGmailFake({ messages: [at('09:00:00', 'a')] });
    const { source } = aGmailSource({ fake });
    await source.list(DAY);
    fake.invalidateAccessToken();

    expect(ids(await source.list(DAY))).toEqual(['a']);
    expect(fake.requestsTo('token')).toHaveLength(2);
  });

  it('@error a second 401 after one refresh is refused as unauthorized, not refreshed again', async () => {
    const fake = createGmailFake({ messages: [at('09:00:00', 'a')] });
    fake.override('list', () => json(401, { error: { code: 401, message: 'Invalid Credentials' } }));
    const { source } = aGmailSource({ fake });

    const refusal = await refusalOfAsync(() => source.list(DAY));

    expect(refusal.code).toBe(GmailRefusal.UNAUTHORIZED);
    expect(fake.requestsTo('token')).toHaveLength(2);
    expect(noSecretsIn(refusal.message)).toEqual([]);
  });

  it('the source only ever reads: every Gmail request is a GET', async () => {
    const fake = createGmailFake({ messages: [at('09:00:00', 'a')] });
    const { source } = aGmailSource({ fake });

    await source.probe();
    await source.list(DAY);
    await source.read('a');

    expect(fake.gmailRequests().length).toBeGreaterThan(3);
    expect(fake.gmailRequests().every((request) => request.method === 'GET')).toBe(true);
  });
});
