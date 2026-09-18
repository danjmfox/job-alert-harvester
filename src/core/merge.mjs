// PURE. (sheetState, harvestModel) -> WritePlan (DR-0004, DR-0005, DR-0010).
// Touches nothing. Only TargetSheet.apply(plan) writes, which is what makes
// "the preview modified the tracker" unrepresentable rather than merely tested.

import { COMPANIES_COLUMNS, SOURCES_COLUMNS } from './harvest.mjs';

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

// --- DR-0010: every other derived tab merges by its own key, under the same
// rules planMerge already applies to Jobs, lifted over a per-tab spec so
// Companies and Sources share one implementation instead of two near-copies.

/** @typedef {{ tab: string, harvestKey: string, keyColumns: string[], harvesterColumns: string[] }} TabSpec */

/** A row's key columns, joined only for the human-readable `key` report field
 *  — 'Company' alone for Companies, 'Source / Search Term' for Sources. Never
 *  used to locate a row (that is `match`'s job): a joined string is exactly
 *  the collision DR-0010 Option 2 rejected, so it must not double as a lookup key. */
function reportKeyOf(keyColumns, row) {
  return keyColumns.map((column) => row[column]).join(' / ');
}

/** Every entry of the row's key columns, tested individually by `apply`
 *  (DR-0010 rule 3) rather than composed into one string (Option 2, rejected —
 *  a composed string risks two distinct rows colliding into one). */
function matchOf(keyColumns, row) {
  return Object.fromEntries(keyColumns.map((column) => [column, row[column]]));
}

/** Tracker rows indexed by their key columns via nested Maps — one level per
 *  column, so two rows can never collide on a shared separator the way a
 *  joined-string key could (DR-0010 Option 2's rejected risk). Rows with a
 *  blank key column are excluded (DR-0004 rule 2, generalised to composite keys). */
const indexedAt = (level, [value, ...rest], row) =>
  rest.length === 0
    ? new Map(level).set(value, row)
    : new Map(level).set(value, indexedAt(level.get(value) ?? new Map(), rest, row));

function indexExistingByKeyColumns(rows, keyColumns) {
  return rows
    .filter((row) => keyColumns.every((column) => Boolean(row[column])))
    .reduce(
      (root, row) => indexedAt(root, keyColumns.map((column) => row[column]), row),
      new Map(),
    );
}

/** Looks up a harvest row's matching existing row through the same nested
 *  Maps `indexExistingByKeyColumns` built. */
function lookupByKeyColumns(root, keyColumns, row) {
  return keyColumns.reduce(
    (level, column) => (level instanceof Map ? level.get(row[column]) : undefined),
    root,
  );
}

function harvesterCellsOf(harvesterColumns, row) {
  return Object.fromEntries(harvesterColumns.map((column) => [column, row[column]]));
}

/** Generic per-tab merge planner underlying every derived tab except Jobs
 *  (DR-0010 rule 1): index the tracker by the tab's own key, split the
 *  harvest into matched updates and unmatched appends, report derived-cell
 *  changes. A tab absent from the tracker is treated as empty rather than an
 *  error — the tab is created on apply (DR-0010 rule 5). */
function planMergeTab(sheetState, harvestModel, spec) {
  const sheetTab = sheetState.tabs[spec.tab] ?? { columns: [], rows: [] };
  const existingByKey = indexExistingByKeyColumns(sheetTab.rows, spec.keyColumns);

  const matches = harvestModel[spec.harvestKey].rows.map((harvestRow) => ({
    harvestRow,
    key: reportKeyOf(spec.keyColumns, harvestRow),
    existingRow: lookupByKeyColumns(existingByKey, spec.keyColumns, harvestRow),
  }));

  const matched = matches.filter(({ existingRow }) => existingRow);
  const unmatched = matches.filter(({ existingRow }) => !existingRow);

  return {
    tab: spec.tab,
    appendColumns: spec.harvesterColumns.filter((column) => !sheetTab.columns.includes(column)),
    updates: matched.map(({ harvestRow, key }) => ({
      key,
      match: matchOf(spec.keyColumns, harvestRow),
      cells: harvesterCellsOf(spec.harvesterColumns, harvestRow),
    })),
    appends: unmatched.map(({ harvestRow }) => harvesterCellsOf(spec.harvesterColumns, harvestRow)),
    changes: matched.flatMap(({ harvestRow, existingRow, key }) =>
      changedCells(key, existingRow, harvesterCellsOf(spec.harvesterColumns, harvestRow)),
    ),
  };
}

const COMPANIES_TAB_SPEC = {
  tab: 'Companies',
  harvestKey: 'companies',
  keyColumns: ['Company'],
  harvesterColumns: COMPANIES_COLUMNS,
};

const SOURCES_TAB_SPEC = {
  tab: 'Sources',
  harvestKey: 'sources',
  keyColumns: ['Source', 'Search Term'],
  harvesterColumns: SOURCES_COLUMNS,
};

/** Companies merges on `Company` (DR-0010). Every Companies column is
 *  harvester-owned today — no human-owned columns to preserve beyond what
 *  DR-0004 rule 4 already does for any column this plan does not recognise. */
export function planMergeCompanies(sheetState, harvestModel) {
  return planMergeTab(sheetState, harvestModel, COMPANIES_TAB_SPEC);
}

/** Sources merges on the composite `Source` + `Search Term` (DR-0010) —
 *  Sources has no single key column, so identity is carried via `update.match`. */
export function planMergeSources(sheetState, harvestModel) {
  return planMergeTab(sheetState, harvestModel, SOURCES_TAB_SPEC);
}

const TAB_PLANNERS = [
  { harvestKey: 'jobs', plan: planMerge },
  { harvestKey: 'companies', plan: planMergeCompanies },
  { harvestKey: 'sources', plan: planMergeSources },
];

/** One plan per tab the harvest actually carries (DR-0010 rule 4) — never a
 *  hardcoded three, so a harvest run missing a tab merges only the tabs it has. */
export function planMergeAll(sheetState, harvestModel) {
  return TAB_PLANNERS.filter(({ harvestKey }) => harvestKey in harvestModel).map(({ plan }) => plan(sheetState, harvestModel));
}
