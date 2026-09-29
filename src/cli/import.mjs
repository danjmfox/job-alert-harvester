// Orchestration of the one-off `harvest import --from <file.xlsx>`. RED scaffold (DISTILL). Collaborators arrive as arguments.
export const __SCAFFOLD__ = true;

/**
 * @param {{ from: string, store: object, workbook: { probe: Function, read: Function }, provisioner: object,
 *           sheets: (spreadsheetId: string) => { reader: object, writer: object },
 *           print: (line: string) => void, now: () => string }} collaborators
 * @returns {Promise<{ spreadsheetId: string }>}
 */
export async function runImport(collaborators) {
  throw new Error('RED scaffold: runImport is not implemented');
}
