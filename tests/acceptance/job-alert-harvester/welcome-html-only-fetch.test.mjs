// @contract-shape:bounded-change
// welcome-to-the-jungle-source, slice 03b (US-03b HTML-only fetch, DR-0019 HTML read path, DR-0020 cache keeps raw HTML,
// DR-0022 rule 3, DDD-16 screen-implies-extract). A Welcome to the Jungle message has no plain-text part: it is fetched,
// cached with its raw HTML, judged by the source's own screen (cards, not length), and its days are recorded under its own
// source id beside LinkedIn's. Layers: pure (toMessage, slim, the descriptor's screen; properties allowed, Mandate 9) and
// layer 3 (the real `fetch --source wttj` as a subprocess over the Gmail loopback fake; example-only, Mandate 11).
// Synthetic mail only: every digest is built from the invented records in fixtures/wttj/, every host is example.invalid.
// Wording pinned here (the stories left it open): a message with neither a text nor an HTML part is still refused with
// `gmail.missing-plaintext-body` (DR-0019 rule 5, recommended in H-1); `slim(payload, screen)` takes the screen as its second
// argument (DESIGN component table); a descriptor's `screen(message)` returns null to keep or a non-empty reason string.
// The two HTML-only refusal tests (gmail-message.test.mjs:39-43, gmail-source-list-read.test.mjs:137-146) pin what DR-0019
// rule 1 reverses; this file does not touch them (see the DISTILL R2 note).
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { holds } from '../gmail-api-source/support/property.mjs';
import { assertStateDelta, setTo, unchanged } from '../../common/state-delta.mjs';
import { MessageRefusal, toMessage } from '../../../src/core/gmail-message.mjs';
import { slim } from '../../../src/core/slim.mjs';
import { wttj } from '../../../src/core/sources/wttj.mjs';
import { aMessage, aSpillPayload } from './support/domain-types.mjs';
import { WELCOME_SENDER, WelcomeAlert, welcomeAlertRecord } from './support/wttj-fixtures.mjs';
import { leaksIn } from './support/fixture-leaks.mjs';
import { HARMFUL, HARMLESS, applyAll, mutationArb } from './support/wttj-mutations.mjs';
import {
  FETCH_UNIVERSE,
  Source,
  aDigest,
  aGmailResource,
  aHealthyLinkedInAlert,
  aLinkedInInterval,
  anHtmlOnlyGmailResource,
  anOperatorWith,
  cachedIdsOf,
  cachedRecordOf,
  coveredAs,
  decodedPartsOf,
  fetchedDayLine,
  ledgerEntriesOf,
  observedFetch,
  operatorFetches,
} from './support/wttj-fetch.mjs';

const SLOW = 30_000;
const SIX_KEYS_WITH_HTML = ['date', 'htmlBody', 'id', 'sender', 'snippet', 'subject'];
const SIX_KEYS_WITH_TEXT = ['date', 'id', 'plaintextBody', 'sender', 'snippet', 'subject'];
const GOOD_ALERTS = Object.freeze([
  WelcomeAlert.THREE_CARDS,
  WelcomeAlert.ONE_CARD,
  WelcomeAlert.RESEND_WITH_NEW_CARD,
  WelcomeAlert.TITLE_WITH_AMPERSAND,
  WelcomeAlert.TITLE_WITH_NUMBER,
  WelcomeAlert.NO_SALARY,
  WelcomeAlert.SALARY_ABOVE_MINIMUM,
  WelcomeAlert.SALARY_DOLLAR_RANGE,
  WelcomeAlert.SALARY_STERLING_RANGE,
  WelcomeAlert.SALARY_STERLING_SINGLE,
  WelcomeAlert.SALARY_EURO_RANGE,
]);

const welcomeDigest = (alert = WelcomeAlert.THREE_CARDS) => welcomeAlertRecord(alert);
const withoutTheHtmlPart = (record) => aGmailResource({ record: aMessage({ id: record.id, date: record.date }), plaintext: false, html: false });
const reasonOf = (screenResult) => (typeof screenResult === 'string' && screenResult !== '' ? screenResult : null);

