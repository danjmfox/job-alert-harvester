// @contract-shape:bounded-change
// welcome-to-the-jungle-source, slice 03a (US-03a coverage integrity, DR-0022 rules 2 and 3, DR-0019 rule 3): a day is
// recorded as harvested only when every message Gmail listed for it is in the cache. A message the screen sets aside
// leaves its day uncovered, is named by id and reason, and is read again next run; the screen belongs to each source's
// descriptor. Layer 2 (the loop over in-memory doubles, properties allowed, Mandate 9) and layer 3 (the real `fetch` and
// `update` as subprocesses over the Gmail loopback fake, example-only, Mandate 11). Synthetic mail only.
// Wording pinned here (the stories left it open): the refusal code is `fetch.message-quarantined` (DR-0022 rule 2); it is
// printed on stderr with exit 1 and names each set-aside id and its reason; a descriptor's `screen(message)` returns null
// for a message to keep and a non-empty reason string for one to set aside.
// The test at fetch-loop.test.mjs:99-110 pins what rule 2 reverses; this file does not touch it (see the DISTILL R2 note).
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { holds } from '../gmail-api-source/support/property.mjs';
import { assertStateDelta, setTo, unchanged } from '../../common/state-delta.mjs';
import { json } from '../gmail-api-source/support/gmail-fake.mjs';
import { messagesOf } from '../search-yield-summary/support/search-yield-domain-types.mjs';
import {
  STAGE_FAILED_PREFIX,
  USUAL_CACHED,
  USUAL_WAITING,
  WEEK_UNIVERSE,
  lastLineOf,
  observeWeek,
  operatorRunsUpdate,
  stageFailedLinesIn,
  theUsualWeek,
  aScratchWorkspace,
  useWorkspaceCleanup,
} from '../update-subcommand/support/update-domain-types.mjs';
import { linkedin } from '../../../src/core/sources/linkedin.mjs';
import { slim } from '../../../src/core/slim.mjs';
import { MINIMUM_DIGEST_BODY_LENGTH, QuarantineReason, aMessage } from './support/domain-types.mjs';
import { QUARANTINED_REFUSAL, aLedgerAndCache, aMailbox, observedLoop, runLoop, slimPassthrough, slimSettingAside } from './support/fetch-loop-doubles.mjs';
import {
  FETCH_UNIVERSE,
  Source,
  aGmailResource,
  aHealthyLinkedInAlert,
  aTooShortLinkedInAlert,
  anHtmlOnlyGmailResource,
  anOperatorWith,
  coveredAs,
  fetchedDayLine,
  observedFetch,
  operatorFetches,
} from './support/wttj-fetch.mjs';

useWorkspaceCleanup();

const SLOW = 30_000;
const LINKEDIN_SENDER = 'jobalerts-noreply@linkedin.com';
const ONE_DAY = { from: '2026-09-01', to: '2026-09-01' };

/** What a loop run rejected with, or null when it resolved. */
async function settle(action) {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return null;
}

