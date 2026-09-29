// @contract-shape:unbounded-preservation
// The two new driving ports, invoked as an operator invokes them: `harvest fetch` and
// `harvest auth`, as real subprocesses through the production composition root.
// The Gmail API and the token endpoint are answered by a loopback-only fake (the one
// CLI-level seam, OQ-2); everything else is real: filesystem, cache, ledger, credential
// files under a temp HOME. Subprocess layer: example-only, sad paths enumerated (Mandate 11).
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  aCredentialHome,
  aGmailResource,
  aTokenFile,
  aWorkspace,
  cachedMessageIds,
  cachedRecord,
  committedCoverage,
  coverageSummary,
  fileDigests,
  fileModes,
  noSecretsIn,
  readJsonFile,
  realAlertOn,
  runHarvestAsync,
  runHarvestWith,
  utcDay,
  aGmailAlert,
  aMessage,
  ENDPOINT_OVERRIDE_ENV,
  EndpointRefusal,
  GmailRefusal,
  AuthRefusal,
  SENTINEL,
  UNKNOWN_SOURCE_REFUSAL,
  TOKEN_FILE_VERSION,
  GMAIL_READONLY_SCOPE,
  MAILBOX,
} from './support/gmail-domain-types.mjs';
import { createGmailFake, consentRedirect, consentUrlIn, withLoopbackFake } from './support/gmail-fake.mjs';
import { assertStateDelta, setTo, unchanged } from '../../common/state-delta.mjs';

const fetchArgs = (from, to) => ['fetch', '--source', 'linkedin', '--from', from, '--to', to];
const environment = (home, baseUrl) => ({ HOME: home.home, [ENDPOINT_OVERRIDE_ENV]: baseUrl });
const cacheRoot = (workspace) => join(workspace, '.cache/messages');
const ledgerPath = (workspace) => join(workspace, '.cache/coverage.json');

const REAL_FIRST_OF_SEPTEMBER = realAlertOn('2026-09-01');
const aMailboxHoldingTheFirstOfSeptember = () => createGmailFake({ messages: REAL_FIRST_OF_SEPTEMBER.map((record) => aGmailResource({ record })) });

const observe = (workspace, home) => ({
  'cache.messageIds': cachedMessageIds(cacheRoot(workspace)),
  'ledger.coverage': coverageSummary(committedCoverage(ledgerPath(workspace))),
  'credentials.files': fileDigests(home.directory),
});

const allTextUnder = (root) =>
  Object.keys(fileDigests(root))
    .map((name) => readFileSync(join(root, name), 'utf8'))
    .join('\n');

const operatorFetches = (workspace, home, baseUrl, from, to) =>
  runHarvestAsync(fetchArgs(from, to), { cwd: workspace, env: environment(home, baseUrl) });

/** The operator runs `auth`, and the browser answers the consent screen the way `answer` says. */
async function operatorConsents(home, baseUrl, { answer = 'approve' } = {}) {
  let consentUrl = null;
  let redirected = Promise.resolve();
  const result = await runHarvestAsync(['auth'], {
    cwd: aWorkspace(),
    env: environment(home, baseUrl),
    onLine: (line) => {
      const url = consentUrlIn(line);
      if (!url || consentUrl) return;
      consentUrl = url;
      redirected = fetch(consentRedirect(url, answer)).catch(() => {});
    },
  });
  await redirected;
  return { ...result, consentUrl };
}

