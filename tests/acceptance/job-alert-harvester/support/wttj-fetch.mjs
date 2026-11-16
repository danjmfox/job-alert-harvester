// Vocabulary and builders for the release R2 fetch tests (US-03a coverage integrity, US-03b HTML-only fetch).
//
// A mailbox is the Gmail loopback fake of gmail-api-source/support, holding messages as Gmail serves them: LinkedIn
// alerts with a plain-text part (built by the existing aGmailResource) and Welcome to the Jungle digests with an HTML
// part only (built here from the invented records in fixtures/wttj/). Nothing here calls Gmail, Sheets or any real host.
// `fetch` is run as an operator runs it: a real subprocess in an isolated workspace, with a temp HOME holding fake credentials.

import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { writeJson } from './domain-types.mjs';
import {
  aCredentialHome,
  aGmailResource,
  aMessage,
  cachedMessageIds,
  cachedRecord,
  committedCoverage,
  coverageSummary,
  aWorkspace,
  runHarvestAsync,
  ENDPOINT_OVERRIDE_ENV,
  MAILBOX,
} from '../../gmail-api-source/support/gmail-domain-types.mjs';
import { createGmailFake, withLoopbackFake } from '../../gmail-api-source/support/gmail-fake.mjs';
import { WELCOME_SENDER, welcomeAlertRecord } from './wttj-fixtures.mjs';

export { aMessage, aGmailResource, cachedRecord, createGmailFake };

/** The sources `fetch --source` knows. */
export const Source = Object.freeze({ LINKEDIN: 'linkedin', WELCOME: 'wttj' });

export const WELCOME_FROM_HEADER = `Welcome to the Jungle <${WELCOME_SENDER}>`;

const LEDGER = '.cache/coverage.json';
const CACHE = '.cache/messages';

const encode = (text) => Buffer.from(text, 'utf8').toString('base64url');

const htmlPart = (partId, html) => ({
  partId,
  mimeType: 'text/html',
  filename: '',
  headers: [{ name: 'Content-Type', value: 'text/html; charset="UTF-8"' }],
  body: { size: Buffer.byteLength(html), data: encode(html) },
});

const withHeaders = (part, record, fromHeader) => ({
  ...part,
  headers: [
    ...part.headers,
    { name: 'From', value: fromHeader },
    { name: 'To', value: MAILBOX },
    { name: 'Subject', value: record.subject },
    { name: 'Date', value: new Date(Date.parse(record.date)).toUTCString() },
  ],
});

/**
 * A `users.messages.get?format=full` resource carrying a record that has only an HTML body, as every Welcome to the Jungle
 * message does. `shape` is 'single' (one text/html part, as the spike found) or 'alternative' (a multipart whose only body part
 * is the HTML), optionally nested under `nesting` multipart/mixed levels that also carry an attachment.
 */
export function anHtmlOnlyGmailResource({ record, fromHeader = WELCOME_FROM_HEADER, shape = 'single', nesting = 0 }) {
  let payload =
    shape === 'single'
      ? withHeaders(htmlPart('', record.htmlBody), record, fromHeader)
      : withHeaders({ partId: '', mimeType: 'multipart/alternative', filename: '', headers: [], body: { size: 0 }, parts: [htmlPart('0', record.htmlBody)] }, record, fromHeader);
  for (let level = 0; level < nesting; level += 1) {
    payload = {
      partId: '',
      mimeType: 'multipart/mixed',
      filename: '',
      headers: payload.headers,
      body: { size: 0 },
      parts: [{ partId: `a${level}`, mimeType: 'application/pdf', filename: 'brochure.pdf', body: { size: 9, attachmentId: 'ATTACHMENT' } }, { ...payload, headers: [] }],
    };
  }
  return {
    id: record.id,
    threadId: record.id,
    labelIds: ['UNREAD', 'INBOX'],
    snippet: record.snippet,
    sizeEstimate: record.htmlBody.length,
    historyId: '3362946',
    internalDate: String(Date.parse(record.date)),
    payload,
  };
}

/** The invented digest `alert` (a file name under fixtures/wttj/), re-dated and re-numbered so one fixture can stand for several days. */
export const aDigest = (alert, { id, on } = {}) => {
  const record = welcomeAlertRecord(alert);
  return { ...record, ...(id ? { id } : {}), ...(on ? { date: `${on}T07:10:00Z` } : {}) };
};