describe('@driving_port a day is recorded as covered only when every message listed for it is cached (US-03a coverage integrity, AC-1, AC-2, DR-0022 rule 2)', () => {
  it('stops at a set-aside message, names it by id and reason, and records no coverage for its day', async () => {
    // Given the source lists a healthy message and one the screen sets aside, on the same day
    const store = aLedgerAndCache();
    const source = aMailbox({ '2026-09-01': ['a', 'b'] });

    // When the loop runs over that day
    const refusal = await settle(() => runLoop({ source, range: ONE_DAY, slim: slimSettingAside({ b: 'slim.body-too-short' }), ...store }));

    // Then it stops with the quarantine refusal naming b and why, and the day is not recorded
    expect(refusal?.code).toBe(QUARANTINED_REFUSAL);
    expect(refusal.message).toContain('b');
    expect(refusal.message).toContain('slim.body-too-short');
    expect(store.intervals).toEqual([]);
  });

  it('still caches the healthy messages of that day, wherever the set-aside one falls in the listing', async () => {
    // Given a set-aside message listed ahead of two healthy ones
    const store = aLedgerAndCache();
    const source = aMailbox({ '2026-09-01': ['bad', 'a', 'b'] });

    // When the loop runs over that day
    const refusal = await settle(() => runLoop({ source, range: ONE_DAY, slim: slimSettingAside({ bad: 'slim.no-advert-link' }), ...store }));

    // Then it stopped, and both healthy messages are in the cache so a retry reads only what is missing
    expect(refusal?.code).toBe(QUARANTINED_REFUSAL);
    assertStateDelta(observedLoop(aLedgerAndCache()), observedLoop(store), {
      universe: ['cache.messageIds', 'ledger.coverage'],
      expected: { 'cache.messageIds': setTo(['a', 'b']), 'ledger.coverage': setTo([]) },
    });
  });

  it('@error names every set-aside message of the day, each with its own reason', async () => {
    // Given two messages the screen sets aside for different reasons
    const store = aLedgerAndCache();
    const source = aMailbox({ '2026-09-01': ['short', 'linkless', 'fine'] });
    const asideBecause = { short: 'slim.body-too-short', linkless: 'slim.no-advert-link' };

    // When the loop runs over that day
    const refusal = await settle(() => runLoop({ source, range: ONE_DAY, slim: slimSettingAside(asideBecause), ...store }));

    // Then the refusal names both ids and both reasons, and not the healthy message
    expect(refusal?.code).toBe(QUARANTINED_REFUSAL);
    for (const text of ['short', 'slim.body-too-short', 'linkless', 'slim.no-advert-link']) expect(refusal.message).toContain(text);
    expect(refusal.message).not.toContain('fine');
  });

  it('keeps the days before the wedged day and never records a day after it', async () => {
    // Given three days, the middle one holding a set-aside message
    const store = aLedgerAndCache();
    const source = aMailbox({ '2026-09-01': ['a'], '2026-09-02': ['b', 'bad'], '2026-09-03': ['c'] });

    // When the loop runs over the three days
    const refusal = await settle(() => runLoop({ source, slim: slimSettingAside({ bad: 'slim.body-too-short' }), ...store }));

    // Then the first day is recorded, the second and third are not, and the third was never read
    expect(refusal?.code).toBe(QUARANTINED_REFUSAL);
    expect(store.intervals.map(({ from, messageCount }) => ({ from, messageCount }))).toEqual([{ from: '2026-09-01', messageCount: 1 }]);
    expect(source.reads).not.toContain('c');
  });

  it('reads the day again on the next run, reads only what is missing, and then records it with every message counted', async () => {
    // Given a first run that stopped at a set-aside message and left the healthy one cached
    const store = aLedgerAndCache();
    const first = aMailbox({ '2026-09-01': ['a', 'bad'] });
    expect((await settle(() => runLoop({ source: first, range: ONE_DAY, slim: slimSettingAside({ bad: 'slim.body-too-short' }), ...store })))?.code).toBe(QUARANTINED_REFUSAL);

    // When the message is fixed at the source and the loop runs again
    const second = aMailbox({ '2026-09-01': ['a', 'bad'] });
    const refusal = await settle(() => runLoop({ source: second, range: ONE_DAY, slim: slimPassthrough, ...store }));

    // Then it succeeds, read only the message that was missing, and records the day with both messages
    expect(refusal).toBeNull();
    expect(second.reads).toEqual(['bad']);
    expect(observedLoop(store)).toEqual({ 'cache.messageIds': ['a', 'bad'], 'ledger.coverage': [{ from: '2026-09-01', to: '2026-09-01', messageCount: 2 }] });
  });

  it('records a day whose every message is healthy, counting each one', async () => {
    // Given a day with two healthy messages
    const store = aLedgerAndCache();

    // When the loop runs
    const refusal = await settle(() => runLoop({ source: aMailbox({ '2026-09-01': ['a', 'b'] }), range: ONE_DAY, ...store }));

    // Then the day is recorded with two messages
    expect(refusal).toBeNull();
    expect(observedLoop(store)['ledger.coverage']).toEqual([{ from: '2026-09-01', to: '2026-09-01', messageCount: 2 }]);
  });

  it('@error records a quiet day as covered with no messages, so it is not offered again', async () => {
    // Given a day on which the source lists nothing, between two days that list one message each
    const store = aLedgerAndCache();
    const source = aMailbox({ '2026-09-01': ['a'], '2026-09-03': ['c'] });

    // When the loop runs over the three days
    await runLoop({ source, ...store });

    // Then the quiet day is among those recorded, with zero messages
    expect(store.intervals.find(({ from }) => from === '2026-09-02')?.messageCount).toBe(0);
  });

  it('@property a day is recorded exactly when every message listed for it is cached, and none after the first day that is not', async () => {
    // For any three days of messages, each either healthy or set aside
    const dayArb = fc.array(fc.boolean(), { minLength: 0, maxLength: 3 });
    await holds(
      fc.asyncProperty(fc.tuple(dayArb, dayArb, dayArb), async (days) => {
        const idsOf = (dayIndex) => days[dayIndex].map((_, position) => `d${dayIndex}m${position}`);
        const mailbox = aMailbox(Object.fromEntries(days.map((_, index) => [`2026-09-0${index + 1}`, idsOf(index)])));
        const asideBecause = Object.fromEntries(days.flatMap((flags, dayIndex) => flags.flatMap((healthy, position) => (healthy ? [] : [[`d${dayIndex}m${position}`, 'slim.body-too-short']]))));
        const wedgedDay = days.findIndex((flags) => flags.includes(false));
        const store = aLedgerAndCache();

        const refusal = await settle(() => runLoop({ source: mailbox, slim: slimSettingAside(asideBecause), ...store }));

        const recordedDays = wedgedDay === -1 ? 3 : wedgedDay;
        expect(store.intervals.map(({ from }) => from)).toEqual([0, 1, 2].slice(0, recordedDays).map((index) => `2026-09-0${index + 1}`));
        expect(store.intervals.map(({ messageCount }) => messageCount)).toEqual(days.slice(0, recordedDays).map((flags) => flags.length));
        expect(refusal?.code).toBe(wedgedDay === -1 ? undefined : QUARANTINED_REFUSAL);
        const keptThrough = wedgedDay === -1 ? 3 : wedgedDay + 1;
        const healthyIds = days.slice(0, keptThrough).flatMap((flags, dayIndex) => idsOf(dayIndex).filter((_, position) => flags[position]));
        expect([...store.cached].sort()).toEqual(healthyIds.sort());
      }),
      { numRuns: 80 },
    );
  });
});

