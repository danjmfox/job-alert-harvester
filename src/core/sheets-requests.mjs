// PURE. Plan + resolution -> one spreadsheets.batchUpdate body, and the request classifier.
// Only the four allow-listed request types are constructable: no delete, clear or sort request exists here.
import { KEY_COLUMN } from './merge.mjs';
import { TAB_OWNERSHIP } from './sheets-model.mjs';
import { SheetsRefusal } from './sheets-refusals.mjs';

export const ALLOWED_REQUEST_TYPES = Object.freeze(['updateCells', 'appendCells', 'appendDimension', 'addSheet']);

export const RequestClass = Object.freeze({ READ: 'read', WRITE: 'write' });

/** Bytes; the largest batch measured accepted live (9.0 MB); no ceiling was found (API assumption A6). */
export const MAX_BATCH_BYTES = 9 * 1024 * 1024;

const CELL_FIELDS = 'userEnteredValue';
const DEFAULT_GRID_COLUMNS = 26;

const refuse = (code, detail) => {
  throw Object.assign(new Error(`${code}: ${detail}`), { code });
};

// ---------------------------------------------------------------- classifier

/** @returns {'read'|'write'} a GET is a read; anything else, or anything unrecognised, is a write. */
export const classifyRequest = ({ method }) => (String(method).toUpperCase() === 'GET' ? RequestClass.READ : RequestClass.WRITE);

// ---------------------------------------------------------------------- keys

const tabOwnership = (tab) => TAB_OWNERSHIP[tab] ?? { keyColumns: [], harvesterColumns: [] };

/** One key value is its own text; several are a JSON array of the ordered values, never a joined string. */
const encodeKey = (keyColumns, row) => {
  const values = keyColumns.map((column) => row[column]);
  return values.length === 1 ? String(values[0]) : JSON.stringify(values);
};

const updateKeyOf = (tab, update) => encodeKey(tabOwnership(tab).keyColumns, update.match ?? { [KEY_COLUMN]: update.key });

const isOwnedNonKey = (tab, column) => {
  const { keyColumns, harvesterColumns } = tabOwnership(tab);
  return harvesterColumns.includes(column) && !keyColumns.includes(column);
};

const hasKey = (index, key) => Object.hasOwn(index, key);

// -------------------------------------------------------------------- settle

const unchangedCell = (fresh, column, value) => (value ?? null) === (fresh?.[column] ?? null);

const settleUpdate = (tab, resolved, update) => {
  const fresh = resolved.rowsByKey[updateKeyOf(tab, update)];
  const cells = Object.fromEntries(Object.entries(update.cells).filter(([column, value]) => !unchangedCell(fresh, column, value)));
  return { ...update, cells };
};

const settlePlan = (plan, resolved) => {
  if (!resolved) return { plan, skipped: 0 };
  const { keyColumns } = tabOwnership(plan.tab);
  const appends = plan.appends.filter((row) => !hasKey(resolved.rowIndexByKey, encodeKey(keyColumns, row)));
  const updates = plan.updates.map((update) => settleUpdate(plan.tab, resolved, update)).filter((update) => Object.keys(update.cells).length > 0);
  return { plan: { ...plan, updates, appends }, skipped: plan.appends.length - appends.length };
};

/**
 * Drops appends whose key is already in the fresh key column and updates whose cell already holds the planned value.
 * @returns {{ plans: object[], appendsSkippedAsPresent: number }}
 */
export const settlePlans = ({ plans, resolution }) => {
  const settled = plans.map((plan) => settlePlan(plan, resolution.tabs[plan.tab]));
  return { plans: settled.map(({ plan }) => plan), appendsSkippedAsPresent: settled.reduce((total, { skipped }) => total + skipped, 0) };
};

// --------------------------------------------------------------------- cells

const cellOf = (value) => {
  if (value === null || value === undefined) return {};
  if (typeof value === 'number') return { userEnteredValue: { numberValue: value } };
  if (typeof value === 'boolean') return { userEnteredValue: { boolValue: value } };
  return { userEnteredValue: { stringValue: String(value) } };
};

const rowOf = (values) => ({ values: values.map(cellOf) });

// ------------------------------------------------------------------ requests

const addSheetRequest = ({ sheetId, title, width }) => ({
  addSheet: { properties: { sheetId, title, gridProperties: { columnCount: Math.max(DEFAULT_GRID_COLUMNS, width) } } },
});

const appendDimensionRequest = ({ sheetId, length }) => ({ appendDimension: { sheetId, dimension: 'COLUMNS', length } });

