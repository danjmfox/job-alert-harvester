// @contract-shape:unbounded-preservation
// DR-0012 / DESIGN Q9 probe contract: wire, then probe, then use. Everything a probe does is read-only, so a
// failed probe leaves nothing half-done and `--dry-run` can run it. Write ability is deliberately NOT probed with a
// no-op batchUpdate: the atomic apply proves it (SD-09). One scenario per named refusal, including the cases where
// the environment lies (a 200 that is not a Sheet, another Sheet's id, a values answer with no ranges).
// Adapter level: an injected fetch over the fake, real credential files under a temp HOME.
import { describe, expect, it } from 'vitest';
import { chmodSync, rmSync } from 'node:fs';
import {
  DRIVE_FILE_SCOPE,
  GMAIL_READONLY_SCOPE,
  JOBS_COLUMNS,
  KEY_COLUMN,
  SheetsRefusal,
  aSheetsCredentialHome,
  aSheetsTarget,
  aSheetsTokenFile,
  aSpreadsheetBody,
  aTargetRecord,
  aTokenFile,
  aTrackedJob,
  aTrackerFake,
  fileDigests,
  fileModes,
  noSecretsIn,
  refusalOfAsync,
  writeText,
} from './support/sheets-domain-types.mjs';
import { createSheetsFake, forbiddenFor, json, rateLimited, serverError } from './support/sheets-fake.mjs';
import { assertStateDelta } from '../../common/state-delta.mjs';

const credentialsOf = (home) => ({ 'credentials.files': fileDigests(home.directory), 'credentials.modes': fileModes(home.directory) });
const rewrite = (path, content, mode = 0o600) => {
  writeText(path, typeof content === 'string' ? content : JSON.stringify(content));
  chmodSync(path, mode);
};
const aHeaderOnlyJobsSheet = () => createSheetsFake({ tabs: { Jobs: { header: JOBS_COLUMNS, rows: [] } } });

