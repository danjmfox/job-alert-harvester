// PURE. (sheetState, harvestModel) -> WritePlan (DR-0004, DR-0005).
// Touches nothing. Only TargetSheet.apply(plan) writes, which is what makes
// "the preview modified the tracker" unrepresentable rather than merely tested.
//
// RED scaffold — created by DISTILL.

export const __SCAFFOLD__ = true;

const notImplemented = (name) => {
  throw new Error(`${name}: Not yet implemented — RED scaffold`);
};

export const KEY_COLUMN = 'Dedup Key';

/** Always overwritten with the freshly derived value. */
export const HARVESTER_COLUMNS = Object.freeze([
  'Job',
  'Date Discovered',
  'Advert Link',
  'Company',
  'Location',
  'Min Salary (annual)',
  'Max Salary (annual)',
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

/**
 * @param {{ tabs: Record<string, { columns: string[], rows: object[] }> }} sheetState
 * @param {{ jobs: { columns: string[], rows: object[] } }} harvestModel
 * @returns {{ tab: string, appendColumns: string[], updates: {key:string, cells:object}[],
 *            appends: object[], changes: {key:string, column:string, from:*, to:*}[] }}
 */
export function planMerge(_sheetState, _harvestModel) {
  return notImplemented('planMerge');
}
