// Driven adapter: the OAuth client file and the refresh-token file under one directory.
// Bounded change universe: <directory>/token.json and its sibling temp file.
export const __SCAFFOLD__ = true;

export { CredentialRefusal } from '../core/oauth.mjs';

const scaffold = (name) => {
  throw new Error(`RED scaffold: credential-store ${name} is not implemented`);
};

/** @param {{ directory: string }} options @returns {{ readClient: Function, readToken: Function, writeToken: Function, probe: Function }} */
export function createCredentialStore(_options) {
  return {
    readClient: () => scaffold('readClient'),
    readToken: () => scaffold('readToken'),
    writeToken: () => scaffold('writeToken'),
    probe: () => scaffold('probe'),
  };
}