describe('@driving_port each source\'s descriptor owns the screen that sets a message aside (US-03a, AC-3, DR-0022 rule 3)', () => {
  const alertWithBodyOfLength = (length) => {
    const link = 'View job: https://www.linkedin.com/jobs/view/4441092711/?trackingId=REDACTED\n';
    return aMessage({ id: 'edge', plaintextBody: ('x'.repeat(Math.max(0, length - link.length)) + link).slice(0, Math.max(length, link.length)) });
  };

  it.skip('LinkedIn\'s descriptor carries a screen that keeps a healthy digest', () => {
    // Given a healthy LinkedIn digest
    const message = aMessage({ id: 'healthy' });

    // When its descriptor screens it
    expect(typeof linkedin.screen).toBe('function');

    // Then nothing is set aside
    expect(linkedin.screen(message)).toBeNull();
  });

  it.skip.each([
    { name: 'a body one character under the minimum is set aside as too short', length: MINIMUM_DIGEST_BODY_LENGTH - 1, reason: QuarantineReason.BODY_TOO_SHORT },
    { name: 'a body of exactly the minimum length, with a link, is kept', length: MINIMUM_DIGEST_BODY_LENGTH, reason: null },
  ])('@error LinkedIn\'s thresholds are unchanged: $name', ({ length, reason }) => {
    expect(typeof linkedin.screen).toBe('function');
    expect(linkedin.screen(alertWithBodyOfLength(length))).toBe(reason);
  });

  it.skip('@error LinkedIn\'s screen sets aside a long digest with no advert link, as before', () => {
    const body = ('Your job alert for agile coach\n\n' + 'lorem ipsum dolor sit amet '.repeat(60)).padEnd(MINIMUM_DIGEST_BODY_LENGTH + 100, ' ');

    expect(typeof linkedin.screen).toBe('function');
    expect(linkedin.screen(aMessage({ id: 'linkless', plaintextBody: body }))).toBe(QuarantineReason.NO_ADVERT_LINK);
  });

  it.skip('@error LinkedIn\'s screen sets aside a record with no plain-text body and does not throw (DR-0019 rule 3)', () => {
    // Given a record from the LinkedIn sender that carries only HTML
    const { plaintextBody: _absent, ...withoutPlaintext } = aMessage({ id: 'html-only' });
    const record = { ...withoutPlaintext, htmlBody: '<html><body><p>A digest</p></body></html>' };

    // When its descriptor screens it
    expect(typeof linkedin.screen).toBe('function');
    const reason = linkedin.screen(record);

    // Then it is set aside with a reason, rather than the screen failing on the missing body
    expect(typeof reason).toBe('string');
    expect(reason).not.toBe('');
  });

  it.skip('@error slim sets aside a record with no plain-text body, naming its id, instead of throwing (DR-0019 rule 3)', () => {
    const { plaintextBody: _absent, ...withoutPlaintext } = aMessage({ id: 'html-only' });
    const record = { ...withoutPlaintext, htmlBody: '<html><body><p>A digest</p></body></html>' };

    const { record: kept, quarantine } = slim(record);

    expect(kept).toBeNull();
    expect(quarantine?.id).toBe('html-only');
    expect(quarantine?.reason).toMatch(/\S/);
  });
});

