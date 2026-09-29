// Driven adapter: the OAuth client file, the Gmail token, the Sheets token and the Sheets target record under one directory.
// Bounded change universe: <directory>/{token,sheets-token,sheets-target}.json and a sibling temp file.
// The client file is only ever read. Permission and shape decisions live in core/oauth.mjs.

import { chmodSync, closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { CredentialRefusal, GMAIL, SHEETS, TARGET_RECORD_VERSION, credentialRefusals, directoryModeRefusal, fileModeRefusal, parseClientFile, parseTargetRecord, parseTokenFile } from '../core/oauth.mjs';
import { ImportRefusal, SheetsRefusal } from '../core/sheets-refusals.mjs';

export { CredentialRefusal, TARGET_RECORD_VERSION };

const CLIENT_FILE = 'client.json';
const TOKEN_FILE = 'token.json';
export const SHEETS_TOKEN_FILE = 'sheets-token.json';
export const SHEETS_TARGET_FILE = 'sheets-target.json';
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

// Messages carry the refusal code only: no credential value may reach an error.
const refuse = (code) => {
  throw Object.assign(new Error(code), { code });
};

const lstatOrNull = (path) => {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
};

const permissionBits = (stats) => stats.mode & 0o777;

const refuseUnless = (refusal) => (refusal === null ? undefined : refuse(refusal));

const assertDirectoryUsable = (directory, profile, missingCode = credentialRefusals(profile).MISSING) => {
  const stats = lstatOrNull(directory);
  if (stats === null) return refuse(missingCode);
  if (!stats.isDirectory()) return refuse(credentialRefusals(profile).INVALID);
  return refuseUnless(directoryModeRefusal(permissionBits(stats), profile));
};

// A regular file with private modes, or a refusal; `missingCode` and `unparseableCode` let the target record differ from a token.
const readCredentialFile = (directory, name, parse, { profile, missingCode, unparseableCode }) => {
  const codes = credentialRefusals(profile);
  assertDirectoryUsable(directory, profile, missingCode);
  const path = join(directory, name);
  const stats = lstatOrNull(path);
  if (stats === null) return refuse(missingCode);
  if (!stats.isFile()) return refuse(codes.INVALID);
  refuseUnless(fileModeRefusal(permissionBits(stats), profile));
  let json;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return refuse(unparseableCode);
  }
  return parse(json, profile);
};

const ensurePrivateDirectory = (directory, profile) => {
  if (lstatOrNull(directory) !== null) return assertDirectoryUsable(directory, profile);
  mkdirSync(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  return chmodSync(directory, PRIVATE_DIRECTORY_MODE);
};

const assertPathReplaceable = (path, profile) => {
  const stats = lstatOrNull(path);
  return stats === null || stats.isFile() ? undefined : refuse(credentialRefusals(profile).INVALID);
};

const writeTempFile = (path, text) => {
  const tempPath = `${path}.tmp`;
  if (lstatOrNull(tempPath) !== null) unlinkSync(tempPath);
  const descriptor = openSync(tempPath, 'wx', PRIVATE_FILE_MODE);
  try {
    writeSync(descriptor, text);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(tempPath, PRIVATE_FILE_MODE);
  return tempPath;
};

const writeAtomically = (path, text) => renameSync(writeTempFile(path, text), path);

// link(2) fails with EEXIST on any existing entry, dangling symlinks included, so the record is never overwritten or followed.
const writeExclusively = (path, text, existsCode) => {
  const tempPath = writeTempFile(path, text);
  try {
    linkSync(tempPath, path);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    refuse(existsCode);
  } finally {
    unlinkSync(tempPath);
  }
};

const tokenSlot = (directory, fileName, profile) => {
  const path = join(directory, fileName);
  const unparseableCode = credentialRefusals(profile).INVALID;
  const missingCode = credentialRefusals(profile).MISSING;
  const options = { profile, missingCode, unparseableCode };
  return {
    readClient: () => readCredentialFile(directory, CLIENT_FILE, parseClientFile, options),
    readToken: () => readCredentialFile(directory, fileName, parseTokenFile, options),
    writeToken: (token) => {
      const validated = parseTokenFile(token, profile);
      ensurePrivateDirectory(directory, profile);
      assertPathReplaceable(path, profile);
      writeAtomically(path, JSON.stringify(validated, null, 2));
    },
    probe: () => assertDirectoryUsable(directory, profile),
  };
};

/** @param {{ directory: string }} options @returns {{ readClient: Function, readToken: Function, writeToken: Function, probe: Function }} */
export function createCredentialStore({ directory }) {
  return tokenSlot(directory, TOKEN_FILE, GMAIL);
}

/**
 * The Sheets side of the credential directory: its own drive.file token slot and the exclusive-create target record.
 * @param {{ directory: string }} options
 * @returns {{ readClient: Function, readSheetsToken: Function, writeSheetsToken: Function, readTarget: Function, writeTarget: Function, sheetsSlot: Function, probe: Function }}
 */
export function createSheetsCredentialStore({ directory }) {
  const slot = tokenSlot(directory, SHEETS_TOKEN_FILE, SHEETS);
  const targetPath = join(directory, SHEETS_TARGET_FILE);
  const readTarget = () =>
    readCredentialFile(directory, SHEETS_TARGET_FILE, parseTargetRecord, {
      profile: SHEETS,
      missingCode: SheetsRefusal.NOT_IMPORTED,
      unparseableCode: SheetsRefusal.TARGET_RECORD_INVALID,
    });
  const writeTarget = (record) => {
    const validated = parseTargetRecord(record, SHEETS);
    ensurePrivateDirectory(directory, SHEETS);
    writeExclusively(targetPath, JSON.stringify(validated, null, 2), ImportRefusal.ALREADY_IMPORTED);
  };
  return {
    readClient: slot.readClient,
    readSheetsToken: slot.readToken,
    writeSheetsToken: slot.writeToken,
    readTarget,
    writeTarget,
    sheetsSlot: () => slot,
    probe: slot.probe,
  };
}
