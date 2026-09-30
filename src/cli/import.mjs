// Orchestration of the one-off `harvest import --from <file.xlsx>` (DR-0012). Collaborators arrive as arguments.
// Sequence: refuse if recorded, check the workbook, create, read back and verify, record, then bind row keys.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { checkConversion, checkWorkbook } from '../core/import-check.mjs';
import { TARGET_RECORD_VERSION } from '../core/oauth.mjs';
import { ImportRefusal, SheetsRefusal } from '../core/sheets-refusals.mjs';

// Messages carry the refusal code and a file id only: no credential value may reach an error.
const refuse = (code, detail) => {
  throw Object.assign(new Error(detail ? `${code}: ${detail}` : code), { code });
};

const refuseIfRecorded = (store) => {
  try {
    store.readTarget();
  } catch (error) {
    if (error?.code === SheetsRefusal.NOT_IMPORTED) return;
    if (error?.code === SheetsRefusal.TARGET_RECORD_INVALID) refuse(ImportRefusal.ALREADY_IMPORTED);
    throw error;
  }
  refuse(ImportRefusal.ALREADY_IMPORTED);
};

const readWorkbookBytes = (path) => {
  try {
    return readFileSync(path);
  } catch {
    return refuse(ImportRefusal.FILE_MISSING);
  }
};

const readWorkbookState = (workbook) => {
  try {
    return workbook.read();
  } catch {
    return refuse(ImportRefusal.NOT_A_WORKBOOK);
  }
};

/** Deletes the file this process created; on failure names its id so the operator can remove it. */
const abandon = async ({ provisioner, print }, spreadsheetId) => {
  try {
    await provisioner.delete(spreadsheetId);
    return null;
  } catch {
    const note = `could not delete the created Sheet ${spreadsheetId}; remove it manually`;
    print(`import: ${note}`);
    return note;
  }
};

const verifyConversion = async ({ sheets }, spreadsheetId, workbookState) =>
  checkConversion({ workbookState, convertedState: await sheets(spreadsheetId).reader.read() });

const recordTarget = ({ store, now }, spreadsheetId) => {
  try {
    store.writeTarget({ version: TARGET_RECORD_VERSION, spreadsheetId, importedAt: now() });
  } catch (error) {
    throw Object.assign(new Error(error?.code ?? 'the record could not be written'), { code: ImportRefusal.RECORD_FAILED });
  }
};

/** Binding is the last step and never fatal: unbound rows are healed by the next build. */
const bindRowKeys = async ({ sheets, print }, spreadsheetId) => {
  try {
    const { bound, pending } = await sheets(spreadsheetId).writer.bindRowKeys();
    print(`import: bound ${bound} row keys, ${pending} pending`);
  } catch {
    print('import: row keys not bound; the next build binds them');
  }
};

/**
 * @param {{ from: string, store: object, workbook: { probe: Function, read: Function }, provisioner: object,
 *           sheets: (spreadsheetId: string) => { reader: object, writer: object },
 *           print: (line: string) => void, now: () => string }} collaborators
 * @returns {Promise<{ spreadsheetId: string }>}
 */
export async function runImport(collaborators) {
  const { from, store, workbook, provisioner, print } = collaborators;
  refuseIfRecorded(store);
  const workbookBytes = readWorkbookBytes(from);
  const workbookState = readWorkbookState(workbook);
  checkWorkbook(workbookState);
  const { spreadsheetId } = await provisioner.create({ name: basename(from), workbookBytes });
  try {
    await verifyConversion(collaborators, spreadsheetId, workbookState);
    recordTarget(collaborators, spreadsheetId);
  } catch (error) {
    const stranded = await abandon(collaborators, spreadsheetId);
    if (stranded && error?.code === ImportRefusal.RECORD_FAILED) refuse(ImportRefusal.RECORD_FAILED, stranded);
    throw error;
  }
  await bindRowKeys(collaborators, spreadsheetId);
  print(`import: created Sheet ${spreadsheetId}`);
  return { spreadsheetId };
}
