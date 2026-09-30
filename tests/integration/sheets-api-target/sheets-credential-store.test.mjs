// @contract-shape:bounded-change
// SD-10 / SD-11 (DESIGN Q5): the credential store gains the Sheets token slot and the target record, and stays the only
// module that touches ~/.config. Change universe: sheets-token.json and sheets-target.json under the credential
// directory, plus their sibling temp files. client.json and token.json are never written. The target record is written
// by exclusive create, so an existing record can never be overwritten. Adapter level: real filesystem, modes set explicitly.
import { describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createSheetsCredentialStore } from '../../../src/adapters/credential-store.mjs';
import {
  ImportRefusal,
  SHEETS_SENTINEL,
  SHEETS_TARGET_FILE,
  SHEETS_TOKEN_FILE,
  SheetsRefusal,
  aClientFile,
  aSheetsCredentialHome,
  aSheetsTokenFile,
  aTargetRecord,
  aTokenFile,
  fileDigests,
  fileModes,
  noSecretsIn,
  readJsonFile,
  refusalOf,
  writeText,
} from '../../acceptance/sheets-api-target/support/sheets-domain-types.mjs';
import { assertStateDelta, setTo, unchanged } from '../../common/state-delta.mjs';

const storeOver = (home) => createSheetsCredentialStore({ directory: home.directory });
const observe = (home) => ({ 'directory.files': fileDigests(home.directory), 'directory.modes': fileModes(home.directory) });
const untouched = (home, names) => Object.fromEntries(Object.entries(fileDigests(home.directory)).filter(([name]) => names.includes(name)));
const OTHERS = ['client.json', 'token.json'];

describe('the target record: which Sheet is the tracker', () => {
  it('@real-io @adapter-integration reads the record the import left', () => {
    const home = aSheetsCredentialHome();

    expect(storeOver(home).readTarget()).toEqual(aTargetRecord());
  });

  it('writes the record with exclusive create, mode 0600, leaving every other file and no temp file behind', () => {
    const home = aSheetsCredentialHome({ target: null });
    const before = observe(home);

    storeOver(home).writeTarget(aTargetRecord());

    assertStateDelta(before, observe(home), {
      universe: ['directory.files', 'directory.modes'],
      expected: {
        'directory.files': { description: 'gains the record only', holds: (b, a) => Object.keys(a).sort().join() === [...Object.keys(b), SHEETS_TARGET_FILE].sort().join() && OTHERS.every((name) => a[name] === b[name]) },
        'directory.modes': { description: 'record is 0600', holds: (_b, a) => a[SHEETS_TARGET_FILE] === '600' },
      },
    });
    expect(readJsonFile(home.targetPath)).toEqual(aTargetRecord());
  });

  it('@error refuses to overwrite an existing record, whatever it holds, and leaves it byte-identical', () => {
    const home = aSheetsCredentialHome({ target: aTargetRecord({ spreadsheetId: 'the-operators-sheet' }) });
    const before = observe(home);

    const code = refusalOf(() => storeOver(home).writeTarget(aTargetRecord({ spreadsheetId: 'another-sheet' })));

    expect(code).toBe(ImportRefusal.ALREADY_IMPORTED);
    assertStateDelta(before, observe(home), { universe: ['directory.files', 'directory.modes'], expected: { 'directory.files': unchanged(), 'directory.modes': unchanged() } });
  });

  const BROKEN = [
    ['is absent', SheetsRefusal.NOT_IMPORTED, { target: null }],
    ['is not JSON', SheetsRefusal.TARGET_RECORD_INVALID, { target: 'spreadsheet: 1' }],
    ['is a JSON array', SheetsRefusal.TARGET_RECORD_INVALID, { target: '[]' }],
    ['names no spreadsheet', SheetsRefusal.TARGET_RECORD_INVALID, { target: { ...aTargetRecord(), spreadsheetId: '' } }],
    ['names a spreadsheet that is not text', SheetsRefusal.TARGET_RECORD_INVALID, { target: { ...aTargetRecord(), spreadsheetId: 42 } }],
    ['is of an unknown version', SheetsRefusal.TARGET_RECORD_INVALID, { target: { ...aTargetRecord(), version: 99 } }],
    ['is readable by its group', SheetsRefusal.CREDENTIAL_PERMISSIONS, { targetMode: 0o640 }],
    ['sits in a directory open to its group', SheetsRefusal.CREDENTIAL_PERMISSIONS, { directoryMode: 0o750 }],
  ];
  for (const [title, code, options] of BROKEN) {
    it(`@error refuses ${code} when the record ${title}, and writes nothing`, () => {
      const home = aSheetsCredentialHome(options);
      const before = observe(home);

      expect(refusalOf(() => storeOver(home).readTarget())).toBe(code);
      assertStateDelta(before, observe(home), { universe: ['directory.files', 'directory.modes'], expected: { 'directory.files': unchanged(), 'directory.modes': unchanged() } });
    });
  }

  it('@error refuses a record whose shape is wrong before writing, so a bad id is never stored', () => {
    const home = aSheetsCredentialHome({ target: null });
    const before = observe(home);

    expect(refusalOf(() => storeOver(home).writeTarget({ version: 1, spreadsheetId: '' }))).toBe(SheetsRefusal.TARGET_RECORD_INVALID);
    assertStateDelta(before, observe(home), { universe: ['directory.files'], expected: { 'directory.files': unchanged() } });
  });

  it('@error a symlink or a directory where the record should be is refused as sheets.credential-invalid, and never followed', () => {
    const home = aSheetsCredentialHome({ target: null });
    const elsewhere = writeText(join(home.home, 'elsewhere.json'), JSON.stringify(aTargetRecord()));
    symlinkSync(elsewhere, home.targetPath);
    const store = storeOver(home);

    expect(refusalOf(() => store.readTarget())).toBe(SheetsRefusal.CREDENTIAL_INVALID);
    expect(refusalOf(() => store.writeTarget(aTargetRecord()))).toBe(ImportRefusal.ALREADY_IMPORTED);
    expect(readFileSync(elsewhere, 'utf8')).toBe(JSON.stringify(aTargetRecord()));
  });
});

