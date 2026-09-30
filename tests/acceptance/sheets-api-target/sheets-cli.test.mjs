// @contract-shape:bounded-change
// The three driving ports of sheets-api-target, invoked as an operator invokes them: `harvest build --target sheets`,
// `harvest import` and `harvest auth --target sheets`, as real subprocesses through the production composition root.
// The Sheets API, the Drive API and the token endpoint are answered by a loopback-only fake (the one CLI-level seam);
// everything else is real: filesystem, cache, credential files under a temp HOME. Subprocess layer: example-only, sad
// paths enumerated (Mandate 11). The subprocess is spawned asynchronously so the fake can answer while it runs.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AuthRefusal,
  AuthTargetRefusal,
  BuildRefusal,
  DRIVE_FILE_SCOPE,
  ENDPOINT_OVERRIDE_ENV,
  EndpointRefusal,
  ImportRefusal,
  JOBS_WITH_NOTES,
  KEY_COLUMN,
  SHEETS_SENTINEL,
  SheetsRefusal,
  TRACKER_UNIVERSE,
  aSheetsCredentialHome,
  aTargetRecord,
  aTokenFile,
  aTrackedJob,
  aTrackerFake,
  aWorkbookFile,
  aWorkspace,
  aMessage,
  aTracker,
  cacheAlert,
  environment,
  fileDigests,
  fileModes,
  noSecretsIn,
  observeTracker,
  readJsonFile,
  runHarvestAsync,
  runHarvestWith,
  tabRows,
} from './support/sheets-domain-types.mjs';
import { consentRedirect, consentUrlIn, createSheetsFake, withLoopbackFake } from './support/sheets-fake.mjs';
import { assertStateDelta, appendedWith, unchanged } from '../../common/state-delta.mjs';

const ALERT_JOB = 'linkedin:4445119872';
const holdsThat = (description, test) => ({ description, holds: (before, after) => test(before, after) });
const allUnchanged = (names) => Object.fromEntries(names.map((name) => [name, unchanged()]));

const aWorkspaceHoldingAnAlert = () => {
  const workspace = aWorkspace();
  cacheAlert(workspace, aMessage({}));
  return workspace;
};
const aTrackerHoldingTheAlertedJob = (options = {}) =>
  aTrackerFake({
    jobs: [aTrackedJob('4445119872', { Status: 'Applied', 'My Notes': 'call back', Job: 'Old title', Company: 'Old company' }), aTrackedJob('2', { Status: 'Interview', 'My Notes': 'second round' })],
    companies: null,
    sources: null,
    ...options,
  });

const operatorBuilds = (workspace, home, baseUrl, ...args) =>
  runHarvestAsync(['build', '--target', 'sheets', ...args], { cwd: workspace, env: environment(home, baseUrl) });
const operatorImports = (workspace, home, baseUrl, from) => runHarvestAsync(['import', '--from', from], { cwd: workspace, env: environment(home, baseUrl) });

