// @contract-shape:bounded-change
// DR-0012 / DESIGN Q6: the Drive provisioner creates exactly one native Sheet from a workbook and may delete only the
// id it created in this process. It has no update operation, so a second Sheet or an overwrite is not something it can
// do. The create is sent once: replaying an ambiguous create could make two Sheets. Adapter level: injected fetch.
import { describe, expect, it } from 'vitest';
import {
  DriveRefusal,
  NATIVE_SHEET_MIME,
  SheetsRefusal,
  aProvisioner,
  aSheetsCredentialHome,
  aTrackedJob,
  aTracker,
  aWorkbookBytes,
  noSecretsIn,
  refusalOfAsync,
  tabRows,
} from './support/sheets-domain-types.mjs';
import { createSheetsFake, forbiddenFor, json, rateLimited, serverError } from './support/sheets-fake.mjs';
import { assertStateDelta, grownBy, unchanged } from '../../common/state-delta.mjs';

const aWorkbook = () => aWorkbookBytes(aTracker({ jobs: [aTrackedJob('1'), aTrackedJob('2')] }));
const observeDrive = (fake) => ({ 'drive.files': fake.files() });
const creation = () => ({ name: 'Job tracker', workbookBytes: aWorkbook() });

describe('creating the tracker Sheet from the operator workbook', () => {
  it('@real-io @adapter-integration uploads the workbook once as a native Sheet and returns its id', async () => {
    const fake = createSheetsFake();
    const { provisioner } = aProvisioner({ fake });
    const before = observeDrive(fake);

    const { spreadsheetId } = await provisioner.create(creation());

    assertStateDelta(before, observeDrive(fake), { universe: ['drive.files'], expected: { 'drive.files': grownBy(1) } });
    expect(fake.files()[0]).toMatchObject({ id: spreadsheetId, mimeType: NATIVE_SHEET_MIME, name: 'Job tracker' });
    expect(fake.driveCreates()).toHaveLength(1);
    expect(fake.driveCreates()[0].query.uploadType).toBe('multipart');
    expect(fake.driveCreates()[0].contentType).toMatch(/^multipart\/related; boundary=/);
    expect(tabRows(fake.snapshot(spreadsheetId), 'Jobs').rows.map((row) => row['Dedup Key'])).toEqual(['linkedin:1', 'linkedin:2']);
  });

  it('sends the workbook bytes as they are, asks for the native Sheet type, and issues no other write', async () => {
    const fake = createSheetsFake();
    const { provisioner } = aProvisioner({ fake });
    const workbookBytes = aWorkbook();

    await provisioner.create({ name: 'Job tracker', workbookBytes });

    expect(Buffer.from(fake.driveCreates()[0].raw).includes(Buffer.from(workbookBytes))).toBe(true);
    expect(fake.driveCreates()[0].driveMetadata).toMatchObject({ mimeType: NATIVE_SHEET_MIME, name: 'Job tracker' });
    expect(fake.writeRequests().map((request) => request.route)).toEqual(['drive-create']);
  });

  it('never follows a link in the answer: the file is not opened, fetched or listed', async () => {
    const fake = createSheetsFake();
    fake.override('drive-create', () => json(200, { id: 'created-1', mimeType: NATIVE_SHEET_MIME, name: 'x', webViewLink: 'https://evil.invalid/steal', spreadsheetUrl: 'https://evil.invalid/steal' }));
    const { provisioner } = aProvisioner({ fake });

    const { spreadsheetId } = await provisioner.create(creation());

    expect(spreadsheetId).toBe('created-1');
    expect(fake.apiRequests()).toHaveLength(1);
  });

  it('offers create, delete and probe and nothing that could update a file', () => {
    const { provisioner } = aProvisioner({ fake: createSheetsFake() });

    expect(Object.keys(provisioner).sort()).toEqual(['create', 'delete', 'probe']);
  });

  it('@error a create whose answer is lost is reported after ONE attempt: a replay could make a second Sheet', async () => {
    const fake = createSheetsFake();
    fake.override('drive-create', () => serverError(503));
    const { provisioner } = aProvisioner({ fake });

    const refusal = await refusalOfAsync(() => provisioner.create(creation()));

    expect(refusal?.code).toBe(DriveRefusal.SERVER_ERROR);
    expect(fake.driveCreates()).toHaveLength(1);
  });

  const FAILURES = [
    ['Drive throttles the upload', () => rateLimited({ retryAfter: 1 }), DriveRefusal.QUOTA_EXHAUSTED],
    ['the operator Drive is full', () => forbiddenFor('storageQuotaExceeded'), DriveRefusal.STORAGE_FULL],
    ['the app is not authorised for Drive', () => forbiddenFor('forbidden'), DriveRefusal.UNAUTHORIZED],
    ['the token is refused even after a refresh', () => json(401, { error: { code: 401, message: 'Invalid Credentials' } }), DriveRefusal.UNAUTHORIZED],
    ['Drive is failing', () => serverError(500), DriveRefusal.SERVER_ERROR],
    ['Drive rejects the upload as malformed', () => json(400, { error: { code: 400, message: 'Bad Request' } }), DriveRefusal.REQUEST_REJECTED],
    ['a 200 answer names no file id', () => json(200, { kind: 'drive#file', name: 'x' }), DriveRefusal.RESPONSE_MALFORMED],
    ['a 200 answer is not JSON', () => new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } }), DriveRefusal.RESPONSE_MALFORMED],
    ['a 200 answer names a file that is not a native Sheet', () => json(200, { id: 'x', mimeType: 'application/pdf', name: 'x' }), DriveRefusal.RESPONSE_MALFORMED],
  ];
  for (const [title, answer, code] of FAILURES) {
    it(`@error refuses ${code} when ${title}, creates nothing and leaks no secret`, async () => {
      const fake = createSheetsFake();
      fake.override('drive-create', answer);
      const { provisioner } = aProvisioner({ fake });
      const before = observeDrive(fake);

      const refusal = await refusalOfAsync(() => provisioner.create(creation()));

      expect(refusal?.code).toBe(code);
      expect(noSecretsIn(refusal.message)).toEqual([]);
      assertStateDelta(before, observeDrive(fake), { universe: ['drive.files'], expected: { 'drive.files': unchanged() } });
    });
  }
});