describe('@driving_adapter harvest fetch, as the operator runs it', () => {
  it('@walking_skeleton @driving_adapter @real-io Operator fetches two settled days of job alerts with their own credential and finds them in the cache', async () => {
    // Given the operator has already consented, and the mailbox holds two real LinkedIn alerts on 1 September and none on 2 September
    const workspace = aWorkspace();
    const home = aCredentialHome();
    const fake = aMailboxHoldingTheFirstOfSeptember();
    await withLoopbackFake(fake, async (baseUrl) => {
      const before = observe(workspace, home);

      // When the operator fetches 1 to 2 September
      const result = await operatorFetches(workspace, home, baseUrl, '2026-09-01', '2026-09-02');

      // Then both days are reported as fetched, the alerts are in the cache exactly as the connector path would have cached them, and both days are covered
      expect(result.status).toBe(0);
      expect(result.stdout.split('\n').filter((line) => /2026-09-01\.\.2026-09-01/.test(line) || /2026-09-02\.\.2026-09-02/.test(line))).toHaveLength(2);
      assertStateDelta(before, observe(workspace, home), {
        universe: ['cache.messageIds', 'ledger.coverage', 'credentials.files'],
        expected: {
          'cache.messageIds': setTo(REAL_FIRST_OF_SEPTEMBER.map((record) => record.id).sort()),
          'ledger.coverage': setTo([{ source: 'linkedin', from: '2026-09-01', to: '2026-09-02', messageCount: 2 }]),
          'credentials.files': unchanged(),
        },
      });
      for (const record of REAL_FIRST_OF_SEPTEMBER) expect(cachedRecord(workspace, record.id, '2026-09')).toEqual(record);
      // And the credential never surfaces, and Gmail was only ever read
      expect(noSecretsIn(`${result.stdout}\n${result.stderr}\n${allTextUnder(join(workspace, '.cache'))}`)).toEqual([]);
      expect(fake.gmailRequests().every((request) => request.method === 'GET' && request.authorization === `Bearer ${SENTINEL.accessToken}`)).toBe(true);
    });
  });

  it('@error refuses an unknown source by name before touching credentials or the cache', () => {
    const workspace = aWorkspace();
    const empty = { home: aWorkspace() };

    const result = runHarvestWith(['fetch', '--source', 'glassdoor', '--from', '2026-09-01', '--to', '2026-09-02'], { cwd: workspace, env: { HOME: empty.home } });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(UNKNOWN_SOURCE_REFUSAL);
    expect(cachedMessageIds(cacheRoot(workspace))).toEqual([]);
  });

  it('a range that starts today has nothing settled to fetch: exit 0, no credential read, nothing committed', () => {
    const workspace = aWorkspace();
    const emptyHome = aWorkspace();

    const result = runHarvestWith(fetchArgs(utcDay(0), utcDay(0)), { cwd: workspace, env: { HOME: emptyHome } });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('nothing settled to fetch');
    expect(committedCoverage(ledgerPath(workspace))).toEqual([]);
  });

  it('a range that runs into today is clamped to yesterday: today is never queried and never covered', async () => {
    const workspace = aWorkspace();
    const home = aCredentialHome();
    const yesterdayAlert = aGmailAlert({ id: 'y1', date: `${utcDay(-1)}T09:00:00Z` });
    const fake = createGmailFake({ messages: [yesterdayAlert] });
    await withLoopbackFake(fake, async (baseUrl) => {
      const result = await operatorFetches(workspace, home, baseUrl, utcDay(-1), utcDay(0));

      expect(result.status).toBe(0);
      expect(coverageSummary(committedCoverage(ledgerPath(workspace)))).toEqual([{ source: 'linkedin', from: utcDay(-1), to: utcDay(-1), messageCount: 1 }]);
      const todayMidnight = Date.parse(`${utcDay(0)}T00:00:00Z`) / 1000;
      expect(fake.requestsTo('list').some((request) => request.query.q.includes(`after:${todayMidnight}`))).toBe(false);
    });
  });

  it('a second run over covered days reads no message and leaves the cache and coverage as they were', async () => {
    const workspace = aWorkspace();
    const home = aCredentialHome();
    const fake = aMailboxHoldingTheFirstOfSeptember();
    await withLoopbackFake(fake, async (baseUrl) => {
      expect((await operatorFetches(workspace, home, baseUrl, '2026-09-01', '2026-09-02')).status).toBe(0);
      const before = observe(workspace, home);
      const requestsSoFar = fake.requests.length;

      const again = await operatorFetches(workspace, home, baseUrl, '2026-09-01', '2026-09-02');

      expect(again.status).toBe(0);
      assertStateDelta(before, observe(workspace, home), { universe: ['cache.messageIds', 'ledger.coverage', 'credentials.files'] });
      expect(fake.requests.slice(requestsSoFar).filter((request) => request.route === 'get' || request.route === 'list')).toEqual([]);
    });
  });

  it('a resumed day skips the messages already cached, reads none of them again, and still commits the day with every message counted', async () => {
    const workspace = aWorkspace();
    const home = aCredentialHome();
    const fake = aMailboxHoldingTheFirstOfSeptember();
    await withLoopbackFake(fake, async (baseUrl) => {
      expect((await operatorFetches(workspace, home, baseUrl, '2026-09-01', '2026-09-01')).status).toBe(0);
      rmSync(ledgerPath(workspace));
      const readsSoFar = fake.requestsTo('get').filter((request) => request.format === 'full').length;

      const resumed = await operatorFetches(workspace, home, baseUrl, '2026-09-01', '2026-09-01');

      expect(resumed.status).toBe(0);
      expect(fake.requestsTo('get').filter((request) => request.format === 'full')).toHaveLength(readsSoFar);
      expect(coverageSummary(committedCoverage(ledgerPath(workspace)))).toEqual([{ source: 'linkedin', from: '2026-09-01', to: '2026-09-01', messageCount: 2 }]);
    });
  });

  it('@error a credential file readable by its group refuses before any request, cache write or coverage commit', async () => {
    const workspace = aWorkspace();
    const home = aCredentialHome({ tokenMode: 0o644 });
    const fake = aMailboxHoldingTheFirstOfSeptember();
    await withLoopbackFake(fake, async (baseUrl) => {
      const before = observe(workspace, home);

      const result = await operatorFetches(workspace, home, baseUrl, '2026-09-01', '2026-09-02');

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(GmailRefusal.PERMISSIONS);
      assertStateDelta(before, observe(workspace, home), { universe: ['cache.messageIds', 'ledger.coverage', 'credentials.files'] });
      expect(fake.requests).toEqual([]);
      expect(fileModes(home.directory)['token.json']).toBe('644');
    });
  });

  it('@error a revoked refresh token refuses by name and says to re-run auth, committing nothing and leaking no secret', async () => {
    const workspace = aWorkspace();
    const home = aCredentialHome();
    const fake = aMailboxHoldingTheFirstOfSeptember();
    fake.revokeRefreshToken();
    await withLoopbackFake(fake, async (baseUrl) => {
      const before = observe(workspace, home);

      const result = await operatorFetches(workspace, home, baseUrl, '2026-09-01', '2026-09-02');

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(GmailRefusal.REAUTH_REQUIRED);
      expect(result.stderr).toContain('harvest auth');
      expect(noSecretsIn(`${result.stdout}\n${result.stderr}`)).toEqual([]);
      assertStateDelta(before, observe(workspace, home), { universe: ['cache.messageIds', 'ledger.coverage', 'credentials.files'] });
    });
  });

  it('@error a mailbox with nothing from the sender refuses, so no day is ever committed as covered with zero messages', async () => {
    const workspace = aWorkspace();
    const home = aCredentialHome();
    const stranger = aGmailResource({ record: aMessage({ id: 's1', date: '2026-09-01T09:00:00Z', sender: 'newsletter@example.invalid' }), fromHeader: 'News <newsletter@example.invalid>' });
    await withLoopbackFake(createGmailFake({ messages: [stranger] }), async (baseUrl) => {
      const result = await operatorFetches(workspace, home, baseUrl, '2026-09-01', '2026-09-02');

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(GmailRefusal.SENDER_MATCHES_NOTHING);
      expect(committedCoverage(ledgerPath(workspace))).toEqual([]);
    });
  });

  it('@error a listing Gmail cannot vouch for on the second day commits nothing for that day and keeps the first', async () => {
    const workspace = aWorkspace();
    const home = aCredentialHome();
    const fake = aMailboxHoldingTheFirstOfSeptember();
    const secondDayStart = Date.parse('2026-09-02T00:00:00Z') / 1000;
    fake.override('list', (_request) => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }), {
      when: (request) => request.query.q?.includes(`after:${secondDayStart}`),
    });
    await withLoopbackFake(fake, async (baseUrl) => {
      const result = await operatorFetches(workspace, home, baseUrl, '2026-09-01', '2026-09-02');

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(GmailRefusal.LIST_MALFORMED);
      expect(coverageSummary(committedCoverage(ledgerPath(workspace)))).toEqual([{ source: 'linkedin', from: '2026-09-01', to: '2026-09-01', messageCount: 2 }]);
    });
  });

  it('@error refuses a base-URL override that names a host other than loopback, before reading any credential', () => {
    const workspace = aWorkspace();
    const home = aCredentialHome();

    const result = runHarvestWith(fetchArgs('2026-09-01', '2026-09-02'), { cwd: workspace, env: environment(home, 'https://collector.example.invalid') });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(EndpointRefusal.NOT_LOOPBACK);
    expect(noSecretsIn(`${result.stdout}\n${result.stderr}`)).toEqual([]);
    expect(committedCoverage(ledgerPath(workspace))).toEqual([]);
  });
});

