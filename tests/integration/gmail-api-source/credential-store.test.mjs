// @contract-shape:bounded-change
// Adapter-level integration test (real filesystem under a temp HOME, no mocks) for the
// credential store (DR-0011). The store is the only module that touches
// ~/.config/job-alert-harvester; it refuses any file with a group or other permission bit
// and a directory that is not 0700; it writes the token atomically at 0600.
import { describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readdirSync, symlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createCredentialStore, CredentialRefusal } from '../../../src/adapters/credential-store.mjs';
import {
  aCredentialHome,
  aClientFile,
  aTokenFile,
  fileDigests,
  fileModes,
  readJsonFile,
  refusalOf,
  writeText,
  SENTINEL,
} from '../../acceptance/gmail-api-source/support/gmail-domain-types.mjs';
import { assertStateDelta, unchanged } from '../../common/state-delta.mjs';

const storeOver = (home) => createCredentialStore({ directory: home.directory });
const observe = (home) => ({ 'credentials.files': fileDigests(home.directory), 'credentials.modes': fileModes(home.directory) });
const UNIVERSE = ['credentials.files', 'credentials.modes'];

describe('credential store reads what auth left behind', () => {
  it('reads the client id and secret and the recorded token from a well-formed home', () => {
    const store = storeOver(aCredentialHome());

    expect(store.readClient()).toMatchObject({ clientSecret: SENTINEL.clientSecret });
    expect(store.readToken()).toMatchObject({ refreshToken: SENTINEL.refreshToken, emailAddress: 'daniel@daedaluscoaching.com' });
  });

  it('a credential file may carry owner execute; only group and other bits are refused', () => {
    const store = storeOver(aCredentialHome({ clientMode: 0o700 }));

    expect(refusalOf(() => store.readClient())).toBeNull();
  });

  const WIDE_MODES = [0o640, 0o604, 0o644, 0o660, 0o666, 0o601];
  for (const mode of WIDE_MODES) {
    it(`@error refuses a token file at mode ${mode.toString(8)}, never chmodding it quietly`, () => {
      const home = aCredentialHome({ tokenMode: mode });
      const before = observe(home);

      expect(refusalOf(() => storeOver(home).readToken())).toBe(CredentialRefusal.PERMISSIONS);
      assertStateDelta(before, observe(home), { universe: UNIVERSE });
    });
  }

  it('@error refuses a credential directory that is open to its group', () => {
    const home = aCredentialHome({ directoryMode: 0o750 });

    expect(refusalOf(() => storeOver(home).readClient())).toBe(CredentialRefusal.PERMISSIONS);
    expect(refusalOf(() => storeOver(home).probe())).toBe(CredentialRefusal.PERMISSIONS);
  });

  it('@error refuses an absent client file and an absent token file by name', () => {
    expect(refusalOf(() => storeOver(aCredentialHome({ client: null })).readClient())).toBe(CredentialRefusal.MISSING);
    expect(refusalOf(() => storeOver(aCredentialHome({ token: null })).readToken())).toBe(CredentialRefusal.MISSING);
  });

  it('@error refuses a credential directory that does not exist', () => {
    const home = aCredentialHome();
    const store = createCredentialStore({ directory: join(home.home, 'nowhere') });

    expect(refusalOf(() => store.probe())).toBe(CredentialRefusal.MISSING);
  });

  it('@error refuses a file that is not JSON, and one that is JSON but not a credential', () => {
    expect(refusalOf(() => storeOver(aCredentialHome({ client: '{nope' })).readClient())).toBe(CredentialRefusal.INVALID);
    expect(refusalOf(() => storeOver(aCredentialHome({ token: { hello: 'world' } })).readToken())).toBe(CredentialRefusal.INVALID);
  });

  it('@error refuses a symlinked credential file, even one that points at a well-formed file', () => {
    const home = aCredentialHome({ token: null });
    const real = writeText(join(home.home, 'elsewhere.json'), JSON.stringify(aTokenFile()));
    chmodSync(real, 0o600);
    symlinkSync(real, home.tokenPath);

    expect(refusalOf(() => storeOver(home).readToken())).toBe(CredentialRefusal.INVALID);
  });

  it('@error refuses a credential path that is a directory rather than a file', () => {
    const home = aCredentialHome({ token: null });
    mkdirSync(home.tokenPath, { mode: 0o700 });

    expect(refusalOf(() => storeOver(home).readToken())).toBe(CredentialRefusal.INVALID);
  });
});

describe('credential store writes the refresh token', () => {
  it('writes token.json at mode 0600 into a 0700 directory it creates, leaving no temp file behind', () => {
    const home = aCredentialHome({ token: null });
    const store = storeOver(home);

    store.writeToken(aTokenFile());

    expect(readJsonFile(home.tokenPath)).toEqual(aTokenFile());
    expect(statSync(home.tokenPath).mode & 0o777).toBe(0o600);
    expect(statSync(home.directory).mode & 0o777).toBe(0o700);
    expect(readdirSync(home.directory).sort()).toEqual(['client.json', 'token.json']);
  });

  it('creates the directory at 0700 when the operator has none yet', () => {
    const home = aCredentialHome({ token: null });
    const fresh = createCredentialStore({ directory: join(home.home, '.config', 'fresh-dir') });

    fresh.writeToken(aTokenFile());

    expect(statSync(join(home.home, '.config', 'fresh-dir')).mode & 0o777).toBe(0o700);
    expect(existsSync(join(home.home, '.config', 'fresh-dir', 'token.json'))).toBe(true);
  });

  it('replacing a token changes only the token file, byte for byte leaving the client file alone', () => {
    const home = aCredentialHome();
    const before = observe(home);

    storeOver(home).writeToken(aTokenFile({ refreshToken: SENTINEL.refreshTokenRotated }));

    assertStateDelta(before, observe(home), {
      universe: UNIVERSE,
      expected: {
        'credentials.files': { description: 'token.json replaced, client.json identical', holds: (b, a) => a['client.json'] === b['client.json'] && a['token.json'] !== b['token.json'] && Object.keys(a).length === 2 },
        'credentials.modes': unchanged(),
      },
    });
  });

  it('@error refuses to write a token through a symlink, leaving the link target untouched', () => {
    const home = aCredentialHome({ token: null });
    const target = writeText(join(home.home, 'victim.json'), 'precious');
    symlinkSync(target, home.tokenPath);
    const before = fileDigests(home.home);

    expect(refusalOf(() => storeOver(home).writeToken(aTokenFile()))).toBe(CredentialRefusal.INVALID);
    expect(fileDigests(home.home)).toEqual(before);
  });

  it('@error refuses to write into a credential directory that is open to its group', () => {
    const home = aCredentialHome({ token: null, directoryMode: 0o755 });

    expect(refusalOf(() => storeOver(home).writeToken(aTokenFile()))).toBe(CredentialRefusal.PERMISSIONS);
    expect(existsSync(home.tokenPath)).toBe(false);
  });

  it('the client file is never written by the store', () => {
    const home = aCredentialHome({ client: aClientFile() });
    const clientBefore = fileDigests(home.directory)['client.json'];

    storeOver(home).writeToken(aTokenFile());

    expect(fileDigests(home.directory)['client.json']).toBe(clientBefore);
  });
});