describe('@pure toMessage reads a message with no plain-text part from its HTML part (US-03b HTML-only fetch, AC-1, AC-4, DR-0019 rules 1 and 2)', () => {
  it.skip('gives the record the cache holds for an HTML-only message: its HTML as htmlBody and no plaintextBody', () => {
    // Given a Welcome to the Jungle digest as Gmail serves it, with a single HTML part
    const record = welcomeDigest();

    // When it is turned into a cache record
    const message = toMessage(anHtmlOnlyGmailResource({ record }));

    // Then it is exactly the record the fixtures hold: the six keys, the raw HTML kept whole, no plain-text field
    expect(Object.keys(message).sort()).toEqual(SIX_KEYS_WITH_HTML);
    expect(message).toEqual(record);
  });

  it.skip('@property finds the HTML part wherever the parts tree puts it, whatever it holds', () => {
    holds(
      fc.property(fc.string({ minLength: 1, unit: 'grapheme' }), fc.integer({ min: 0, max: 3 }), fc.constantFrom('single', 'alternative'), (html, nesting, shape) => {
        const record = { ...welcomeDigest(WelcomeAlert.ONE_CARD), htmlBody: html };
        const message = toMessage(anHtmlOnlyGmailResource({ record, nesting, shape }));
        expect(message.htmlBody).toBe(html);
        expect(Object.keys(message).sort()).toEqual(SIX_KEYS_WITH_HTML);
      }),
    );
  });

  it('@property a message with a plain-text part is cached exactly as before: its text, and no HTML, even when an HTML part is there', () => {
    holds(
      fc.property(fc.string({ minLength: 1, unit: 'grapheme' }), fc.integer({ min: 0, max: 3 }), fc.boolean(), (body, nesting, htmlFirst) => {
        const message = toMessage(aGmailResource({ record: aMessage({ id: 'p1', plaintextBody: body }), nesting, htmlFirst }));
        expect(message.plaintextBody).toBe(body);
        expect(Object.keys(message).sort()).toEqual(SIX_KEYS_WITH_TEXT);
      }),
    );
  });

  it('@error still refuses a message with neither a plain-text nor an HTML part, naming its id (DR-0019 rule 5 keeps the code)', () => {
    const resource = withoutTheHtmlPart(welcomeDigest());

    expect(() => toMessage(resource)).toThrowError(/c0ffee0000000001/);
    expect(() => toMessage(resource)).toThrowError(expect.objectContaining({ code: MessageRefusal.MISSING_PLAINTEXT_BODY }));
  });

  it('@error refuses a message whose only HTML part is empty, as one with no body at all', () => {
    const resource = anHtmlOnlyGmailResource({ record: { ...welcomeDigest(), htmlBody: '' } });

    expect(() => toMessage(resource)).toThrowError(expect.objectContaining({ code: MessageRefusal.MISSING_PLAINTEXT_BODY }));
  });
});

describe('@pure slim keeps the HTML only when there is no plain-text part, and the screen it is given decides what is set aside (US-03b, H-2, DR-0019 rule 2, DR-0022 rule 3)', () => {
  const keepEverything = () => null;

  it.skip('keeps an HTML-only record whole, its htmlBody included', () => {
    const record = welcomeDigest();

    const { record: kept, quarantine } = slim(record, keepEverything);

    expect(quarantine).toBeNull();
    expect(kept).toEqual(record);
    expect(Object.keys(kept).sort()).toEqual(SIX_KEYS_WITH_HTML);
  });

  it('drops the HTML of a record that has a plain-text part, so a LinkedIn record is cached as before', () => {
    // Given a payload carrying both a plain-text body and an HTML body (the shape the connector writes)
    const payload = aSpillPayload({ id: 'both' });

    const { record, quarantine } = slim(payload, keepEverything);

    expect(quarantine).toBeNull();
    expect(Object.keys(record).sort()).toEqual(SIX_KEYS_WITH_TEXT);
  });

  it.skip('@error sets aside what the screen it is given names, with that reason, and caches nothing', () => {
    const payload = aSpillPayload({ id: 'odd' });

    const { record, quarantine } = slim(payload, () => 'screen.some-reason');

    expect(record).toBeNull();
    expect(quarantine).toEqual({ id: 'odd', reason: 'screen.some-reason' });
  });

  it.skip('judges a healthy digest by the Welcome to the Jungle screen, not by LinkedIn\'s length and link rules', () => {
    const record = welcomeDigest();

    const { record: kept, quarantine } = slim(record, wttj.screen);

    expect(quarantine).toBeNull();
    expect(kept).toEqual(record);
  });

  it.skip('@error sets aside a digest whose card has no title, naming its id and a reason', () => {
    const broken = welcomeDigest(WelcomeAlert.CARD_WITHOUT_TITLE);

    const { record, quarantine } = slim(broken, wttj.screen);

    expect(record).toBeNull();
    expect(quarantine?.id).toBe(broken.id);
    expect(quarantine?.reason).toMatch(/\S/);
  });
});