describe('@driving_adapter harvest fetch for LinkedIn leaves a day uncovered when a message is set aside (US-03a, AC-1, AC-2, AC-4)', () => {
  it.skip('@error stops with the too-short alert named, caches the healthy alert, and records no coverage for 2026-10-14', async () => {
    // Given Gmail lists a healthy LinkedIn alert and a too-short one for 2026-10-14
    const operator = anOperatorWith({ mailbox: [aHealthyLinkedInAlert('h1', '2026-10-14'), aTooShortLinkedInAlert('s1', '2026-10-14')].map((record) => aGmailResource({ record })) });
    const before = observedFetch(operator);

    // When Dan fetches that day
    const result = await operatorFetches(operator, Source.LINKEDIN, '2026-10-14', '2026-10-14');

    // Then the run stops naming the too-short alert and why, the healthy alert is cached, and the day is not recorded
    expect(result.stderr).toContain(QUARANTINED_REFUSAL);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('s1');
    expect(result.stderr).toContain(QuarantineReason.BODY_TOO_SHORT);
    assertStateDelta(before, observedFetch(operator), {
      universe: FETCH_UNIVERSE,
      expected: { 'cache.messageIds': setTo(['h1']), 'ledger.linkedin': unchanged(), 'ledger.wttj': unchanged() },
    });
  }, SLOW);

  it.skip('@error a LinkedIn message with no plain-text part is set aside and named, not a fetch error, and the healthy alert is still cached (DR-0019 rule 3)', async () => {
    // Given Gmail lists a healthy alert and a message from the LinkedIn sender that has only an HTML part, newest first
    const htmlOnly = { id: 'x1', date: '2026-10-14T10:00:00Z', sender: LINKEDIN_SENDER, subject: 'Your job alert', snippet: 'Your job alert', htmlBody: '<html><body><p>A digest</p></body></html>' };
    const operator = anOperatorWith({
      mailbox: [aGmailResource({ record: aHealthyLinkedInAlert('h1', '2026-10-14') }), anHtmlOnlyGmailResource({ record: htmlOnly, fromHeader: `LinkedIn Job Alerts <${LINKEDIN_SENDER}>` })],
    });
    const before = observedFetch(operator);

    // When Dan fetches that day
    const result = await operatorFetches(operator, Source.LINKEDIN, '2026-10-14', '2026-10-14');

    // Then the refusal is the set-aside one naming x1, the healthy alert is cached, and the day is not recorded
    expect(result.stderr).toContain(QUARANTINED_REFUSAL);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('x1');
    assertStateDelta(before, observedFetch(operator), {
      universe: FETCH_UNIVERSE,
      expected: { 'cache.messageIds': setTo(['h1']), 'ledger.linkedin': unchanged(), 'ledger.wttj': unchanged() },
    });
  }, SLOW);

  it.skip('@error after the short alert is replaced by a whole one, the next fetch reads only that alert and records the day with both', async () => {
    // Given a first fetch that stopped at the too-short alert
    const healthy = aHealthyLinkedInAlert('h1', '2026-10-14');
    const mailbox = [healthy, aTooShortLinkedInAlert('s1', '2026-10-14')].map((record) => aGmailResource({ record }));
    const operator = anOperatorWith({ mailbox });
    expect((await operatorFetches(operator, Source.LINKEDIN, '2026-10-14', '2026-10-14')).status).toBe(1);
    const readsSoFar = operator.fake.requestsTo('get').filter((request) => request.format === 'full').length;

    // When the alert is whole at the source and Dan fetches the day again
    mailbox.splice(1, 1, aGmailResource({ record: aHealthyLinkedInAlert('s1', '2026-10-14', '10:00:00') }));
    const result = await operatorFetches(operator, Source.LINKEDIN, '2026-10-14', '2026-10-14');

    // Then it succeeds, read only s1, and the day is recorded with two messages
    expect(result.status, result.stderr).toBe(0);
    expect(operator.fake.requestsTo('get').filter((request) => request.format === 'full').slice(readsSoFar).map((request) => request.id)).toEqual(['s1']);
    expect(observedFetch(operator)['cache.messageIds']).toEqual(['h1', 's1']);
    expect(coveredAs({ source: 'linkedin', from: '2026-10-14', to: '2026-10-14', messageCount: 2 }).holds(null, observedFetch(operator)['ledger.linkedin'])).toBe(true);
  }, SLOW);

  it('records 2026-10-14 with two messages when both alerts are healthy', async () => {
    // Given Gmail lists two healthy LinkedIn alerts for 2026-10-14
    const operator = anOperatorWith({ mailbox: [aHealthyLinkedInAlert('h1', '2026-10-14'), aHealthyLinkedInAlert('h2', '2026-10-14', '11:00:00')].map((record) => aGmailResource({ record })) });
    const before = observedFetch(operator);

    // When Dan fetches that day
    const result = await operatorFetches(operator, Source.LINKEDIN, '2026-10-14', '2026-10-14');

    // Then both are cached and the day is recorded with two messages
    expect(result.status, result.stderr).toBe(0);
    assertStateDelta(before, observedFetch(operator), {
      universe: FETCH_UNIVERSE,
      expected: {
        'cache.messageIds': setTo(['h1', 'h2']),
        'ledger.linkedin': coveredAs({ source: 'linkedin', from: '2026-10-14', to: '2026-10-14', messageCount: 2 }),
        'ledger.wttj': unchanged(),
      },
    });
  }, SLOW);

  it('@error records a quiet day between two busy ones as covered with zero messages', async () => {
    // Given alerts on 2026-09-01 and 2026-09-03 and none on 2026-09-02
    const operator = anOperatorWith({ mailbox: [aHealthyLinkedInAlert('h1', '2026-09-01'), aHealthyLinkedInAlert('h3', '2026-09-03')].map((record) => aGmailResource({ record })) });

    // When Dan fetches the three days
    const result = await operatorFetches(operator, Source.LINKEDIN, '2026-09-01', '2026-09-03');

    // Then the quiet day is reported with no messages and the three days are recorded together
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(fetchedDayLine('2026-09-02', 0));
    expect(coveredAs({ source: 'linkedin', from: '2026-09-01', to: '2026-09-03', messageCount: 2 }).holds(null, observedFetch(operator)['ledger.linkedin'])).toBe(true);
  }, SLOW);
});