/** A LinkedIn alert whose digest is long enough and linked, as the loop keeps it. */
export const aHealthyLinkedInAlert = (id, on, time = '09:00:00') => aMessage({ id, date: `${on}T${time}Z` });

/** A LinkedIn alert whose body is too short to be a whole digest: the screen sets it aside. */
export const aTooShortLinkedInAlert = (id, on, time = '10:00:00') => aMessage({ id, date: `${on}T${time}Z`, plaintextBody: 'Your job alert was cut short.\n' });

/** The text and HTML parts of a resource's body, decoded, for leak checks. */
export function decodedPartsOf(resource) {
  const decode = (data) => Buffer.from(data, 'base64url').toString('utf8');
  const walk = (part) => [...(typeof part.body?.data === 'string' ? [decode(part.body.data)] : []), ...(part.parts ?? []).flatMap(walk)];
  return walk(resource.payload);
}

// ------------------------------------------------------------------ the operator's world

/**
 * An operator with a workspace, credentials and a mailbox. `mailbox` is a list of ready Gmail resources; `ledger` seeds
 * `.cache/coverage.json` (an array of intervals, or null for no file).
 */
export function anOperatorWith({ mailbox, ledger = null }) {
  const workspace = aWorkspace();
  const home = aCredentialHome();
  const fake = createGmailFake({ messages: mailbox });
  if (ledger !== null) writeJson(join(workspace, LEDGER), ledger);
  return { workspace, home, fake, mailbox };
}

/** `harvest fetch --source <source> --from <from> --to <to>`, as the operator runs it, against the operator's mailbox. */
export const operatorFetches = (operator, source, from, to) =>
  withLoopbackFake(operator.fake, (baseUrl) =>
    runHarvestAsync(['fetch', '--source', source, '--from', from, '--to', to], {
      cwd: operator.workspace,
      env: { HOME: operator.home.home, [ENDPOINT_OVERRIDE_ENV]: baseUrl },
    }),
  );

/** The ledger's intervals for one source, as `{ source, from, to, messageCount }` (completedAt is the clock's, so never compared). */
export const coverageOf = (operator, source) => coverageSummary(committedCoverage(join(operator.workspace, LEDGER)).filter((interval) => interval.source === source));

/** The full ledger entries for one source, completedAt included, for "these entries did not move". */
export const ledgerEntriesOf = (operator, source) => committedCoverage(join(operator.workspace, LEDGER)).filter((interval) => interval.source === source);

export const cachedIdsOf = (operator) => cachedMessageIds(join(operator.workspace, CACHE));

/** The cached record for `id` (months are shards of the message's own date). */
export const cachedRecordOf = (operator, record) => cachedRecord(operator.workspace, record.id, record.date.slice(0, 7));

/** What Dan can observe of the cache and the ledger after a fetch: the ids cached and each source's whole ledger entries. */
export const observedFetch = (operator) => ({
  'cache.messageIds': cachedIdsOf(operator),
  'ledger.linkedin': ledgerEntriesOf(operator, Source.LINKEDIN),
  'ledger.wttj': ledgerEntriesOf(operator, Source.WELCOME),
});

/** A state-delta predicate: the ledger entries read as exactly these intervals (completedAt is the clock's, so it is not compared). */
export const coveredAs = (...intervals) => ({
  description: `covered as ${JSON.stringify(intervals)}`,
  holds: (_before, after) => isDeepStrictEqual(after.map(({ source, from, to, messageCount }) => ({ source, from, to, messageCount })), intervals),
});
export const FETCH_UNIVERSE = Object.freeze(['cache.messageIds', 'ledger.linkedin', 'ledger.wttj']);

/** The stdout lines `fetch` prints for a committed day. */
export const fetchedDayLine = (day, count) => `harvest fetch: ${day}..${day} — ${count} message(s)`;

/** A LinkedIn ledger entry as an earlier run left it, for "LinkedIn is covered through ...". */
export const aLinkedInInterval = ({ from, to, messageCount }) => ({ source: Source.LINKEDIN, from, to, completedAt: '2026-10-25T05:31:00Z', messageCount });
