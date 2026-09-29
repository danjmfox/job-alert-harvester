// Driven adapter. RED scaffold (DISTILL): creates one native Sheet from a workbook through Drive, and deletes
// only a file id it created in this process. It has no update operation.
// Bounded change universe: exactly one created file.
export const __SCAFFOLD__ = true;

const scaffold = (name) => {
  throw new Error(`RED scaffold: ${name} is not implemented`);
};

/**
 * @param {{ transport: { write: object }, endpoints: object, tokenSource: object }} options
 * @returns {{ create: Function, delete: Function, probe: Function }}
 *   create({ name, workbookBytes }) resolves { spreadsheetId }.
 */
export function createSheetProvisioner(options) {
  return {
    create: () => scaffold('provisioner.create'),
    delete: () => scaffold('provisioner.delete'),
    probe: () => scaffold('provisioner.probe'),
  };
}
