// Reads a spreadsheets.batchUpdate body back into what it would do to a Sheet, and generates tracker layouts.
// The decoder is the test-side oracle for "what can this body touch": every CellData inside an updateCells
// or appendCells counts as a write, an empty one included (it clears the cell).
import fc from 'fast-check';
import { planMergeAll } from '../../../../src/core/merge.mjs';
import { aCompanyRow, aHarvestedJob, aHarvest, COMPANIES_COLUMNS, HARVESTER_COLUMNS, HUMAN_COLUMNS, KEY_COLUMN } from './sheets-domain-types.mjs';

export const typeOf = (request) => Object.keys(request)[0];

export function valueOf(cell) {
  const entered = cell?.userEnteredValue;
  if (entered === undefined) return { kind: 'blank', value: null };
  if ('formulaValue' in entered) return { kind: 'formula', value: entered.formulaValue };
  if ('stringValue' in entered) return { kind: 'text', value: entered.stringValue };
  if ('numberValue' in entered) return { kind: 'number', value: entered.numberValue };
  if ('boolValue' in entered) return { kind: 'boolean', value: entered.boolValue };
  return { kind: 'unknown', value: entered };
}

const invert = (columnIndex) => Object.fromEntries(Object.entries(columnIndex).map(([header, index]) => [index, header]));

/** @returns everything a body writes, resolved to tab, header and value against `resolution` and the plans' appended columns */
export function decode(body, resolution, plans = []) {
  const byId = new Map(
    Object.entries(resolution.tabs).map(([title, tab]) => {
      const plan = plans.find((candidate) => candidate.tab === title);
      const names = invert(tab.columnIndex);
      (plan?.appendColumns ?? []).forEach((name, offset) => {
        names[tab.headerWidth + offset] = name;
      });
      return [tab.sheetId, { title, tab, names }];
    }),
  );
  const decoded = { types: [], writes: [], appended: [], widenedColumns: {}, newTabs: [], fields: [] };
  for (const request of body.requests) {
    const type = typeOf(request);
    decoded.types.push(type);
    const payload = request[type];
    if (type === 'updateCells') {
      decoded.fields.push(payload.fields);
      const known = byId.get(payload.start.sheetId);
      payload.rows.forEach((row, rowOffset) =>
        row.values.forEach((cell, columnOffset) => {
          const columnIndex = payload.start.columnIndex + columnOffset;
          decoded.writes.push({ tab: known?.title, sheetId: payload.start.sheetId, rowIndex: payload.start.rowIndex + rowOffset, columnIndex, header: known?.names[columnIndex], ...valueOf(cell) });
        }),
      );
    } else if (type === 'appendCells') {
      decoded.fields.push(payload.fields);
      const known = byId.get(payload.sheetId);
      for (const row of payload.rows) {
        decoded.appended.push({ tab: known?.title, sheetId: payload.sheetId, cells: row.values.map((cell, columnIndex) => ({ columnIndex, header: known?.names[columnIndex], ...valueOf(cell) })) });
      }
    } else if (type === 'appendDimension') {
      if (payload.dimension === 'COLUMNS') decoded.widenedColumns[payload.sheetId] = (decoded.widenedColumns[payload.sheetId] ?? 0) + payload.length;
    } else if (type === 'addSheet') {
      decoded.newTabs.push({ title: payload.properties.title, sheetId: payload.properties.sheetId });
    }
  }
  return decoded;
}

// ------------------------------------------------------------------ generators

const CELL_VALUES = [null, 1, 'a', '=x', 'Applied', true, 0.5];
const valueFor = (seed, a, b) => CELL_VALUES[Math.abs(seed * 31 + a * 17 + b * 7) % CELL_VALUES.length];
const EXTRA_UNKNOWN = ['My Notes', 'Recruiter Phone', 'Next Steps'];
const insertKey = (others, at) => {
  const copy = [...others];
  copy.splice(at % (copy.length + 1), 0, KEY_COLUMN);
  return copy;
};

/** One tracker at one moment: the header a human left, the rows in it, the resolution that describes it, and the plans a harvest yields. */
function buildScenario({ others, at, existing, harvested, slack, stride, seed, companiesPresent, companiesExisting, companiesHarvested }) {
  const header = insertKey(others, at);
  const blank = Object.fromEntries(header.map((column) => [column, null]));
  const rows = [];
  const rowIndexByKey = {};
  const rowsByKey = {};
  existing.forEach((id, position) => {
    const row = Object.fromEntries(header.map((column, index) => [column, column === KEY_COLUMN ? `linkedin:${id}` : valueFor(seed, id, index)]));
    rows.push(row);
    rowIndexByKey[`linkedin:${id}`] = 1 + position * stride;
    rowsByKey[`linkedin:${id}`] = row;
    for (let filler = 1; filler < stride; filler += 1) rows.push({ ...blank });
  });
  const jobs = harvested.map((id) => aHarvestedJob(id, Object.fromEntries(HARVESTER_COLUMNS.map((column, index) => [column, valueFor(seed + (id % 2), id, header.indexOf(column) >= 0 ? header.indexOf(column) : index)]))));
  const companyRow = (id) => aCompanyRow(`Company ${id}`);
  const companies = companiesHarvested.map((id) => companyRow(id));
  const sheetState = { tabs: { Jobs: { columns: header, rows } } };
  const resolution = {
    tabs: {
      Jobs: {
        sheetId: 1,
        rowCount: 1 + existing.length * stride + 10,
        columnCount: header.length + slack,
        headerWidth: header.length,
        columnIndex: Object.fromEntries(header.map((column, index) => [column, index])),
        rowIndexByKey,
        rowsByKey,
      },
    },
  };
  if (companiesPresent) {
    const companyKeys = companiesExisting.map((id) => `Company ${id}`);
    sheetState.tabs.Companies = { columns: COMPANIES_COLUMNS, rows: companiesExisting.map((id) => ({ ...aCompanyRow(`Company ${id}`), 'Jobs Seen': valueFor(seed, id, 3) })) };
    resolution.tabs.Companies = {
      sheetId: 2,
      rowCount: 40,
      columnCount: 26,
      headerWidth: COMPANIES_COLUMNS.length,
      columnIndex: Object.fromEntries(COMPANIES_COLUMNS.map((column, index) => [column, index])),
      rowIndexByKey: Object.fromEntries(companyKeys.map((key, position) => [key, 1 + position])),
      rowsByKey: Object.fromEntries(sheetState.tabs.Companies.rows.map((row) => [row.Company, row])),
    };
  }
  const model = aHarvest({ jobs, companies });
  return { header, sheetState, resolution, model, plans: planMergeAll(sheetState, model) };
}

export const aTrackerMoment = fc
  .record({
    others: fc.shuffledSubarray([...HARVESTER_COLUMNS, ...HUMAN_COLUMNS, ...EXTRA_UNKNOWN]),
    at: fc.nat(60),
    existing: fc.uniqueArray(fc.integer({ min: 1, max: 30 }), { maxLength: 6 }),
    harvested: fc.uniqueArray(fc.integer({ min: 1, max: 30 }), { maxLength: 6 }),
    slack: fc.constantFrom(0, 1, 3, 26),
    stride: fc.constantFrom(1, 2),
    seed: fc.integer({ min: 0, max: 1000 }),
    companiesPresent: fc.boolean(),
    companiesExisting: fc.uniqueArray(fc.integer({ min: 1, max: 5 }), { maxLength: 3 }),
    companiesHarvested: fc.uniqueArray(fc.integer({ min: 1, max: 5 }), { maxLength: 3 }),
  })
  .map(buildScenario);