describe('@pure the Welcome to the Jungle screen judges a digest on its cards (US-03b, AC-3, DR-0022 rule 3)', () => {
  it.skip('keeps every invented digest the extractor reads', () => {
    expect(typeof wttj.screen).toBe('function');
    for (const alert of GOOD_ALERTS) expect([alert, wttj.screen(welcomeDigest(alert))]).toEqual([alert, null]);
  });

  it.skip('@error sets aside a digest whose card has no title, with a reason', () => {
    expect(typeof wttj.screen).toBe('function');
    expect(reasonOf(wttj.screen(welcomeDigest(WelcomeAlert.CARD_WITHOUT_TITLE)))).not.toBeNull();
  });

  it.skip.each([
    { name: 'a message with no HTML body at all', message: { ...welcomeDigest(), htmlBody: undefined } },
    { name: 'a message with an empty HTML body', message: { ...welcomeDigest(), htmlBody: '' } },
    { name: 'a message with plain text only', message: { ...aMessage({ id: 'pt', sender: WELCOME_SENDER }) } },
  ])('@error sets aside $name, with a reason, and does not throw', ({ message }) => {
    expect(typeof wttj.screen).toBe('function');
    expect(reasonOf(wttj.screen(message))).not.toBeNull();
  });

  it.skip.each(HARMFUL.map((mutation) => ({ name: mutation.name, mutation })))('@error sets aside a digest with $name, as the extractor refuses it', ({ mutation }) => {
    const message = { ...welcomeDigest(), htmlBody: mutation.apply(welcomeDigest().htmlBody) };

    expect(typeof wttj.screen).toBe('function');
    expect(reasonOf(wttj.screen(message))).not.toBeNull();
    expect(() => wttj.extract(message)).toThrowError();
  });

  it.skip.each(HARMLESS.map((mutation) => ({ name: mutation.name, mutation })))('keeps a digest with $name, as the extractor reads it', ({ mutation }) => {
    const message = { ...welcomeDigest(), htmlBody: mutation.apply(welcomeDigest().htmlBody) };

    expect(typeof wttj.screen).toBe('function');
    expect(wttj.screen(message)).toBeNull();
    expect(wttj.extract(message).length).toBeGreaterThanOrEqual(1);
  });

  it.skip('@property whatever the screen accepts, the extractor reads without error and finds at least one card (DDD-16 enforcement property)', () => {
    expect(typeof wttj.screen).toBe('function');
    let kept = 0;
    let setAside = 0;
    holds(
      fc.property(fc.constantFrom(...GOOD_ALERTS), fc.array(mutationArb, { minLength: 0, maxLength: 3 }), (alert, mutations) => {
        const record = welcomeDigest(alert);
        const message = { ...record, htmlBody: applyAll(mutations, record.htmlBody) };

        const reason = wttj.screen(message);

        if (reason === null) {
          kept += 1;
          expect(wttj.extract(message).length).toBeGreaterThanOrEqual(1);
        } else {
          setAside += 1;
          expect(reason).toMatch(/\S/);
        }
      }),
      { numRuns: 300 },
    );
    expect(kept).toBeGreaterThan(0);
    expect(setAside).toBeGreaterThan(0);
  });
});

