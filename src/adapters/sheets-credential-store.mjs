// Driven adapter. RED scaffold (DISTILL): the credential store's Sheets extension, held apart only because
// DISTILL may not edit credential-store.mjs. DELIVER folds it into that module (DESIGN Q5) and deletes this file.
// Change universe: <directory>/sheets-token.json and sheets-target.json plus tmp; client.json and token.json are never written.
export const __SCAFFOLD__ = true;

export const SHEETS_TOKEN_FILE = 'sheets-token.json';
export const SHEETS_TARGET_FILE = 'sheets-target.json';
export const TARGET_RECORD_VERSION = 1;

const scaffold = (name) => {
  throw new Error(`RED scaffold: ${name} is not implemented`);
};

/**
 * @returns {{ readClient: Function, readSheetsToken: Function, writeSheetsToken: Function,
 *   readTarget: Function, writeTarget: Function, sheetsSlot: Function, probe: Function }}
 *   sheetsSlot() is a view with readClient, readToken, writeToken and probe bound to the Sheets token file.
 */
export function createSheetsCredentialStore({ directory }) {
  return {
    readClient: () => scaffold('readClient'),
    readSheetsToken: () => scaffold('readSheetsToken'),
    writeSheetsToken: () => scaffold('writeSheetsToken'),
    readTarget: () => scaffold('readTarget'),
    writeTarget: () => scaffold('writeTarget'),
    sheetsSlot: () => scaffold('sheetsSlot'),
    probe: () => scaffold('probe'),
  };
}
