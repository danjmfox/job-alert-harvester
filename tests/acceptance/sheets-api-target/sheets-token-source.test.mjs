// @contract-shape:bounded-change
// SD-10 / SD-11: the token source built for the Sheets slot refreshes the drive.file token from sheets-token.json,
// persists a rotated refresh token there and nowhere else, and never lets an access token reach disk. The Gmail token
// file is untouched by anything the Sheets side does. Adapter level: injected fetch over the fake, real credential files.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createGoogleTokenSource } from '../../../src/adapters/google-token-source.mjs';
import { createSheetsCredentialStore } from '../../../src/adapters/sheets-credential-store.mjs';
import {
  DRIVE_FILE_SCOPE,
  GOOGLE_ENDPOINTS,
  NOW_MS,
  SENTINEL,
  SHEETS,
  SHEETS_SENTINEL,
  SheetsRefusal,
  aSheetsCredentialHome,
  aTokenFile,
  fileDigests,
  noSecretsIn,
  readJsonFile,
  refusalOfAsync,
} from './support/sheets-domain-types.mjs';
import { createSheetsFake, json } from './support/sheets-fake.mjs';
import { assertStateDelta, setTo, unchanged } from '../../common/state-delta.mjs';
import { scenario } from './support/red-gate.mjs';

function aSheetsTokenSource({ fake, home = aSheetsCredentialHome() }) {
  const store = createSheetsCredentialStore({ directory: home.directory });
  const tokenSource = createGoogleTokenSource({ store: store.sheetsSlot(), fetch: (url, init) => fake.handle(url, init), endpoints: GOOGLE_ENDPOINTS, nowMs: () => NOW_MS, sleep: async () => {}, jitter: () => 0.5, profile: SHEETS });
  return { tokenSource, home };
}
const observeFiles = (home) => ({
  'gmail.token': readFileSync(home.tokenPath, 'utf8'),
  'sheets.refreshToken': readJsonFile(home.sheetsTokenPath).refreshToken,
  'credentials.files': Object.keys(fileDigests(home.directory)).sort(),
});
const UNIVERSE = ['gmail.token', 'sheets.refreshToken', 'credentials.files'];

describe('the Sheets token source', () => {
  scenario('@real-io @adapter-integration refreshes with the Sheets refresh token and the client file, and answers drive.file', async () => {
    const fake = createSheetsFake();
    const { tokenSource, home } = aSheetsTokenSource({ fake });
    const before = observeFiles(home);

    const accessToken = await tokenSource.accessToken();

    expect(accessToken).toBe(SHEETS_SENTINEL.accessToken);
    const [request] = fake.tokenRequests();
    expect(request.raw.toString()).toContain(encodeURIComponent(SHEETS_SENTINEL.refreshToken));
    expect(request.raw.toString()).not.toContain(encodeURIComponent(SENTINEL.refreshToken));
    assertStateDelta(before, observeFiles(home), { universe: UNIVERSE, expected: { 'gmail.token': unchanged(), 'sheets.refreshToken': unchanged(), 'credentials.files': unchanged() } });
  });

  scenario('refreshes once per process: a second request reuses the access token in memory', async () => {
    const fake = createSheetsFake();
    const { tokenSource } = aSheetsTokenSource({ fake });

    await tokenSource.accessToken();
    await tokenSource.accessToken();

    expect(fake.tokenRequests()).toHaveLength(1);
  });

  scenario('persists a rotated refresh token into sheets-token.json only, and never an access token to disk', async () => {
    const fake = createSheetsFake({ rotateRefreshTo: SHEETS_SENTINEL.refreshTokenRotated });
    const { tokenSource, home } = aSheetsTokenSource({ fake });
    const before = observeFiles(home);

    await tokenSource.accessToken();

    assertStateDelta(before, observeFiles(home), {
      universe: UNIVERSE,
      expected: { 'gmail.token': unchanged(), 'sheets.refreshToken': setTo(SHEETS_SENTINEL.refreshTokenRotated), 'credentials.files': unchanged() },
    });
    const everything = Object.keys(fileDigests(home.directory)).map((name) => readFileSync(`${home.directory}/${name}`, 'utf8')).join('\n');
    expect(everything).not.toContain(SHEETS_SENTINEL.accessToken);
    expect(readJsonFile(home.sheetsTokenPath).scope).toBe(DRIVE_FILE_SCOPE);
  });

  scenario('@error refuses sheets.scope-mismatch when Google grants more than drive.file, and changes no file', async () => {
    const fake = createSheetsFake({ grantedScope: `${DRIVE_FILE_SCOPE} https://www.googleapis.com/auth/gmail.readonly` });
    const { tokenSource, home } = aSheetsTokenSource({ fake });
    const before = observeFiles(home);

    const refusal = await refusalOfAsync(() => tokenSource.accessToken());

    expect(refusal?.code).toBe(SheetsRefusal.SCOPE_MISMATCH);
    assertStateDelta(before, observeFiles(home), { universe: UNIVERSE, expected: { 'gmail.token': unchanged(), 'sheets.refreshToken': unchanged(), 'credentials.files': unchanged() } });
  });

  scenario('@error names sheets.reauth-required, and `harvest auth --target sheets`, when the grant was revoked', async () => {
    const fake = createSheetsFake();
    fake.revokeRefreshToken();
    const { tokenSource } = aSheetsTokenSource({ fake });

    const refusal = await refusalOfAsync(() => tokenSource.accessToken());

    expect(refusal?.code).toBe(SheetsRefusal.REAUTH_REQUIRED);
    expect(refusal.message).toContain('harvest auth --target sheets');
    expect(noSecretsIn(refusal.message)).toEqual([]);
  });

  scenario('@error a token endpoint that answers with no access token is sheets.token-endpoint-error', async () => {
    const fake = createSheetsFake();
    fake.override('token', () => json(200, { expires_in: 3599, scope: DRIVE_FILE_SCOPE }));
    const { tokenSource } = aSheetsTokenSource({ fake });

    expect((await refusalOfAsync(() => tokenSource.accessToken()))?.code).toBe(SheetsRefusal.TOKEN_ENDPOINT_ERROR);
  });

  scenario('@error a Gmail token file sitting in the Sheets slot is refused as sheets.scope-mismatch before any request', async () => {
    const fake = createSheetsFake();
    const home = aSheetsCredentialHome({ sheetsToken: aTokenFile() });
    const { tokenSource } = aSheetsTokenSource({ fake, home });

    const refusal = await refusalOfAsync(() => tokenSource.accessToken());

    expect(refusal?.code).toBe(SheetsRefusal.SCOPE_MISMATCH);
    expect(fake.requests).toEqual([]);
  });
});