describe('@driving_adapter harvest auth, as the operator runs it', () => {
  it('@driving_adapter @real-io Operator consents once and the refresh token is kept privately, never printed', async () => {
    const home = aCredentialHome({ token: null });
    const fake = createGmailFake();
    await withLoopbackFake(fake, async (baseUrl) => {
      const result = await operatorConsents(home, baseUrl);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(result.consentUrl.toString());
      expect(readJsonFile(home.tokenPath)).toMatchObject({ version: TOKEN_FILE_VERSION, refreshToken: SENTINEL.refreshToken, scope: GMAIL_READONLY_SCOPE, emailAddress: MAILBOX });
      expect(fileModes(home.directory)).toMatchObject({ 'token.json': '600' });
      expect(fileModes(join(home.home, '.config'))['job-alert-harvester']).toBe('700');
      expect(noSecretsIn(`${result.stdout}\n${result.stderr}`)).toEqual([]);
      const [exchange] = fake.requestsTo('token');
      expect(createHash('sha256').update(exchange.form.code_verifier).digest('base64url')).toBe(result.consentUrl.searchParams.get('code_challenge'));
    });
  });

  it('@error refuses a redirect carrying a state that was not issued, writing no token', async () => {
    const home = aCredentialHome({ token: null });
    const fake = createGmailFake();
    await withLoopbackFake(fake, async (baseUrl) => {
      const result = await operatorConsents(home, baseUrl, { answer: 'wrong-state' });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(AuthRefusal.STATE_MISMATCH);
      expect(fileDigests(home.directory)).not.toHaveProperty('token.json');
      expect(fake.requestsTo('token')).toEqual([]);
    });
  });

  it('@error when the operator revokes access, fetch refuses; re-running auth and fetching again recovers', async () => {
    // Given a revoked token that fetch refuses
    const workspace = aWorkspace();
    const home = aCredentialHome({ token: aTokenFile() });
    const fake = createGmailFake({ issuedRefreshToken: SENTINEL.refreshTokenRotated, messages: REAL_FIRST_OF_SEPTEMBER.map((record) => aGmailResource({ record })) });
    fake.revokeRefreshToken();
    await withLoopbackFake(fake, async (baseUrl) => {
      const refused = await operatorFetches(workspace, home, baseUrl, '2026-09-01', '2026-09-01');
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain(GmailRefusal.REAUTH_REQUIRED);

      // When the operator re-runs auth
      const consented = await operatorConsents(home, baseUrl);
      expect(consented.status).toBe(0);

      // Then fetch succeeds and the day is covered
      const recovered = await operatorFetches(workspace, home, baseUrl, '2026-09-01', '2026-09-01');
      expect(recovered.status).toBe(0);
      expect(coverageSummary(committedCoverage(ledgerPath(workspace)))).toEqual([{ source: 'linkedin', from: '2026-09-01', to: '2026-09-01', messageCount: 2 }]);
      expect(readJsonFile(home.tokenPath).refreshToken).toBe(SENTINEL.refreshTokenRotated);
    });
  });
});