describe('probe: the Sheets target proves it can read before anything is planned (DR-0012)', () => {
  it('passes when credentials, token, scope, Sheet, trash flag and headers all check out, and issues no write-class request', async () => {
    const fake = aTrackerFake();
    const { reader, home } = aSheetsTarget({ fake });
    const before = credentialsOf(home);

    await reader.probe();

    assertStateDelta(before, credentialsOf(home), { universe: ['credentials.files', 'credentials.modes'] });
    expect(fake.writeRequests()).toEqual([]);
    expect(fake.requestsTo('get')).toHaveLength(1);
    expect(fake.requestsTo('drive-get')).toHaveLength(1);
    expect(fake.requestsTo('drive-get')[0].query.fields).toBe('trashed');
    expect(fake.apiRequests().every((request) => request.method === 'GET')).toBe(true);
  });

  it('passes with a header-only Jobs tab and no Companies or Sources tab: they are created on apply', async () => {
    const fake = aHeaderOnlyJobsSheet();
    const { reader } = aSheetsTarget({ fake });

    await reader.probe();

    expect(fake.writeRequests()).toEqual([]);
  });

  it('passes with a Companies tab that has no header at all: an empty tab is treated as new (human-approved)', async () => {
    const fake = createSheetsFake({ tabs: { Jobs: { header: JOBS_COLUMNS, rows: [] }, Companies: { header: [], rows: [] } } });
    const { reader } = aSheetsTarget({ fake });

    await reader.probe();

    expect(fake.writeRequests()).toEqual([]);
  });

  const COMPANIES_WITHOUT_KEY = ['Source Type', 'Jobs Seen'];
  const REFUSALS = [
    ['the client file is absent', SheetsRefusal.CREDENTIAL_MISSING, ({ home }) => rmSync(home.clientPath)],
    ['the Sheets token file is absent', SheetsRefusal.CREDENTIAL_MISSING, ({ home }) => rmSync(home.sheetsTokenPath)],
    ['the client file is not valid', SheetsRefusal.CREDENTIAL_INVALID, ({ home }) => rewrite(home.clientPath, '{nope')],
    ['the Sheets token file names no refresh token', SheetsRefusal.CREDENTIAL_INVALID, ({ home }) => rewrite(home.sheetsTokenPath, aSheetsTokenFile({ refreshToken: '' }))],
    ['the client file is readable by its group', SheetsRefusal.CREDENTIAL_PERMISSIONS, ({ home }) => chmodSync(home.clientPath, 0o640)],
    ['the Sheets token file is readable by everyone', SheetsRefusal.CREDENTIAL_PERMISSIONS, ({ home }) => chmodSync(home.sheetsTokenPath, 0o644)],
    ['the credential directory is open to its group', SheetsRefusal.CREDENTIAL_PERMISSIONS, ({ home }) => chmodSync(home.directory, 0o750)],
    ['no Sheet has been imported yet', SheetsRefusal.NOT_IMPORTED, ({ home }) => rmSync(home.targetPath)],
    ['the target record names no spreadsheet', SheetsRefusal.TARGET_RECORD_INVALID, ({ home }) => rewrite(home.targetPath, { ...aTargetRecord(), spreadsheetId: '' })],
    ['the target record is of an unknown version', SheetsRefusal.TARGET_RECORD_INVALID, ({ home }) => rewrite(home.targetPath, { ...aTargetRecord(), version: 99 })],
    ['the target record is not JSON', SheetsRefusal.TARGET_RECORD_INVALID, ({ home }) => rewrite(home.targetPath, 'spreadsheet: 1')],
    ['the Sheets token file holds the Gmail token', SheetsRefusal.SCOPE_MISMATCH, ({ home }) => rewrite(home.sheetsTokenPath, aTokenFile())],
    ['the refresh token has been revoked', SheetsRefusal.REAUTH_REQUIRED, ({ fake }) => fake.revokeRefreshToken()],
    ['the token endpoint rejects the client', SheetsRefusal.TOKEN_ENDPOINT_ERROR, ({ fake }) => fake.override('token', () => json(401, { error: 'invalid_client' }))],
    ['the token endpoint answers with no access token', SheetsRefusal.TOKEN_ENDPOINT_ERROR, ({ fake }) => fake.override('token', () => json(200, { expires_in: 3599, scope: DRIVE_FILE_SCOPE }))],
    ['the granted scope is wider than drive.file', SheetsRefusal.SCOPE_MISMATCH, ({ fake }) => fake.override('token', () => json(200, { access_token: 'x', expires_in: 3599, scope: `${DRIVE_FILE_SCOPE} ${GMAIL_READONLY_SCOPE}` }))],
    ['the granted scope is narrower than drive.file', SheetsRefusal.SCOPE_MISMATCH, ({ fake }) => fake.override('token', () => json(200, { access_token: 'x', expires_in: 3599, scope: 'openid' }))],
    ['the Sheet is not found', SheetsRefusal.SPREADSHEET_UNREADABLE, ({ fake }) => fake.override('get', () => json(404, { error: { code: 404, message: 'Requested entity was not found.' } }))],
    ['the Sheet is forbidden to this app', SheetsRefusal.SPREADSHEET_UNREADABLE, ({ fake }) => fake.override('get', () => forbiddenFor('forbidden'))],
    ['the Sheet call is unauthenticated even after a refresh', SheetsRefusal.UNAUTHORIZED, ({ fake }) => fake.override('get', () => json(401, { error: { code: 401, message: 'Invalid Credentials' } }))],
    ['quota is exhausted (429 on every attempt)', SheetsRefusal.QUOTA_EXHAUSTED, ({ fake }) => fake.override('get', () => rateLimited())],
    ['quota is exhausted (403 rate reason on every attempt)', SheetsRefusal.QUOTA_EXHAUSTED, ({ fake }) => fake.override('get', () => forbiddenFor('userRateLimitExceeded'))],
    ['Google fails on every attempt', SheetsRefusal.SERVER_ERROR, ({ fake }) => fake.override('get', () => serverError(503))],
    ['the Sheet that answers is not the recorded one', SheetsRefusal.ID_MISMATCH, ({ fake }) => fake.override('get', () => json(200, aSpreadsheetBody({ id: '1SOMEONE-ELSES-sheet' })))],
    ['a 200 answer is an error page, not a Sheet', SheetsRefusal.RESPONSE_MALFORMED, ({ fake }) => fake.override('get', () => new Response('<html>Service Unavailable</html>', { status: 200, headers: { 'content-type': 'text/html' } }))],
    ['the header read answers with no ranges', SheetsRefusal.RESPONSE_MALFORMED, ({ fake }) => fake.override('values', () => json(200, { spreadsheetId: 'x' }))],
    ['the Sheet is in the bin', SheetsRefusal.SPREADSHEET_TRASHED, ({ fake }) => fake.trash()],
    ['the Jobs tab is missing', SheetsRefusal.TAB_MISSING, () => {}, () => createSheetsFake({ tabs: { Notes: { header: ['Thoughts'], rows: [['x']] } } })],
    ['Companies holds data but no Company column', SheetsRefusal.KEY_COLUMN_MISSING, () => {}, () => aTrackerFake({ companiesHeader: COMPANIES_WITHOUT_KEY, companies: [['recruiter', 2]] })],
    ['Jobs holds data but no Dedup Key column', SheetsRefusal.KEY_COLUMN_MISSING, () => {}, () => aTrackerFake({ jobsHeader: JOBS_COLUMNS.filter((column) => column !== KEY_COLUMN) })],
    ['the Jobs tab is empty and has no header at all: the plan cannot write the key header (human-approved)', SheetsRefusal.KEY_COLUMN_MISSING, () => {}, () => createSheetsFake({ tabs: { Jobs: { header: [], rows: [] } } })],
    ['the Jobs tab has a header without Dedup Key and no rows (human-approved)', SheetsRefusal.KEY_COLUMN_MISSING, () => {}, () => createSheetsFake({ tabs: { Jobs: { header: JOBS_COLUMNS.filter((column) => column !== KEY_COLUMN), rows: [] } } })],
    ['Dedup Key is named twice', SheetsRefusal.DUPLICATE_HEADER, () => {}, () => aTrackerFake({ jobs: [aTrackedJob('1')], jobsHeader: [...JOBS_COLUMNS, KEY_COLUMN] })],
  ];

  for (const [title, code, arrange, makeFake = aTrackerFake] of REFUSALS) {
    it(`@error refuses ${code} when ${title}, and leaves the credentials untouched, writes nothing and leaks no secret`, async () => {
      const fake = makeFake();
      const wired = aSheetsTarget({ fake });
      arrange(wired);
      const before = credentialsOf(wired.home);

      const refusal = await refusalOfAsync(() => wired.reader.probe());

      expect(refusal?.code).toBe(code);
      expect(noSecretsIn(refusal.message)).toEqual([]);
      assertStateDelta(before, credentialsOf(wired.home), { universe: ['credentials.files'] });
      expect(fake.writeRequests()).toEqual([]);
    });
  }

  it('@error a revoked refresh token tells the operator to run `harvest auth --target sheets`, never a raw HTTP error', async () => {
    const fake = aTrackerFake();
    fake.revokeRefreshToken();
    const { reader } = aSheetsTarget({ fake });

    const refusal = await refusalOfAsync(() => reader.probe());

    expect(refusal.code).toBe(SheetsRefusal.REAUTH_REQUIRED);
    expect(refusal.message).toContain('harvest auth --target sheets');
    expect(refusal.message).not.toMatch(/\b400\b/);
  });

  it('@error a refused probe reads no cell: the header check is the last thing it does', async () => {
    const fake = aTrackerFake();
    fake.trash();
    const { reader } = aSheetsTarget({ fake });

    await refusalOfAsync(() => reader.probe());

    expect(fake.requestsTo('values')).toEqual([]);
  });
});
