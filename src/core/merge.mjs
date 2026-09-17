// PURE. (sheetState, harvestModel) -> WritePlan (DR-0004, DR-0005).
// Touches nothing. Only TargetSheet.apply(plan) writes, which is what makes
// "the preview modified the tracker" unrepresentable rather than merely tested.

export const KEY_COLUMN = 'Dedup Key';

const JOBS_TAB = 'Jobs';

/** Always overwritten with the freshly derived value. */
export const HARVESTER_COLUMNS = Object.freeze([
  'Job',
  'Date Discovered',
  'Advert Link',
  'Company',
  'Location',
  'Min Salary (annual)',
  'Max Salary (annual)',
  'Min Rate (derived)',
  'Max Rate (derived)',
  'Rate Unit (derived)',
  'Source',
  'Source Type',
  'Fit Score',
  'Fit Reason',
  'First Seen',
  'Last Seen',
  'Times Seen',
]);

/** Created blank on row creation; never written again. */
export const HUMAN_COLUMNS = Object.freeze([
  'Status',
  'Qualified?',
  'Applied on Date',
  'Permanent/Contract',
  'Onsite/Hybrid/Remote',
  'Full time/Part Time',
  'Min Salary (hourly)',
  'Day Rate',
]);

/** Tracker rows keyed by Dedup Key, excluding hand-added rows with a blank key (DR-0004 rule 2). */
function indexExistingByKey(rows) {
  return new Map(rows.filter((row) => Boolean(row[KEY_COLUMN])).map((row) => [row[KEY_COLUMN], row]));
}

/** The harvester-owned view of a harvested row — the only cells this plan ever writes to an update. */
function harvesterCells(harvestRow) {
  return Object.fromEntries(HARVESTER_COLUMNS.map((column) => [column, harvestRow[column]]));
}

/** Harvester-owned cells whose value changed since the last run (DR-0004 rule 4). */
function changedCells(key, existingRow, cells) {
  return Object.entries(cells)
    .filter(([column, to]) => existingRow[column] !== to)
    .map(([column, to]) => ({ key, column, from: existingRow[column], to }));
}

/** A freshly harvested row, human-owned columns blank until a human fills them in. */
function appendedRow(harvestRow) {
  return {
    [KEY_COLUMN]: harvestRow[KEY_COLUMN],
    ...harvesterCells(harvestRow),
    ...Object.fromEntries(HUMAN_COLUMNS.map((column) => [column, null])),
  };
}

/**
 * @param {{ tabs: Record<string, { columns: string[], rows: object[] }> }} sheetState
 * @param {{ jobs: { columns: string[], rows: object[] } }} harvestModel
 * @returns {{ tab: string, appendColumns: string[], updates: {key:string, cells:object}[],
 *            appends: object[], changes: {key:string, column:string, from:*, to:*}[] }}
 */
export function planMerge(sheetState, harvestModel) {
  const sheetTab = sheetState.tabs[JOBS_TAB];
  const existingByKey = indexExistingByKey(sheetTab.rows);

  const matches = harvestModel.jobs.rows.map((harvestRow) => ({
    harvestRow,
    existingRow: existingByKey.get(harvestRow[KEY_COLUMN]),
  }));

  const matched = matches.filter(({ existingRow }) => existingRow);
  const unmatched = matches.filter(({ existingRow }) => !existingRow);

  return {
    tab: JOBS_TAB,
    appendColumns: HARVESTER_COLUMNS.filter((column) => !sheetTab.columns.includes(column)),
    updates: matched.map(({ harvestRow }) => ({
      key: harvestRow[KEY_COLUMN],
      cells: harvesterCells(harvestRow),
    })),
    appends: unmatched.map(({ harvestRow }) => appendedRow(harvestRow)),
    changes: matched.flatMap(({ harvestRow, existingRow }) =>
      changedCells(harvestRow[KEY_COLUMN], existingRow, harvesterCells(harvestRow)),
    ),
  };
}
