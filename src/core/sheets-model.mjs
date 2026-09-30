// PURE. The only module that knows the Sheets response shape.
// Turns spreadsheets.get and values.batchGet bodies into
// SheetState (what merge.mjs reads) and into a Resolution (where every row and column is now).
// Indices are 0-based sheet coordinates: row 0 is the header, the first data row is 1.
import { HARVESTER_COLUMNS } from './merge.mjs';
import { COMPANIES_COLUMNS, SOURCES_COLUMNS } from './harvest.mjs';
import { SheetsRefusal } from './sheets-refusals.mjs';

export const TAB_OWNERSHIP = Object.freeze({
  Jobs: Object.freeze({ keyColumns: Object.freeze(['Dedup Key']), harvesterColumns: HARVESTER_COLUMNS }),
  Companies: Object.freeze({ keyColumns: Object.freeze(['Company']), harvesterColumns: Object.freeze(COMPANIES_COLUMNS) }),
  Sources: Object.freeze({ keyColumns: Object.freeze(['Source', 'Search Term']), harvesterColumns: Object.freeze(SOURCES_COLUMNS) }),
});

const JOBS_TAB = 'Jobs';

const refuse = (code, detail) => {
  throw Object.assign(new Error(`${code}: ${detail}`), { code });
};

const malformed = (detail) => refuse(SheetsRefusal.RESPONSE_MALFORMED, detail);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const isBlank = (value) => value === null || value === undefined || value === '';

// ---------------------------------------------------------------------- keys

/** One key value is its own text; several are a JSON array of the ordered values, never a joined string. */
export const encodeRowKey = (values) => (values.length === 1 ? String(values[0]) : JSON.stringify(values));

/** @returns {string|null} the encoded key of a row object, or null when any key column is blank */
export const rowKeyOf = (keyColumns, row) => {
  const values = keyColumns.map((column) => row[column]);
  return values.some(isBlank) ? null : encodeRowKey(values);
};

// -------------------------------------------------------------- spreadsheets.get

const parseTab = (entry) => {
  const properties = entry?.properties;
  if (!isObject(properties) || !Number.isInteger(properties.sheetId) || typeof properties.title !== 'string') return malformed('a tab has no id or title');
  const grid = properties.gridProperties ?? {};
  return { sheetId: properties.sheetId, title: properties.title, rowCount: grid.rowCount ?? 0, columnCount: grid.columnCount ?? 0 };
};

/** @returns {{ spreadsheetId: string, tabs: { sheetId: number, title: string, rowCount: number, columnCount: number }[] }} */
export const parseSpreadsheet = (body, { expectedId }) => {
  if (!isObject(body) || typeof body.spreadsheetId !== 'string' || !Array.isArray(body.sheets)) return malformed('spreadsheets.get answered with no spreadsheet id or tab list');
  const tabs = body.sheets.map(parseTab);
  if (body.spreadsheetId !== expectedId) return refuse(SheetsRefusal.ID_MISMATCH, `the Sheet answering is ${body.spreadsheetId}, not the recorded ${expectedId}`);
  return { spreadsheetId: body.spreadsheetId, tabs };
};

// ---------------------------------------------------------------- values:batchGet

const parseRange = (range) => {
  if (!isObject(range)) return malformed('a value range is not an object');
  if (range.values === undefined) return [];
  if (!Array.isArray(range.values) || !range.values.every(Array.isArray)) return malformed('a value range holds values that are not rows');
  return range.values;
};

/** @returns {Record<string, unknown[][]>} tab title to raw grid; a range with no `values` is an empty grid */
export const parseValueRanges = (body, tabTitles) => {
  if (!isObject(body) || !Array.isArray(body.valueRanges) || body.valueRanges.length !== tabTitles.length) return malformed(`values.batchGet did not answer one range for each of ${tabTitles.length} tabs`);
  const grids = body.valueRanges.map(parseRange);
  return Object.fromEntries(tabTitles.map((title, position) => [title, grids[position]]));
};

// --------------------------------------------------------------------- SheetState

const cellValue = (cell) => (isBlank(cell) ? null : cell);

const rowObject = (header, cells) => Object.fromEntries(header.map((name, position) => [name, cellValue(cells[position])]));