describe('@driving_adapter harvest fetch --source wttj caches an HTML-only digest and records its day (US-03b, AC-1, AC-2, AC-4, DR-0020)', () => {
  it.skip('@walking_skeleton @driving_adapter @real-io caches a healthy digest with its raw HTML, reports one message, and records 2026-10-09 under wttj', async () => {
    // Given Gmail holds one Welcome to the Jungle digest on 2026-10-09 with no plain-text part
    const digest = aDigest(WelcomeAlert.THREE_CARDS, { on: '2026-10-09' });
    const operator = anOperatorWith({ mailbox: [anHtmlOnlyGmailResource({ record: digest })] });
    const before = observedFetch(operator);

    // When Dan fetches that day for the new source
    const result = await operatorFetches(operator, Source.WELCOME, '2026-10-09', '2026-10-09');

    // Then the day is reported with one message and no set-aside line, the message is cached, and the day is covered once
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(fetchedDayLine('2026-10-09', 1));
    expect(`${result.stdout}\n${result.stderr}`).not.toContain('quarantined');
    assertStateDelta(before, observedFetch(operator), {
      universe: FETCH_UNIVERSE,
      expected: {
        'cache.messageIds': setTo([digest.id]),
        'ledger.linkedin': unchanged(),
        'ledger.wttj': coveredAs({ source: 'wttj', from: '2026-10-09', to: '2026-10-09', messageCount: 1 }),
      },
    });
    // And the cached record is the digest with its raw HTML and no plain-text field
    expect(cachedRecordOf(operator, digest)).toEqual(digest);
    expect(Object.keys(cachedRecordOf(operator, digest)).sort()).toEqual(SIX_KEYS_WITH_HTML);
  }, SLOW);
  it.skip('leaves LinkedIn\'s ledger entry exactly as it was and caches none of LinkedIn\'s mail (guard for DR-0022 rule 1, AC-2)', async () => {
    // Given LinkedIn is covered through 2026-10-24, with its alerts cached, and Gmail holds a digest for 2026-10-09
    const linkedinEntry = aLinkedInInterval({ from: '2026-06-15', to: '2026-10-24', messageCount: 40 });
    const digest = aDigest(WelcomeAlert.THREE_CARDS, { on: '2026-10-09' });
    const operator = anOperatorWith({ mailbox: [anHtmlOnlyGmailResource({ record: digest }), aGmailResource({ record: aHealthyLinkedInAlert('l1', '2026-10-09') })], ledger: [linkedinEntry] });
    const before = observedFetch(operator);

    // When Dan fetches 2026-10-09 for the new source
    const result = await operatorFetches(operator, Source.WELCOME, '2026-10-09', '2026-10-09');

    // Then only the new source's message is cached, the new source has its own interval, and LinkedIn's entry is identical
    expect(result.status, result.stderr).toBe(0);
    assertStateDelta(before, observedFetch(operator), {
      universe: FETCH_UNIVERSE,
      expected: {
        'cache.messageIds': setTo([digest.id]),
        'ledger.linkedin': unchanged(),
        'ledger.wttj': coveredAs({ source: 'wttj', from: '2026-10-09', to: '2026-10-09', messageCount: 1 }),
      },
    });
    expect(ledgerEntriesOf(operator, Source.LINKEDIN)).toEqual([linkedinEntry]);
  }, SLOW);

  it.skip('seeds a new source from an explicit start date with no earlier history: each mailed day and each quiet day is recorded, and a second run reads nothing', async () => {
    // Given no ledger at all, and digests on 2026-10-09 and 2026-10-11 but none on 2026-10-10 or 2026-10-12
    const first = aDigest(WelcomeAlert.THREE_CARDS, { on: '2026-10-09' });
    const second = aDigest(WelcomeAlert.ONE_CARD, { on: '2026-10-11' });
    const operator = anOperatorWith({ mailbox: [first, second].map((record) => anHtmlOnlyGmailResource({ record })) });
    const before = observedFetch(operator);

    // When Dan fetches from 2026-10-09 to 2026-10-12
    const result = await operatorFetches(operator, Source.WELCOME, '2026-10-09', '2026-10-12');

    // Then both digests are cached, the quiet days are reported with no messages, and the new source is covered for the four days
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(fetchedDayLine('2026-10-10', 0));
    expect(result.stdout).toContain(fetchedDayLine('2026-10-12', 0));
    assertStateDelta(before, observedFetch(operator), {
      universe: FETCH_UNIVERSE,
      expected: {
        'cache.messageIds': setTo([first.id, second.id].sort()),
        'ledger.linkedin': unchanged(),
        'ledger.wttj': coveredAs({ source: 'wttj', from: '2026-10-09', to: '2026-10-12', messageCount: 2 }),
      },
    });
    // And fetching the same days again says they are covered and asks Gmail for no message
    const readsSoFar = operator.fake.requestsTo('get').length;
    const again = await operatorFetches(operator, Source.WELCOME, '2026-10-09', '2026-10-12');
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain('already covered');
    expect(operator.fake.requestsTo('get')).toHaveLength(readsSoFar);
  }, SLOW);

  it('@error records a quiet day as covered with zero messages, not as an error', async () => {
    // Given Gmail holds a digest on 2026-10-09 only (so the sender has mail) and Dan asks for 2026-10-12
    const operator = anOperatorWith({ mailbox: [anHtmlOnlyGmailResource({ record: aDigest(WelcomeAlert.THREE_CARDS, { on: '2026-10-09' }) })] });
    const before = observedFetch(operator);

    // When Dan fetches that quiet day
    const result = await operatorFetches(operator, Source.WELCOME, '2026-10-12', '2026-10-12');

    // Then it is reported with no messages, nothing is cached, and the day is covered
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(fetchedDayLine('2026-10-12', 0));
    assertStateDelta(before, observedFetch(operator), {
      universe: FETCH_UNIVERSE,
      expected: { 'cache.messageIds': unchanged(), 'ledger.linkedin': unchanged(), 'ledger.wttj': coveredAs({ source: 'wttj', from: '2026-10-12', to: '2026-10-12', messageCount: 0 }) },
    });
  }, SLOW);

  it.skip('@error sets aside a digest whose card has no title: named by id and reason, not cached, and its day is not recorded', async () => {
    // Given Gmail holds a digest on 2026-10-09 in which one card has no title
    const broken = aDigest(WelcomeAlert.CARD_WITHOUT_TITLE, { on: '2026-10-09' });
    const operator = anOperatorWith({ mailbox: [anHtmlOnlyGmailResource({ record: broken })] });
    const before = observedFetch(operator);

    // When Dan fetches that day
    const result = await operatorFetches(operator, Source.WELCOME, '2026-10-09', '2026-10-09');

    // Then the run stops with the set-aside refusal naming the message and a reason, and nothing is cached or recorded
    expect(result.stderr).toContain('fetch.message-quarantined');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(broken.id);
    assertStateDelta(before, observedFetch(operator), {
      universe: FETCH_UNIVERSE,
      expected: { 'cache.messageIds': unchanged(), 'ledger.linkedin': unchanged(), 'ledger.wttj': unchanged() },
    });
  }, SLOW);

  it.skip('@error a digest set aside on one day does not stop the days before it from being recorded', async () => {
    // Given a healthy digest on 2026-10-09 and a broken one on 2026-10-10
    const healthy = aDigest(WelcomeAlert.THREE_CARDS, { on: '2026-10-09' });
    const broken = aDigest(WelcomeAlert.CARD_WITHOUT_TITLE, { on: '2026-10-10' });
    const operator = anOperatorWith({ mailbox: [healthy, broken].map((record) => anHtmlOnlyGmailResource({ record })) });
    const before = observedFetch(operator);

    // When Dan fetches both days
    const result = await operatorFetches(operator, Source.WELCOME, '2026-10-09', '2026-10-10');

    // Then the first day is cached and recorded, and the second is named and left uncovered
    expect(result.stderr).toContain('fetch.message-quarantined');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(broken.id);
    assertStateDelta(before, observedFetch(operator), {
      universe: FETCH_UNIVERSE,
      expected: {
        'cache.messageIds': setTo([healthy.id]),
        'ledger.linkedin': unchanged(),
        'ledger.wttj': coveredAs({ source: 'wttj', from: '2026-10-09', to: '2026-10-09', messageCount: 1 }),
      },
    });
  }, SLOW);

  it('@error refuses with the sender-matches-nothing refusal when the mailbox holds no mail from the sender, recording nothing', async () => {
    // Given a mailbox holding only LinkedIn alerts
    const operator = anOperatorWith({ mailbox: [aGmailResource({ record: aHealthyLinkedInAlert('l1', '2026-10-09') })] });
    const before = observedFetch(operator);

    // When Dan fetches for the new source
    const result = await operatorFetches(operator, Source.WELCOME, '2026-10-09', '2026-10-09');

    // Then the run refuses with the same refusal the LinkedIn probe gives (its text is the code alone, so it names no sender), and nothing is cached or recorded
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gmail.sender-matches-nothing');
    assertStateDelta(before, observedFetch(operator), { universe: FETCH_UNIVERSE });
  }, SLOW);

  it('caches a LinkedIn alert that also has an HTML part exactly as before: its text only, no HTML added (AC-4)', async () => {
    // Given a LinkedIn alert served with both a plain-text and an HTML part
    const alert = aHealthyLinkedInAlert('l1', '2026-10-09');
    const operator = anOperatorWith({ mailbox: [aGmailResource({ record: alert })] });

    // When Dan fetches that day for LinkedIn
    const result = await operatorFetches(operator, Source.LINKEDIN, '2026-10-09', '2026-10-09');

    // Then the cached record is the alert, with the six LinkedIn keys and no htmlBody
    expect(result.status, result.stderr).toBe(0);
    expect(cachedIdsOf(operator)).toEqual(['l1']);
    expect(cachedRecordOf(operator, alert)).toEqual(alert);
    expect(Object.keys(cachedRecordOf(operator, alert)).sort()).toEqual(SIX_KEYS_WITH_TEXT);
  }, SLOW);
});