/** The operator runs `auth --target sheets`, and the browser answers the consent screen the way `answer` says. */
async function operatorConsents(home, baseUrl, { answer = 'approve', args = ['auth', '--target', 'sheets'] } = {}) {
  let consentUrl = null;
  let redirected = Promise.resolve();
  const result = await runHarvestAsync(args, {
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

const allTextUnder = (root) =>
  Object.keys(fileDigests(root))
    .map((name) => readFileSync(join(root, name), 'utf8'))
    .join('\n');
const outputOf = (result) => `${result.stdout}\n${result.stderr}`;

describe('@driving_adapter harvest build --target sheets, as the operator runs it', () => {
  it('@walking_skeleton @driving_adapter @real-io Operator merges this week alerts into their own Google Sheet and finds their notes untouched', async () => {
    // Given the operator has imported their tracker, holds a Status and a note against the alerted job, and has one alert cached
    const workspace = aWorkspaceHoldingAnAlert();
    const home = aSheetsCredentialHome();
    const fake = aTrackerHoldingTheAlertedJob();
    await withLoopbackFake(fake, async (baseUrl) => {
      const before = observeTracker(fake);

      // When the operator builds into the Sheet and asks for the changed cells as a report
      const result = await operatorBuilds(workspace, home, baseUrl, '--report', join(workspace, 'changes.txt'));

      // Then the run succeeds, the alerted job carries its derived title, the Companies and Sources tabs exist, and the operator's Status and notes are exactly as they were
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('harvest build: merged');
      assertStateDelta(before, observeTracker(fake), {
        universe: TRACKER_UNIVERSE,
        expected: {
          'jobs.header': unchanged(),
          'jobs.keys': unchanged(),
          'jobs.judgement': unchanged(),
          'jobs.harvesterCells': holdsThat('the alerted job is retitled and the other job is untouched', (b, a) => a[ALERT_JOB].Job === 'Scrum Master & PMO Lead' && JSON.stringify(a['linkedin:2']) === JSON.stringify(b['linkedin:2'])),
          'companies.rows': holdsThat('Companies holds the harvested company', (_b, a) => Boolean(a?.some((row) => row.Company === 'Digital Waffle'))),
          'sources.rows': holdsThat('Sources holds the harvested search', (_b, a) => a?.length === 1),
          'sheet.tabNames': appendedWith('Companies', 'Sources'),
          'drive.files': unchanged(),
        },
      });
      expect(readFileSync(join(workspace, 'changes.txt'), 'utf8')).toContain('Old title -> Scrum Master & PMO Lead');
      // And every request carried the Sheets credential, Gmail was never touched, and no credential surfaces anywhere
      expect(fake.apiRequests().every((request) => request.authorization === `Bearer ${SHEETS_SENTINEL.accessToken}`)).toBe(true);
      expect(fake.requestsTo('profile')).toEqual([]);
      expect(fake.requestsTo('drive-create')).toEqual([]);
      expect(noSecretsIn(`${outputOf(result)}\n${allTextUnder(workspace)}`)).toEqual([]);
    });
  });

  it('@driving_adapter build --target sheets --dry-run prints the plan and writes nothing to the Sheet, the fake recording zero write requests', async () => {
    const workspace = aWorkspaceHoldingAnAlert();
    const home = aSheetsCredentialHome();
    const fake = aTrackerHoldingTheAlertedJob();
    await withLoopbackFake(fake, async (baseUrl) => {
      const before = observeTracker(fake);

      const result = await operatorBuilds(workspace, home, baseUrl, '--dry-run');

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('harvest build --dry-run: plan for tab "Jobs"');
      assertStateDelta(before, observeTracker(fake), { universe: TRACKER_UNIVERSE, expected: allUnchanged(TRACKER_UNIVERSE) });
      expect(fake.writeRequests()).toEqual([]);
      expect(fake.requestsTo('values').length).toBeGreaterThan(0);
    });
  });

  it('@error @driving_adapter refuses build.target-conflict when --out or --merge is given with --target sheets, before any request', async () => {
    for (const flag of ['--out', '--merge']) {
      const workspace = aWorkspaceHoldingAnAlert();
      const home = aSheetsCredentialHome();
      const fake = aTrackerHoldingTheAlertedJob();
      await withLoopbackFake(fake, async (baseUrl) => {
        const result = await operatorBuilds(workspace, home, baseUrl, flag, join(workspace, 'tracker.xlsx'));

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(BuildRefusal.TARGET_CONFLICT);
        expect(fake.requests).toEqual([]);
        expect(existsSync(join(workspace, 'tracker.xlsx'))).toBe(false);
      });
    }
  });

  it('@error @driving_adapter refuses an unrecognised --target by name, before any request', async () => {
    const workspace = aWorkspaceHoldingAnAlert();
    const home = aSheetsCredentialHome();

    const result = runHarvestWith(['build', '--target', 'drive'], { cwd: workspace, env: { HOME: home.home } });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(BuildRefusal.UNKNOWN_TARGET);
  });

  it('@error @driving_adapter refuses sheets.not-imported, pointing at `harvest import`, when no Sheet has been recorded', async () => {
    const workspace = aWorkspaceHoldingAnAlert();
    const home = aSheetsCredentialHome({ target: null });
    const fake = aTrackerHoldingTheAlertedJob();
    await withLoopbackFake(fake, async (baseUrl) => {
      const result = await operatorBuilds(workspace, home, baseUrl);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(SheetsRefusal.NOT_IMPORTED);
      expect(result.stderr).toContain('harvest import');
      expect(fake.writeRequests()).toEqual([]);
    });
  });

  it('@error @driving_adapter refuses sheets.credential-permissions for a Sheets token readable by everyone, before any request', async () => {
    const workspace = aWorkspaceHoldingAnAlert();
    const home = aSheetsCredentialHome({ sheetsTokenMode: 0o644 });
    const fake = aTrackerHoldingTheAlertedJob();
    await withLoopbackFake(fake, async (baseUrl) => {
      const result = await operatorBuilds(workspace, home, baseUrl);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(SheetsRefusal.CREDENTIAL_PERMISSIONS);
      expect(fake.requests).toEqual([]);
      expect(noSecretsIn(outputOf(result))).toEqual([]);
    });
  });

  it('@error @driving_adapter a revoked grant refuses sheets.reauth-required naming `harvest auth --target sheets`, and writes nothing', async () => {
    const workspace = aWorkspaceHoldingAnAlert();
    const home = aSheetsCredentialHome();
    const fake = aTrackerHoldingTheAlertedJob();
    fake.revokeRefreshToken();
    await withLoopbackFake(fake, async (baseUrl) => {
      const result = await operatorBuilds(workspace, home, baseUrl);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(SheetsRefusal.REAUTH_REQUIRED);
      expect(result.stderr).toContain('harvest auth --target sheets');
      expect(fake.writeRequests()).toEqual([]);
      expect(noSecretsIn(outputOf(result))).toEqual([]);
    });
  });

  it('@error @driving_adapter a Sheet in the bin refuses sheets.spreadsheet-trashed and writes nothing', async () => {
    const workspace = aWorkspaceHoldingAnAlert();
    const home = aSheetsCredentialHome();
    const fake = aTrackerHoldingTheAlertedJob();
    fake.trash();
    await withLoopbackFake(fake, async (baseUrl) => {
      const result = await operatorBuilds(workspace, home, baseUrl);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(SheetsRefusal.SPREADSHEET_TRASHED);
      expect(fake.writeRequests()).toEqual([]);
    });
  });

  it('@error @driving_adapter a Sheet holding one job key on two rows refuses sheets.duplicate-key and changes nothing', async () => {
    const workspace = aWorkspaceHoldingAnAlert();
    const home = aSheetsCredentialHome();
    const fake = aTrackerHoldingTheAlertedJob();
    fake.humanAppendsRow('Jobs', aTrackedJob('4445119872'));
    await withLoopbackFake(fake, async (baseUrl) => {
      const before = observeTracker(fake);

      const result = await operatorBuilds(workspace, home, baseUrl);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(SheetsRefusal.DUPLICATE_KEY);
      expect(result.stderr).toContain(ALERT_JOB);
      assertStateDelta(before, observeTracker(fake), { universe: TRACKER_UNIVERSE, expected: allUnchanged(TRACKER_UNIVERSE) });
      expect(fake.writeRequests()).toEqual([]);
    });
  });

  it('@error @driving_adapter a Sheet without its Dedup Key column refuses sheets.key-column-missing and changes nothing', async () => {
    const workspace = aWorkspaceHoldingAnAlert();
    const home = aSheetsCredentialHome();
    const fake = aTrackerHoldingTheAlertedJob({ jobsHeader: JOBS_WITH_NOTES.filter((column) => column !== KEY_COLUMN) });
    await withLoopbackFake(fake, async (baseUrl) => {
      const result = await operatorBuilds(workspace, home, baseUrl);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(SheetsRefusal.KEY_COLUMN_MISSING);
      expect(fake.writeRequests()).toEqual([]);
    });
  });

  it('@error @driving_adapter an empty cache refuses to build, exactly as the offline path does, and writes nothing', async () => {
    const workspace = aWorkspace();
    const home = aSheetsCredentialHome();
    const fake = aTrackerHoldingTheAlertedJob();
    await withLoopbackFake(fake, async (baseUrl) => {
      const result = await operatorBuilds(workspace, home, baseUrl);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('the cache is empty');
      expect(fake.writeRequests()).toEqual([]);
    });
  });

  it('@error @driving_adapter an override that is not a loopback host is refused as gmail.base-url-not-loopback, and no token is sent anywhere', () => {
    const workspace = aWorkspaceHoldingAnAlert();
    const home = aSheetsCredentialHome();

    const result = runHarvestWith(['build', '--target', 'sheets'], { cwd: workspace, env: { HOME: home.home, [ENDPOINT_OVERRIDE_ENV]: 'https://sheets.googleapis.com' } });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(EndpointRefusal.NOT_LOOPBACK);
    expect(noSecretsIn(outputOf(result))).toEqual([]);
  });

  it('plain `build --out` still writes the offline workbook and never touches the Sheet', async () => {
    const workspace = aWorkspaceHoldingAnAlert();
    const home = aSheetsCredentialHome();
    const fake = aTrackerHoldingTheAlertedJob();
    await withLoopbackFake(fake, async (baseUrl) => {
      const result = await runHarvestAsync(['build', '--out', join(workspace, 'tracker.xlsx')], { cwd: workspace, env: environment(home, baseUrl) });

      expect(result.status).toBe(0);
      expect(existsSync(join(workspace, 'tracker.xlsx'))).toBe(true);
      expect(fake.requests).toEqual([]);
    });
  });
});

describe('@driving_adapter harvest import, as the operator runs it', () => {
  const aWorkbookOnDisk = () =>
    aWorkbookFile(
      join(aWorkspace(), 'tracker.xlsx'),
      aTracker({ jobs: [aTrackedJob('4445119872', { Status: 'Applied', 'My Notes': 'call back' })], jobsHeader: JOBS_WITH_NOTES, companies: [], sources: [] }),
    );

  it('@driving_adapter @real-io Operator imports their workbook once: a Sheet is created, its id recorded privately, and nothing secret is printed', async () => {
    const workspace = aWorkspace();
    const home = aSheetsCredentialHome({ target: null });
    const fake = createSheetsFake();
    await withLoopbackFake(fake, async (baseUrl) => {
      const result = await operatorImports(workspace, home, baseUrl, aWorkbookOnDisk());

      expect(result.status).toBe(0);
      const [created] = fake.files();
      expect(readJsonFile(home.targetPath)).toMatchObject({ spreadsheetId: created.id });
      expect(fileModes(home.directory)['sheets-target.json']).toBe('600');
      expect(tabRows(fake.snapshot(created.id), 'Jobs').rows[0]).toMatchObject({ [KEY_COLUMN]: ALERT_JOB, Status: 'Applied', 'My Notes': 'call back' });
      expect(noSecretsIn(outputOf(result))).toEqual([]);
    });
  });

  it('@error @driving_adapter a second import refuses import.already-imported and creates no second Sheet', async () => {
    const workspace = aWorkspace();
    const home = aSheetsCredentialHome({ target: null });
    const fake = createSheetsFake();
    await withLoopbackFake(fake, async (baseUrl) => {
      const from = aWorkbookOnDisk();
      await operatorImports(workspace, home, baseUrl, from);
      const requestsBefore = fake.requests.length;

      const result = await operatorImports(workspace, home, baseUrl, from);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(ImportRefusal.ALREADY_IMPORTED);
      expect(fake.requests).toHaveLength(requestsBefore);
      expect(fake.files()).toHaveLength(1);
    });
  });

  it('@error @driving_adapter a workbook path that does not exist refuses import.file-missing before any request', async () => {
    const workspace = aWorkspace();
    const home = aSheetsCredentialHome({ target: null });
    const fake = createSheetsFake();
    await withLoopbackFake(fake, async (baseUrl) => {
      const result = await operatorImports(workspace, home, baseUrl, join(workspace, 'absent.xlsx'));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(ImportRefusal.FILE_MISSING);
      expect(fake.requests).toEqual([]);
    });
  });

  it('@error @driving_adapter a conversion that loses a row refuses import.conversion-mismatch, deletes the created file and records nothing', async () => {
    const workspace = aWorkspace();
    const home = aSheetsCredentialHome({ target: null });
    const fake = createSheetsFake({ conversion: 'drops-last-data-row' });
    await withLoopbackFake(fake, async (baseUrl) => {
      const result = await operatorImports(workspace, home, baseUrl, aWorkbookOnDisk());

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(ImportRefusal.CONVERSION_MISMATCH);
      expect(fake.files()).toEqual([]);
      expect(existsSync(home.targetPath)).toBe(false);
    });
  });

  it('@driving_adapter operator imports, previews with --dry-run, then merges: the preview writes nothing and the merge keeps their Status', async () => {
    // Given the operator imports their workbook and has one alert cached
    const workspace = aWorkspaceHoldingAnAlert();
    const home = aSheetsCredentialHome({ target: null });
    const fake = createSheetsFake();
    await withLoopbackFake(fake, async (baseUrl) => {
      const imported = await operatorImports(workspace, home, baseUrl, aWorkbookOnDisk());
      expect(imported.status).toBe(0);
      const sheetId = fake.files()[0].id;
      const writesAfterImport = fake.writeRequests().length;

      // When the operator previews, then merges
      const preview = await operatorBuilds(workspace, home, baseUrl, '--dry-run');
      const writesAfterPreview = fake.writeRequests().length;
      const merge = await operatorBuilds(workspace, home, baseUrl);

      // Then the preview wrote nothing, and the merge changed the derived title while the Status and note stayed
      expect(preview.status).toBe(0);
      expect(writesAfterPreview).toBe(writesAfterImport);
      expect(merge.status).toBe(0);
      expect(tabRows(fake.snapshot(sheetId), 'Jobs').rows[0]).toMatchObject({ Job: 'Scrum Master & PMO Lead', Status: 'Applied', 'My Notes': 'call back' });
    });
  });
});

describe('@driving_adapter harvest auth --target sheets, as the operator runs it', () => {
  it('@driving_adapter @real-io Operator consents once for drive.file: the refresh token is kept privately in its own file, never printed, and the Gmail token is untouched', async () => {
    const home = aSheetsCredentialHome({ sheetsToken: null, target: null });
    const fake = createSheetsFake({ issuedRefreshToken: SHEETS_SENTINEL.refreshToken });
    await withLoopbackFake(fake, async (baseUrl) => {
      const gmailBefore = fileDigests(home.directory)['token.json'];

      const result = await operatorConsents(home, baseUrl);

      expect(result.status).toBe(0);
      expect(result.consentUrl.searchParams.get('scope')).toBe(DRIVE_FILE_SCOPE);
      expect(result.consentUrl.searchParams.get('code_challenge_method')).toBe('S256');
      expect(readJsonFile(home.sheetsTokenPath)).toMatchObject({ refreshToken: SHEETS_SENTINEL.refreshToken, scope: DRIVE_FILE_SCOPE });
      expect(readJsonFile(home.sheetsTokenPath)).not.toHaveProperty('emailAddress');
      expect(fileModes(home.directory)['sheets-token.json']).toBe('600');
      expect(fileDigests(home.directory)['token.json']).toBe(gmailBefore);
      expect(fake.requestsTo('profile')).toEqual([]);
      expect(noSecretsIn(outputOf(result))).toEqual([]);
    });
  });

  it('proves PKCE on the wire: the verifier the token endpoint receives hashes to the challenge the browser was shown', async () => {
    const home = aSheetsCredentialHome({ sheetsToken: null, target: null });
    const fake = createSheetsFake();
    await withLoopbackFake(fake, async (baseUrl) => {
      const result = await operatorConsents(home, baseUrl);

      expect(result.consentUrl.searchParams.get('scope')).toBe(DRIVE_FILE_SCOPE);
      const form = new URLSearchParams(fake.tokenRequests()[0].raw.toString());
      expect(createHash('sha256').update(form.get('code_verifier')).digest('base64url')).toBe(result.consentUrl.searchParams.get('code_challenge'));
      expect(form.get('grant_type')).toBe('authorization_code');
    });
  });

  const REFUSED = [
    ['Google grants a wider scope than drive.file', SheetsRefusal.SCOPE_MISMATCH, { fake: { grantedScope: `${DRIVE_FILE_SCOPE} https://www.googleapis.com/auth/gmail.readonly` } }],
    ['Google sends no refresh token', AuthRefusal.NO_REFRESH_TOKEN, { fake: { omitRefreshToken: true } }],
    ['the operator denies consent', AuthRefusal.CONSENT_DENIED, { answer: 'deny' }],
    ['the redirect carries a forged state', AuthRefusal.STATE_MISMATCH, { answer: 'wrong-state' }],
    ['the redirect carries no code', AuthRefusal.NO_CODE, { answer: 'no-code' }],
  ];
  for (const [title, code, options] of REFUSED) {
    it(`@error @driving_adapter refuses ${code} when ${title}, and writes no token file`, async () => {
      const home = aSheetsCredentialHome({ sheetsToken: null, target: null });
      const fake = createSheetsFake(options.fake ?? {});
      await withLoopbackFake(fake, async (baseUrl) => {
        const before = fileDigests(home.directory);

        const result = await operatorConsents(home, baseUrl, { answer: options.answer });

        expect(result.consentUrl.searchParams.get('scope')).toBe(DRIVE_FILE_SCOPE);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(code);
        expect(fileDigests(home.directory)).toEqual(before);
        expect(noSecretsIn(outputOf(result))).toEqual([]);
      });
    });
  }

  it('@error @driving_adapter an unrecognised --target is refused by name, and no consent is started', async () => {
    const home = aSheetsCredentialHome({ sheetsToken: null, target: null });
    const fake = createSheetsFake();
    await withLoopbackFake(fake, async (baseUrl) => {
      const result = await operatorConsents(home, baseUrl, { args: ['auth', '--target', 'drive'] });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(AuthTargetRefusal.UNKNOWN_TARGET);
      expect(result.consentUrl).toBeNull();
      expect(fake.requests).toEqual([]);
    });
  });

  it('@error @driving_adapter operator revokes access, build refuses; re-running auth --target sheets and building again recovers', async () => {
    // Given a recorded Sheet whose grant the operator then revokes
    const workspace = aWorkspaceHoldingAnAlert();
    const home = aSheetsCredentialHome({ gmailToken: aTokenFile() });
    const fake = aTrackerHoldingTheAlertedJob({ issuedRefreshToken: SHEETS_SENTINEL.refreshToken });
    await withLoopbackFake(fake, async (baseUrl) => {
      fake.revokeRefreshToken();
      const refused = await operatorBuilds(workspace, home, baseUrl);
      expect(refused.stderr).toContain(SheetsRefusal.REAUTH_REQUIRED);

      // When the operator consents again and builds
      const consent = await operatorConsents(home, baseUrl);
      const recovered = await operatorBuilds(workspace, home, baseUrl);

      // Then the build succeeds and the recorded Sheet is the one that was already there
      expect(consent.status).toBe(0);
      expect(recovered.status).toBe(0);
      expect(readJsonFile(home.targetPath).spreadsheetId).toBe(aTargetRecord().spreadsheetId);
      expect(tabRows(fake.snapshot(), 'Jobs').rows.find((row) => row[KEY_COLUMN] === ALERT_JOB).Job).toBe('Scrum Master & PMO Lead');
    });
  });
});