describe('@driving_adapter harvest update stops before the build when a LinkedIn message is set aside (US-03a, AC-1; DR-0016 rule 5, partial fetch fails closed)', () => {
  it.skip('@error exits 1 naming the fetch stage and the set-aside message, builds nothing and touches the Sheet not at all', async () => {
    // Given the usual week, where yesterday's only alert is waiting in the mailbox but its body is too short
    const week = theUsualWeek(aScratchWorkspace());
    const [waiting] = messagesOf([...USUAL_CACHED, ...USUAL_WAITING]).slice(USUAL_CACHED.length);
    const tooShort = { ...waiting, plaintextBody: 'Your job alert was cut short.\n' };
    week.gmail.override('get', () => json(200, aGmailResource({ record: tooShort })), { when: (request) => request.id === waiting.id && request.format === 'full' });
    const before = observeWeek(week);

    // When the operator runs update
    const result = await operatorRunsUpdate(week);

    // Then it exits 1 with one stage-failed line, last on stderr, naming the fetch, the quarantine refusal, the message and why
    const line = lastLineOf(result.stderr);
    expect(line).toContain(QUARANTINED_REFUSAL);
    expect(result.status).toBe(1);
    expect(stageFailedLinesIn(result.stderr)).toHaveLength(1);
    expect(line.startsWith(`${STAGE_FAILED_PREFIX} fetch`)).toBe(true);
    expect(line).toContain(waiting.id);
    expect(line).toContain(QuarantineReason.BODY_TOO_SHORT);
    // And not one request reached the Sheet, and the cache, the ledger and the Sheet are as they were
    expect(week.sheets.requests).toHaveLength(0);
    assertStateDelta(before, observeWeek(week), {
      universe: WEEK_UNIVERSE,
      expected: {
        'cache.messageIds': unchanged(),
        'ledger.coverage': unchanged(),
        'sheet.jobKeys': unchanged(),
        'sheet.writeRequests': unchanged(),
        'gmail.requestCount': { description: 'Gmail was read', holds: (b, a) => a > b },
        'sheets.requestCount': unchanged(),
      },
    });
  }, SLOW);
});