describe('@driving_adapter no body, token or tracking link reaches output or the ledger (US-03b, DEVOPS R2 section 4, AC-6 of US-01b store the card link)', () => {
  const CANARY = 'CANARYMARKER7e1d';
  const withCanary = (record) => ({ ...record, htmlBody: record.htmlBody.replaceAll('upn=u001.three-1', `upn=u001.${CANARY}`).replace('Open-source dashboards for product teams', `Tagline ${CANARY}`) });

  it.skip('keeps the card link in the cache record only, never in stdout, stderr or the ledger', async () => {
    // Given a digest whose first card link and tagline carry a unique marker
    const digest = withCanary(aDigest(WelcomeAlert.THREE_CARDS, { on: '2026-10-09' }));
    const operator = anOperatorWith({ mailbox: [anHtmlOnlyGmailResource({ record: digest })] });

    // When Dan fetches the day
    const result = await operatorFetches(operator, Source.WELCOME, '2026-10-09', '2026-10-09');

    // Then the marker travelled into the cache record and nowhere else
    expect(result.status, result.stderr).toBe(0);
    expect(cachedRecordOf(operator, digest).htmlBody).toContain(CANARY);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(CANARY);
    expect(JSON.stringify(ledgerEntriesOf(operator, Source.WELCOME))).not.toContain(CANARY);
  }, SLOW);

  it.skip('@error names a set-aside digest by id and position only, never echoing its text or link', async () => {
    // Given a broken digest whose tagline and links carry the marker
    const broken = withCanary(aDigest(WelcomeAlert.CARD_WITHOUT_TITLE, { on: '2026-10-09' }));
    const operator = anOperatorWith({ mailbox: [anHtmlOnlyGmailResource({ record: broken })] });

    // When Dan fetches the day
    const result = await operatorFetches(operator, Source.WELCOME, '2026-10-09', '2026-10-09');

    // Then it is set aside, and nothing it printed carries the marker
    expect(result.stderr).toContain('fetch.message-quarantined');
    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(CANARY);
  }, SLOW);

  it('builds Gmail resources from the invented fixtures only: no foreign host, address, token or unsubscribe value in any part or header', () => {
    for (const alert of GOOD_ALERTS) {
      const resource = anHtmlOnlyGmailResource({ record: welcomeDigest(alert) });
      const headers = resource.payload.headers.filter(({ name }) => ['From', 'Subject'].includes(name)).map(({ name, value }) => `${name}: ${value}`);
      expect([alert, ...decodedPartsOf(resource).flatMap(leaksIn), ...headers.flatMap(leaksIn)]).toEqual([alert]);
    }
  });
});