describe('the Sheets token slot: sheets-token.json, beside and never inside the Gmail token', () => {
  it('reads the Sheets token file and the client file through the slot view', () => {
    const home = aSheetsCredentialHome();
    const slot = storeOver(home).sheetsSlot();

    expect(slot.readToken()).toEqual(aSheetsTokenFile());
    expect(slot.readClient()).toEqual({ clientId: aClientFile().installed.client_id, clientSecret: aClientFile().installed.client_secret });
    expect(() => slot.probe()).not.toThrow();
  });

  it('writes a rotated token atomically at 0600 into the Sheets file only; client and Gmail token stay byte-identical', () => {
    const home = aSheetsCredentialHome();
    const before = untouched(home, OTHERS);
    const modesBefore = fileModes(home.directory);

    storeOver(home).sheetsSlot().writeToken(aSheetsTokenFile({ refreshToken: SHEETS_SENTINEL.refreshTokenRotated }));

    expect(readJsonFile(home.sheetsTokenPath).refreshToken).toBe(SHEETS_SENTINEL.refreshTokenRotated);
    expect(untouched(home, OTHERS)).toEqual(before);
    expect(fileModes(home.directory)[SHEETS_TOKEN_FILE]).toBe('600');
    expect(Object.keys(fileModes(home.directory)).sort()).toEqual(Object.keys(modesBefore).sort());
  });

  it('creates the Sheets token file, and the directory at 0700, for a first consent', () => {
    const home = aSheetsCredentialHome({ sheetsToken: null, target: null });

    storeOver(home).writeSheetsToken(aSheetsTokenFile());

    expect(fileModes(home.directory)[SHEETS_TOKEN_FILE]).toBe('600');
    expect(readJsonFile(home.sheetsTokenPath)).toEqual(aSheetsTokenFile());
  });

  it('@error refuses to store the Gmail token in the Sheets slot, or a Sheets token with no refresh token, and writes nothing', () => {
    const home = aSheetsCredentialHome();
    const before = observe(home);
    const store = storeOver(home);

    expect(refusalOf(() => store.writeSheetsToken(aTokenFile()))).toBe(SheetsRefusal.SCOPE_MISMATCH);
    expect(refusalOf(() => store.writeSheetsToken(aSheetsTokenFile({ refreshToken: '' })))).toBe(SheetsRefusal.CREDENTIAL_INVALID);
    assertStateDelta(before, observe(home), { universe: ['directory.files', 'directory.modes'], expected: { 'directory.files': unchanged(), 'directory.modes': unchanged() } });
  });

  it('@error refuses a Gmail token file read as the Sheets slot, and a Sheets token file read as the Gmail slot is not the store business', () => {
    const home = aSheetsCredentialHome({ sheetsToken: aTokenFile() });

    expect(refusalOf(() => storeOver(home).readSheetsToken())).toBe(SheetsRefusal.SCOPE_MISMATCH);
  });

  const UNREADABLE = [
    ['is absent', SheetsRefusal.CREDENTIAL_MISSING, { sheetsToken: null }],
    ['is not JSON', SheetsRefusal.CREDENTIAL_INVALID, { sheetsToken: '{nope' }],
    ['is readable by everyone', SheetsRefusal.CREDENTIAL_PERMISSIONS, { sheetsTokenMode: 0o644 }],
    ['sits in a directory open to its group', SheetsRefusal.CREDENTIAL_PERMISSIONS, { directoryMode: 0o750 }],
  ];
  for (const [title, code, options] of UNREADABLE) {
    it(`@error refuses ${code} when the Sheets token file ${title}, without a credential value in the message`, () => {
      const home = aSheetsCredentialHome(options);
      let refusal = null;
      try {
        storeOver(home).readSheetsToken();
      } catch (error) {
        refusal = error;
      }

      expect(refusal?.code).toBe(code);
      expect(noSecretsIn(refusal.message)).toEqual([]);
    });
  }

  it('@error a symlink at the Sheets token path is never followed or replaced', () => {
    const home = aSheetsCredentialHome({ sheetsToken: null });
    const elsewhere = writeText(join(home.home, 'elsewhere.json'), 'untouched');
    symlinkSync(elsewhere, home.sheetsTokenPath);
    const store = storeOver(home);

    expect(refusalOf(() => store.readSheetsToken())).toBe(SheetsRefusal.CREDENTIAL_INVALID);
    expect(refusalOf(() => store.writeSheetsToken(aSheetsTokenFile()))).toBe(SheetsRefusal.CREDENTIAL_INVALID);
    expect(readFileSync(elsewhere, 'utf8')).toBe('untouched');
  });

  it('@error the client file is only ever read: a refused client leaves it byte-identical and mode-unchanged', () => {
    const home = aSheetsCredentialHome({ client: '{nope' });
    const before = untouched(home, ['client.json']);
    chmodSync(home.clientPath, 0o600);

    expect(refusalOf(() => storeOver(home).readClient())).toBe(SheetsRefusal.CREDENTIAL_INVALID);
    expect(untouched(home, ['client.json'])).toEqual(before);
    expect(existsSync(`${home.clientPath}.tmp`)).toBe(false);
  });

  it('the store change universe: after every write the directory holds only the four named files', () => {
    const home = aSheetsCredentialHome({ sheetsToken: null, target: null });
    mkdirSync(join(home.directory), { recursive: true });
    const store = storeOver(home);

    store.writeSheetsToken(aSheetsTokenFile());
    store.writeSheetsToken(aSheetsTokenFile({ refreshToken: SHEETS_SENTINEL.refreshTokenRotated }));
    store.writeTarget(aTargetRecord());

    assertStateDelta({ 'directory.names': [] }, { 'directory.names': Object.keys(fileDigests(home.directory)).sort() }, {
      universe: ['directory.names'],
      expected: { 'directory.names': setTo(['client.json', SHEETS_TARGET_FILE, SHEETS_TOKEN_FILE, 'token.json']) },
    });
  });
});
