// PURE. RED scaffold (DISTILL): the only module that knows the Sheets response shape.
// Turns spreadsheets.get, values.batchGet and developerMetadata.search bodies into
// SheetState (what merge.mjs reads) and into a Resolution (where every row and column is now).
// Indices are 0-based sheet coordinates: row 0 is the header, the first data row is 1.
import { HARVESTER_COLUMNS } from './merge.mjs';
import { COMPANIES_COLUMNS, SOURCES_COLUMNS } from './harvest.mjs';

export const __SCAFFOLD__ = true;

export const ROW_KEY_METADATA = 'harvester.row-key';

export const TAB_OWNERSHIP = Object.freeze({
  Jobs: Object.freeze({ keyColumns: Object.freeze(['Dedup Key']), harvesterColumns: HARVESTER_COLUMNS }),
  Companies: Object.freeze({ keyColumns: Object.freeze(['Company']), harvesterColumns: Object.freeze(COMPANIES_COLUMNS) }),
  Sources: Object.freeze({ keyColumns: Object.freeze(['Source', 'Search Term']), harvesterColumns: Object.freeze(SOURCES_COLUMNS) }),
});

const scaffold = (name) => {
  throw new Error(`RED scaffold: ${name} is not implemented`);
};

/** One key value is its own text; several are a JSON array of the ordered values, never a joined string. */
export const encodeRowKey = (values) => scaffold('encodeRowKey');

/** @returns {string|null} the encoded key of a row object, or null when any key column is blank */
export const rowKeyOf = (keyColumns, row) => scaffold('rowKeyOf');

/** @returns {{ spreadsheetId: string, tabs: { sheetId: number, title: string, rowCount: number, columnCount: number }[] }} */
export const parseSpreadsheet = (body, { expectedId }) => scaffold('parseSpreadsheet');

/** @returns {Record<string, unknown[][]>} tab title to raw grid; a range with no `values` is an empty grid */
export const parseValueRanges = (body, tabTitles) => scaffold('parseValueRanges');

/** @returns {{ tabs: Record<string, { columns: string[], rows: object[] }> }} blanks read as null; rows[i] is sheet row i+2 (row 1 is the header) */
export const toSheetState = (grids) => scaffold('toSheetState');

/** @returns {{ metadataId: number, key: string, value: string, sheetId: number, rowIndex: number }[]} */
export const parseMetadata = (body) => scaffold('parseMetadata');

/**
 * @returns {{ tabs: Record<string, { sheetId: number, rowCount: number, columnCount: number, headerWidth: number,
 *   columnIndex: Record<string, number>, rowIndexByKey: Record<string, number>,
 *   rowsByKey: Record<string, Record<string, unknown>>, unboundKeys: string[] }> }}
 * Tabs absent from the Sheet have no entry. Refuses by name; nothing else is a decision of the caller.
 */
export const resolveTabs = ({ tabs, grids, metadata }) => scaffold('resolveTabs');
