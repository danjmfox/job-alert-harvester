// PURE. Classifies a merge plan's changed cells into sighting bookkeeping
// (the counters that move whenever an advert is merely re-seen) versus
// derived corrections (every other harvester-owned column) -- DR-0004 rule 4.

/** Counters that move on every re-sighting, never a correction in their own
 *  right (DR-0004 rule 4). */
export const SIGHTING_BOOKKEEPING_COLUMNS = Object.freeze([
  'First Seen',
  'Last Seen',
  'Times Seen',
  'Jobs Seen',
  'Messages',
  'Jobs Found',
]);

/** @typedef {'bookkeeping' | 'correction'} ChangeClass */

/** @param {{column: string}} change
 *  @returns {ChangeClass} */
export function classifyChange(change) {
  return SIGHTING_BOOKKEEPING_COLUMNS.includes(change.column) ? 'bookkeeping' : 'correction';
}

/** A single plan's changes, each carrying its tab and classification
 *  alongside the existing key/column/from/to. Changes to a column the sheet
 *  did not carry before this run (`plan.appendColumns`) are excluded: there
 *  was no prior derived value to correct, only a column being populated for
 *  the first time -- reporting it as a "correction" would be noise, not
 *  signal (DR-0004 rule 4). */
function classifiedChangesOf(plan) {
  const newlyAddedColumns = new Set(plan.appendColumns);
  return plan.changes
    .filter((change) => !newlyAddedColumns.has(change.column))
    .map((change) => ({ tab: plan.tab, ...change, changeClass: classifyChange(change) }));
}

/** Every plan's changes flattened and classified, partitioned into the two
 *  groups a change summary must keep visibly distinct (DR-0004 rule 4). */
export function partitionChanges(plans) {
  const classified = plans.flatMap(classifiedChangesOf);
  return {
    corrections: classified.filter((change) => change.changeClass === 'correction'),
    bookkeeping: classified.filter((change) => change.changeClass === 'bookkeeping'),
  };
}

const formatCellValue = (value) => (value === null || value === undefined ? '(blank)' : String(value));

/** One line describing a single changed cell -- tab, key, column, and value
 *  before and after. The same rendering serves both the `--report` detail
 *  file and the stderr summary's correction lines. */
export function formatChange(change) {
  return `${change.tab}\t${change.key}\t${change.column}: ${formatCellValue(change.from)} -> ${formatCellValue(change.to)}`;
}