describe('deleting what this process created, and only that', () => {
  it('removes the file it created and issues exactly one delete for that id', async () => {
    const fake = createSheetsFake();
    const { provisioner } = aProvisioner({ fake });
    const { spreadsheetId } = await provisioner.create(creation());

    await provisioner.delete(spreadsheetId);

    expect(fake.files()).toEqual([]);
    expect(fake.requestsTo('drive-delete').map((request) => request.id)).toEqual([spreadsheetId]);
  });

  it('@error refuses drive.not-created-here for any other id, and sends no request', async () => {
    const fake = createSheetsFake({ tabs: { Jobs: { header: ['Dedup Key'], rows: [] } } });
    const { provisioner } = aProvisioner({ fake });
    const before = observeDrive(fake);

    const refusal = await refusalOfAsync(() => provisioner.delete(fake.spreadsheetId));

    expect(refusal?.code).toBe(DriveRefusal.NOT_CREATED_HERE);
    expect(fake.apiRequests()).toEqual([]);
    assertStateDelta(before, observeDrive(fake), { universe: ['drive.files'], expected: { 'drive.files': unchanged() } });
  });

  it('@error a second provisioner in another process cannot delete what the first created', async () => {
    const fake = createSheetsFake();
    const first = aProvisioner({ fake });
    const { spreadsheetId } = await first.provisioner.create(creation());
    const second = aProvisioner({ fake });

    const refusal = await refusalOfAsync(() => second.provisioner.delete(spreadsheetId));

    expect(refusal?.code).toBe(DriveRefusal.NOT_CREATED_HERE);
    expect(fake.files().map((file) => file.id)).toEqual([spreadsheetId]);
  });

  it('@error a delete Drive refuses is reported by name and leaves the file', async () => {
    const fake = createSheetsFake();
    const { provisioner } = aProvisioner({ fake });
    const { spreadsheetId } = await provisioner.create(creation());
    fake.override('drive-delete', () => forbiddenFor('forbidden'));

    const refusal = await refusalOfAsync(() => provisioner.delete(spreadsheetId));

    expect(refusal?.code).toBe(DriveRefusal.UNAUTHORIZED);
    expect(fake.files()).toHaveLength(1);
  });
});

describe('the provisioner probe proves the credential without touching Drive', () => {
  it('passes with a refreshable drive.file token, and issues no Drive or Sheets request', async () => {
    const fake = createSheetsFake();
    const { provisioner } = aProvisioner({ fake });

    await provisioner.probe();

    expect(fake.apiRequests()).toEqual([]);
    expect(fake.tokenRequests()).toHaveLength(1);
  });

  const PROBE_FAILURES = [
    ['the Sheets token file is absent', SheetsRefusal.CREDENTIAL_MISSING, () => aSheetsCredentialHome({ sheetsToken: null }), () => {}],
    ['the refresh token was revoked', SheetsRefusal.REAUTH_REQUIRED, () => aSheetsCredentialHome(), (fake) => fake.revokeRefreshToken()],
    ['the granted scope is wider than drive.file', SheetsRefusal.SCOPE_MISMATCH, () => aSheetsCredentialHome(), (fake) => fake.override('token', () => json(200, { access_token: 'x', expires_in: 3599, scope: 'https://www.googleapis.com/auth/drive' }))],
  ];
  for (const [title, code, home, arrange] of PROBE_FAILURES) {
    it(`@error refuses ${code} when ${title}`, async () => {
      const fake = createSheetsFake();
      arrange(fake);
      const { provisioner } = aProvisioner({ fake, home: home() });

      const refusal = await refusalOfAsync(() => provisioner.probe());

      expect(refusal?.code).toBe(code);
      expect(fake.apiRequests()).toEqual([]);
    });
  }
});