const updateCellsRequest = ({ sheetId, rowIndex, columnIndex, rows }) => ({
  updateCells: { start: { sheetId, rowIndex, columnIndex }, rows, fields: CELL_FIELDS },
});

const appendCellsRequest = ({ sheetId, rows }) => ({ appendCells: { sheetId, rows, fields: CELL_FIELDS } });

/** The tab's column names by position after the plan's appendColumns land in the first free columns. */
const plannedColumnNames = (plan, tab) => {
  const names = Array.from({ length: tab.headerWidth + plan.appendColumns.length }, () => null);
  for (const [column, index] of Object.entries(tab.columnIndex)) names[index] = column;
  plan.appendColumns.forEach((column, offset) => {
    names[tab.headerWidth + offset] = column;
  });
  return names;
};

const appendedRowOf = (plan, names, row) => {
  const { keyColumns, harvesterColumns } = tabOwnership(plan.tab);
  const writable = new Set([...keyColumns, ...harvesterColumns]);
  return { values: names.map((name) => (writable.has(name) ? cellOf(row[name]) : {})) };
};

const columnIndexOf = (plan, tab, column) => {
  if (Object.hasOwn(tab.columnIndex, column)) return tab.columnIndex[column];
  const appended = plan.appendColumns.indexOf(column);
  if (appended < 0) refuse(SheetsRefusal.HEADER_CHANGED, `tab ${plan.tab}`);
  return tab.headerWidth + appended;
};

const widenRequests = (plan, tab) => {
  const shortfall = tab.headerWidth + plan.appendColumns.length - tab.columnCount;
  return shortfall > 0 ? [appendDimensionRequest({ sheetId: tab.sheetId, length: shortfall })] : [];
};

const headerRequests = (plan, tab) =>
  plan.appendColumns.length > 0
    ? [updateCellsRequest({ sheetId: tab.sheetId, rowIndex: 0, columnIndex: tab.headerWidth, rows: [rowOf(plan.appendColumns)] })]
    : [];

const updateRequests = (plan, tab) =>
  plan.updates.flatMap((update) => {
    const key = updateKeyOf(plan.tab, update);
    if (!hasKey(tab.rowIndexByKey, key)) return [];
    return Object.entries(settleUpdate(plan.tab, tab, update).cells)
      .filter(([column]) => isOwnedNonKey(plan.tab, column))
      .map(([column, value]) =>
        updateCellsRequest({ sheetId: tab.sheetId, rowIndex: tab.rowIndexByKey[key], columnIndex: columnIndexOf(plan, tab, column), rows: [rowOf([value])] }),
      );
  });

const appendRequests = (plan, tab) => {
  if (plan.appends.length === 0) return [];
  const names = plannedColumnNames(plan, tab);
  return [appendCellsRequest({ sheetId: tab.sheetId, rows: plan.appends.map((row) => appendedRowOf(plan, names, row)) })];
};

const existingTabRequests = (plan, tab) => [...widenRequests(plan, tab), ...headerRequests(plan, tab), ...updateRequests(plan, tab), ...appendRequests(plan, tab)];

const newTabRequests = (plan, sheetId) => {
  const names = plan.appendColumns;
  const rows = [rowOf(names), ...plan.appends.map((row) => appendedRowOf(plan, names, row))];
  return [addSheetRequest({ sheetId, title: plan.tab, width: names.length }), appendCellsRequest({ sheetId, rows })];
};

const chooseSheetIds = (plans, resolution) => {
  const highestId = Math.max(-1, ...Object.values(resolution.tabs).map((tab) => tab.sheetId), ...(resolution.otherSheetIds ?? []));
  const missing = plans.filter((plan) => !resolution.tabs[plan.tab]);
  return new Map(missing.map((plan, offset) => [plan.tab, highestId + 1 + offset]));
};

/** @returns {{ requests: object[] }} one body for every tab; refuses `sheets.header-changed` */
export const buildApplyBody = ({ plans, resolution }) => {
  const newSheetIds = chooseSheetIds(plans, resolution);
  const requests = plans.flatMap((plan) => {
    const tab = resolution.tabs[plan.tab];
    return tab ? existingTabRequests(plan, tab) : newTabRequests(plan, newSheetIds.get(plan.tab));
  });
  return { requests };
};

/** Throws `sheets.plan-too-large` when the serialised body exceeds maxBytes; the message names no cell value. */
export const assertWithinLimit = (body, { maxBytes }) => {
  const size = new TextEncoder().encode(JSON.stringify(body)).length;
  if (size > maxBytes) refuse(SheetsRefusal.PLAN_TOO_LARGE, `body is ${size} bytes, limit ${maxBytes}`);
};