const tabState = (grid) => {
  const [header = [], ...rows] = grid;
  return { columns: [...header], rows: rows.map((cells) => rowObject(header, cells)) };
};

/** @returns {{ tabs: Record<string, { columns: string[], rows: object[] }> }} blanks read as null; rows[i] is sheet row i+2 (row 1 is the header) */
export const toSheetState = (grids) => ({
  tabs: Object.fromEntries(Object.entries(grids).map(([title, grid]) => [title, tabState(grid)])),
});

// ------------------------------------------------------------------- resolution

const firstOccurrences = (header) =>
  header.flatMap((name, position) => (isBlank(name) || header.indexOf(name) !== position ? [] : [[name, position]]));

const refuseDuplicateOwnedHeader = (title, header, ownedColumns) => {
  const twice = ownedColumns.find((column) => header.indexOf(column) !== header.lastIndexOf(column));
  if (twice !== undefined) refuse(SheetsRefusal.DUPLICATE_HEADER, `tab ${title} names the owned column "${twice}" more than once`);
};

const refuseMissingKeyColumn = (title, keyColumns, columnIndex, hasData) => {
  const holdsKey = keyColumns.every((column) => Object.hasOwn(columnIndex, column));
  if ((title === JOBS_TAB || hasData) && !holdsKey) refuse(SheetsRefusal.KEY_COLUMN_MISSING, `tab ${title} has no ${keyColumns.join(' + ')} column`);
};

const keyedRows = (keyColumns, header, dataRows) =>
  dataRows
    .map((cells, position) => {
      const row = rowObject(header, cells);
      return { key: rowKeyOf(keyColumns, row), rowIndex: position + 1, row };
    })
    .filter(({ key }) => key !== null);

const refuseDuplicateKey = (title, keyed) => {
  const [duplicate] = [...Map.groupBy(keyed, ({ key }) => key)].find(([, rows]) => rows.length > 1) ?? [];
  if (duplicate !== undefined) refuse(SheetsRefusal.DUPLICATE_KEY, `tab ${title} holds the key ${duplicate} on more than one row`);
};

const resolveTab = (tab, grid) => {
  const { keyColumns, harvesterColumns } = TAB_OWNERSHIP[tab.title];
  const [header = [], ...dataRows] = grid;
  refuseDuplicateOwnedHeader(tab.title, header, [...keyColumns, ...harvesterColumns]);
  const columnIndex = Object.fromEntries(firstOccurrences(header));
  refuseMissingKeyColumn(tab.title, keyColumns, columnIndex, dataRows.length > 0);

  const keyed = keyedRows(keyColumns, header, dataRows);
  refuseDuplicateKey(tab.title, keyed);
  const rowIndexByKey = Object.fromEntries(keyed.map(({ key, rowIndex }) => [key, rowIndex]));

  return {
    sheetId: tab.sheetId,
    rowCount: tab.rowCount,
    columnCount: tab.columnCount,
    headerWidth: header.length,
    columnIndex,
    rowIndexByKey,
    rowsByKey: Object.fromEntries(keyed.map(({ key, row }) => [key, row])),
  };
};

/**
 * @returns {{ tabs: Record<string, { sheetId: number, rowCount: number, columnCount: number, headerWidth: number,
 *   columnIndex: Record<string, number>, rowIndexByKey: Record<string, number>,
 *   rowsByKey: Record<string, Record<string, unknown>> }>, otherSheetIds: number[] }}
 * `otherSheetIds` lists the ids of the tabs the harvester does not own, so a new tab never reuses one.
 * Tabs absent from the Sheet have no entry. Refuses by name; nothing else is a decision of the caller.
 */
export const resolveTabs = ({ tabs, grids }) => {
  const owned = tabs.filter(({ title }) => Object.hasOwn(TAB_OWNERSHIP, title));
  if (!owned.some(({ title }) => title === JOBS_TAB)) refuse(SheetsRefusal.TAB_MISSING, `the Sheet has no ${JOBS_TAB} tab`);
  return {
    tabs: Object.fromEntries(owned.map((tab) => [tab.title, resolveTab(tab, grids[tab.title] ?? [])])),
    otherSheetIds: tabs.filter(({ title }) => !Object.hasOwn(TAB_OWNERSHIP, title)).map(({ sheetId }) => sheetId),
  };
};
