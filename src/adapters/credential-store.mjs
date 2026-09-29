// Driven adapter: the OAuth client file and the refresh-token file under one directory.
// Bounded change universe: <directory>/token.json and its sibling temp file.
// The client file is only ever read. Permission and shape decisions live in core/oauth.mjs.

import { chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { CredentialRefusal, directoryModeRefusal, fileModeRefusal, parseClientFile, parseTokenFile } from '../core/oauth.mjs';

export { CredentialRefusal };

const CLIENT_FILE = 'client.json';
const TOKEN_FILE = 'token.json';
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

const assertDirectoryUsable = (directory) => {
  const stats = lstatOrNull(directory);
  if (stats === null) return refuse(CredentialRefusal.MISSING);
  if (!stats.isDirectory()) return refuse(CredentialRefusal.INVALID);
  return refuseUnless(directoryModeRefusal(permissionBits(stats)));
};

const readCredentialFile = (directory, name, parse) => {
  assertDirectoryUsable(directory);
  const path = join(directory, name);
  const stats = lstatOrNull(path);
  if (stats === null) return refuse(CredentialRefusal.MISSING);
  if (!stats.isFile()) return refuse(CredentialRefusal.INVALID);
  refuseUnless(fileModeRefusal(permissionBits(stats)));
  let json;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return refuse(CredentialRefusal.INVALID);
  }
  return parse(json);
};

const ensurePrivateDirectory = (directory) => {
  if (lstatOrNull(directory) !== null) return assertDirectoryUsable(directory);
  mkdirSync(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  return chmodSync(directory, PRIVATE_DIRECTORY_MODE);
};

const assertTokenPathReplaceable = (tokenPath) => {
  const stats = lstatOrNull(tokenPath);
  return stats === null || stats.isFile() ? undefined : refuse(CredentialRefusal.INVALID);
};

const writeTokenAtomically = (tokenPath, text) => {
  const tempPath = `${tokenPath}.tmp`;
  if (lstatOrNull(tempPath) !== null) unlinkSync(tempPath);
  const descriptor = openSync(tempPath, 'wx', PRIVATE_FILE_MODE);
  try {
    writeSync(descriptor, text);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(tempPath, PRIVATE_FILE_MODE);
  renameSync(tempPath, tokenPath);
};

/** @param {{ directory: string }} options @returns {{ readClient: Function, readToken: Function, writeToken: Function, probe: Function }} */
export function createCredentialStore({ directory }) {
  const tokenPath = join(directory, TOKEN_FILE);

  const writeToken = (token) => {
    const validated = parseTokenFile(token);
    ensurePrivateDirectory(directory);
    assertTokenPathReplaceable(tokenPath);
    writeTokenAtomically(tokenPath, JSON.stringify(validated, null, 2));
  };

  return {
    readClient: () => readCredentialFile(directory, CLIENT_FILE, parseClientFile),
    readToken: () => readCredentialFile(directory, TOKEN_FILE, parseTokenFile),
    writeToken,
    probe: () => assertDirectoryUsable(directory),
  };
}
