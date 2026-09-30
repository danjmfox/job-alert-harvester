// PURE. The verdict on a workbook before import, and on the converted Sheet after (DR-0012).
// Refusal messages name the code, the tab and (for duplicates) the key, never a cell value.
import { HARVESTER_COLUMNS, HUMAN_COLUMNS, KEY_COLUMN } from './merge.mjs';
import { ImportRefusal } from './sheets-refusals.mjs';

const JOBS_TAB = 'Jobs';

const KEY_COLUMNS_BY_TAB = Object.freeze({
  [JOBS_TAB]: [KEY_COLUMN],
  Companies: ['Company'],
  Sources: ['Source', 'Search Term'],
});

const KNOWN_JOBS_COLUMNS = new Set([...HARVESTER_COLUMNS, ...HUMAN_COLUMNS]);

const refuse = (code, detail) => {
  throw Object.assign(new Error(`${code}: ${detail}`), { code });
};

const isBlank = (value) => value === null || value === undefined || value === '';

const keyOf = (row, keyColumns) => {
  const parts = keyColumns.map((column) => row[column]);
  return parts.some(isBlank) ? null : parts.join(' / ');
};

const keysOf = ({ rows }, keyColumns) => (keyColumns ? rows.map((row) => keyOf(row, keyColumns)).filter((key) => key !== null) : []);

const firstDuplicate = (keys) => keys.find((key, index) => keys.indexOf(key) !== index);

const requireJobsKey = (tabs) => {
  if (!tabs[JOBS_TAB]?.columns.includes(KEY_COLUMN)) refuse(ImportRefusal.NO_DEDUP_KEY_COLUMN, `tab ${JOBS_TAB}`);
};

const requireOtherKeys = (tabs) => {
  for (const tab of ['Companies', 'Sources']) {
    if (tabs[tab] && !KEY_COLUMNS_BY_TAB[tab].every((column) => tabs[tab].columns.includes(column))) {
      refuse(ImportRefusal.KEY_COLUMN_MISSING, `tab ${tab}`);
    }
  }
};

const requireRecognisedJobsHeaders = (tabs) => {
  if (!tabs[JOBS_TAB].columns.some((column) => KNOWN_JOBS_COLUMNS.has(column))) refuse(ImportRefusal.UNRECOGNISED_HEADERS, `tab ${JOBS_TAB}`);
};

const requireUniqueKeys = (tabs) => {
  for (const [tab, keyColumns] of Object.entries(KEY_COLUMNS_BY_TAB)) {
    const duplicate = tabs[tab] ? firstDuplicate(keysOf(tabs[tab], keyColumns)) : undefined;
    if (duplicate !== undefined) refuse(ImportRefusal.DUPLICATE_KEY, `tab ${tab}, key ${duplicate}`);
  }
};

/** @param {{ tabs: Record<string, { columns: string[], rows: object[] }> }} workbookState @returns {undefined} or throws an ImportRefusal */
export const checkWorkbook = ({ tabs }) => {
  requireJobsKey(tabs);
  requireOtherKeys(tabs);
  requireRecognisedJobsHeaders(tabs);
  requireUniqueKeys(tabs);
};

const sameList = (left, right) => left.length === right.length && left.every((item, index) => item === right[index]);

const tabMatches = (workbookTab, convertedTab, keyColumns) =>
  sameList(workbookTab.columns, convertedTab.columns) &&
  workbookTab.rows.length === convertedTab.rows.length &&
  sameList(keysOf(workbookTab, keyColumns).sort(), keysOf(convertedTab, keyColumns).sort());

const mismatch = (tab) => refuse(ImportRefusal.CONVERSION_MISMATCH, `tab ${tab}`);

/** @returns {undefined} or throws `import.conversion-mismatch` when tabs, headers, row counts or key sets differ */
export const checkConversion = ({ workbookState, convertedState }) => {
  const workbookTabs = workbookState.tabs;
  const convertedTabs = convertedState.tabs;
  for (const tab of new Set([...Object.keys(workbookTabs), ...Object.keys(convertedTabs)])) {
    if (!workbookTabs[tab] || !convertedTabs[tab] || !tabMatches(workbookTabs[tab], convertedTabs[tab], KEY_COLUMNS_BY_TAB[tab])) mismatch(tab);
  }
};
