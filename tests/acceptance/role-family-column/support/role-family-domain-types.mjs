// Domain vocabulary for the role-family-column acceptance tests (nWave Mandate-12).
//
// Production owns the domain nouns: column lists, ownership, the family table and the request allow-list are
// re-exported from src/. This module adds the family labels as the operator's pivots spell them, the builders that
// shape a cache of adverts and a tracker that predates the column, the composition of the driving port (`build`, as
// an operator runs it, offline and into a Sheet), and the observers that read a tracker back. Nothing here decides
// anything a production module decides: the expected family of a title lives in golden-titles.mjs, not here.

import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import * as XLSX from 'xlsx';

import { createMessageReader } from '../../../../src/adapters/json-message-reader.mjs';
import { harvest } from '../../../../src/core/harvest.mjs';
import { createSheetsFake } from '../../sheets-api-target/support/sheets-fake.mjs';
import {
  ALLOWED_REQUEST_TYPES,
  HARVESTER_COLUMNS,
  HUMAN_COLUMNS,
  JOBS_COLUMNS,
  KEY_COLUMN,
  SheetsRefusal,
  TAB_OWNERSHIP,
  UNKNOWN_COLUMNS,
  aMessage,
  aSheetsCredentialHome,
  aTracker,
  aWorkbookFile,
  aWorkspace,
  cacheAlert,
  columnsByKey,
  environment,
  fileDigests,
  judgementOf,
  keysOf,
  runHarvestAsync,
  tabRows,
} from '../../sheets-api-target/support/sheets-domain-types.mjs';
import { runHarvest } from '../../job-alert-harvester/support/domain-types.mjs';
import { CLOSED_FAMILY_SET, FAMILY_PRIORITY_ORDER, FamilyName, ROLE_FAMILY_COLUMN } from './family-names.mjs';

export { OTHER_FAMILY, ROLE_FAMILIES } from '../../../../src/core/role-families.mjs';
export { ALLOWED_REQUEST_TYPES, CLOSED_FAMILY_SET, FAMILY_PRIORITY_ORDER, FamilyName, ROLE_FAMILY_COLUMN, HARVESTER_COLUMNS, HUMAN_COLUMNS, JOBS_COLUMNS, KEY_COLUMN, SheetsRefusal, TAB_OWNERSHIP, UNKNOWN_COLUMNS };
export { aSheetsCredentialHome, environment, fileDigests, runHarvest };

/** The Jobs header of a tracker that predates the column: every declared column but the new one. */
export const LEGACY_JOBS_HEADER = Object.freeze(JOBS_COLUMNS.filter((column) => column !== ROLE_FAMILY_COLUMN));
/** Google's default grid width; the legacy header is exactly this wide. */
export const LEGACY_GRID_WIDTH = 26;
/** How many `other` titles the tuning view shows (DESIGN OQ-5). */
export const TUNING_LIMIT = 15;
export const ALERT_DATE = '2026-07-25T09:48:00Z';
/** The fake numbers tabs from 1 in the order given, and Jobs is first. */
export const JOBS_SHEET_ID = 1;

// ---------------------------------------------------------------- workspaces

const scratch = [];
/** An isolated working directory removed after the scenario. */
export function aScratchWorkspace() {
  const workspace = aWorkspace();
  scratch.push(workspace);
  return workspace;
}
export const useWorkspaceCleanup = () =>
  afterEach(() => {
    while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
  });

// ------------------------------------------------------------ the cache of adverts

const SYNTHETIC_COMPANIES = Object.freeze(['Acme Ltd', 'Globex Ltd', 'Initech Ltd', 'Umbrella Ltd', 'Example Co']);
const FIRST_JOB_ID = 4400000000;
const SAVED_SEARCH_ROTATION = Object.freeze(['agile coach in United Kingdom', 'delivery manager in England']);
const ALERT_SUBJECT = 'New roles matching your saved search';

/** An advert as an alert carries it: a title, a synthetic company, a job id. */
export const anAdvert = ({ title, company, id } = {}) => ({ title, ...(company ? { company } : {}), ...(id ? { id } : {}) });

/** Four adverts, three families and one that falls through: the cohort most scenarios start from. */
export const STANDARD_COHORT = Object.freeze([
  Object.freeze({ title: 'Scrum Master', family: FamilyName.SCRUM_MASTER }),
  Object.freeze({ title: 'Product Owner', family: FamilyName.PRODUCT }),
  Object.freeze({ title: 'Data Analyst', family: FamilyName.OTHER }),
  Object.freeze({ title: 'Programme Manager', family: FamilyName.DELIVERY_MANAGER }),
]);
export const theAdvertsOf = (cohort) => cohort.map(({ title }) => anAdvert({ title }));
/** `key -> family` for adverts cached from `cohort`, in the order they were cached. */
export const theFamiliesExpectedOf = (cached, cohort) => Object.fromEntries(cached.map((advert, index) => [advert.key, cohort[index].family]));

/** The Dedup Key the harvester gives a LinkedIn advert. */
export const dedupKeyOf = (id) => `linkedin:${id}`;

const withIdentity = (adverts) =>
  adverts.map((advert, index) => ({
    id: advert.id ?? String(FIRST_JOB_ID + index),
    title: advert.title,
    company: advert.company ?? SYNTHETIC_COMPANIES[index % SYNTHETIC_COMPANIES.length],
  }));

/**
 * Caches `adverts` as alerts, ten to a message, where the harvest reads them (`.cache/messages/<month>/<id>.json`).
 * Returns each advert with the id and Dedup Key it was given, so a scenario can find its row.
 */
export function aCacheOfAdverts(workspace, adverts, { perMessage = 10, date = ALERT_DATE, searchTerm } = {}) {
  const identified = withIdentity(adverts).map((advert) => ({ ...advert, key: dedupKeyOf(advert.id) }));
  for (let start = 0; start < identified.length; start += perMessage) {
    const jobs = identified.slice(start, start + perMessage).map(({ id, title, company }) => ({ id, title, company }));
    const sequence = start / perMessage;
    cacheAlert(workspace, aMessage({ id: `alert-${String(sequence).padStart(4, '0')}`, date, subject: ALERT_SUBJECT, jobs, searchTerm: searchTerm ?? SAVED_SEARCH_ROTATION[sequence % SAVED_SEARCH_ROTATION.length] }));
  }
  return identified;
}

/** One alert, one sighting of the given adverts, on the given date and saved search. */
export function anAlertSighting(workspace, { id, date, searchTerm, adverts }) {
  const jobs = withIdentity(adverts);
  cacheAlert(workspace, aMessage({ id, date, subject: ALERT_SUBJECT, jobs, ...(searchTerm ? { searchTerm } : {}) }));
  return jobs.map((job) => ({ ...job, key: dedupKeyOf(job.id) }));
}

/** What `build` derives from the whole cache (DR-0009): the production derivation, used to shape trackers that match it. */
export const theHarvestOf = (workspace) => harvest(createMessageReader(join(workspace, '.cache/messages')).readAll());

// ------------------------------------------------------------ trackers that predate the column

/** What the operator typed against their jobs: a status, a note, a qualification, a date. */
export const aHumansJudgement = (_row, index) => ({
  'Status': ['Applied', 'Interview', null][index % 3],
  'Qualified?': index % 2 === 0 ? 'No (SC Clearance)' : null,
  'Applied on Date': index % 3 === 0 ? '2026-07-30' : null,
  'My Notes': `note ${index}`,
});

/**
 * The tracker's Jobs rows as they stood: every harvester-owned cell already as the harvest derives it (so only the new
 * column can differ), the operator's judgement typed in, and Role Family held as `roleFamilyByKey[key]` (blank when the key is not listed) or absent.
 */
export function theTrackerRowsAsTheyStood(model, { judgement = aHumansJudgement, roleFamilyByKey } = {}) {
  return model.jobs.rows.map((derived, index) => {
    const { [ROLE_FAMILY_COLUMN]: _derivedFamily, ...harvested } = derived;
    const held = roleFamilyByKey ? { [ROLE_FAMILY_COLUMN]: roleFamilyByKey[derived[KEY_COLUMN]] ?? null } : {};
    return { ...harvested, ...judgement(derived, index), ...held };
  });
}

/**
 * Caches a cohort of adverts and shapes the rows of a tracker that already holds them: `held(expected, cached)` says what
 * its Role Family column holds, by key (absent: the tracker predates the column).
 */
export function aCohortCached(workspace, cohort, { held } = {}) {
  const cached = aCacheOfAdverts(workspace, theAdvertsOf(cohort));
  const expected = theFamiliesExpectedOf(cached, cohort);
  const rows = theTrackerRowsAsTheyStood(theHarvestOf(workspace), { roleFamilyByKey: held ? held(expected, cached) : undefined });
  return { cached, expected, rows };
}

/** An .xlsx tracker holding a Jobs tab, plus any tab the harvester does not know. */
export function aTrackerWorkbook(path, { header, rows, contacts = null }) {
  return aWorkbookFile(path, { ...aTracker({ jobs: rows, jobsHeader: header }), ...(contacts ? { Contacts: contacts } : {}) });
}
/** A tab the operator keeps beside the harvester's. */
export const theOperatorsContacts = () => ({ header: ['Name', 'Company'], rows: [['Alex Example', 'Acme Ltd'], ['Sam Sample', 'Globex Ltd']] });

/** A Sheet as the operator keeps it in Drive: Jobs, and Companies and Sources holding only their headers. */
export function aSheetHoldingTheTracker({ header, rows, grid, bindMetadata = false }) {
  return createSheetsFake({ tabs: aTracker({ jobs: rows, companies: [], sources: [], jobsHeader: header }), ...(grid ? { grid } : {}), bindMetadata });
}

// ------------------------------------------------------------------- running

export const operatorBuildsNewWorkbook = (workspace, out, ...extra) => runHarvest(['build', '--out', out, ...extra], { cwd: workspace });
export const operatorMerges = (workspace, tracker, ...extra) => runHarvest(['build', '--out', tracker, '--merge', tracker, ...extra], { cwd: workspace });
export const operatorPreviews = (workspace, ...args) => runHarvest(['build', '--dry-run', ...args], { cwd: workspace });
export const operatorRebuildsFromTheCache = (workspace, out) => runHarvest(['--in', join(workspace, '.cache/messages'), '--out', out], { cwd: workspace });
export const operatorBuildsIntoTheSheet = (workspace, home, baseUrl, ...args) => runHarvestAsync(['build', '--target', 'sheets', ...args], { cwd: workspace, env: environment(home, baseUrl), timeoutMs: 90_000 });

// ------------------------------------------------------------- observing a workbook

const namedRows = (header, rows) => rows.map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? null])));
const byKey = (rows, columns) => Object.fromEntries(rows.filter((row) => row[KEY_COLUMN] !== null).map((row) => [row[KEY_COLUMN], Object.fromEntries(columns.map((column) => [column, row[column] ?? null]))]));
const OTHER_HARVESTER_COLUMNS = HARVESTER_COLUMNS.filter((column) => column !== ROLE_FAMILY_COLUMN);
const DERIVED_TABS = ['Jobs', 'Companies', 'Sources'];

/** Port-exposed observables of a tracker workbook: the Jobs header and cells by key, and the tabs the harvester does not own. */
export function observeWorkbook(path) {
  const book = XLSX.read(readFileSync(path));
  const grid = XLSX.utils.sheet_to_json(book.Sheets.Jobs, { header: 1, defval: null });
  const [header = [], ...cells] = grid;
  const rows = namedRows(header, cells);
  return {
    'jobs.header': header,
    'jobs.keys': rows.map((row) => row[KEY_COLUMN]).filter((key) => key !== null),
    'jobs.roleFamilyByKey': Object.fromEntries(Object.entries(byKey(rows, [ROLE_FAMILY_COLUMN])).map(([key, value]) => [key, value[ROLE_FAMILY_COLUMN]])),
    'jobs.judgement': byKey(rows, [...HUMAN_COLUMNS, ...UNKNOWN_COLUMNS].filter((column) => header.includes(column))),
    'jobs.otherHarvesterCells': byKey(rows, OTHER_HARVESTER_COLUMNS.filter((column) => header.includes(column))),
    'jobs.handAddedRows': rows.filter((row) => row[KEY_COLUMN] === null).map((row) => Object.fromEntries(Object.entries(row).filter(([column]) => column !== ROLE_FAMILY_COLUMN))),
    'jobs.handAddedRoleFamily': rows.filter((row) => row[KEY_COLUMN] === null).map((row) => row[ROLE_FAMILY_COLUMN] ?? null),
    'workbook.otherTabs': Object.fromEntries(book.SheetNames.filter((name) => !DERIVED_TABS.includes(name)).map((name) => [name, XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: null })])),
  };
}
export const WORKBOOK_UNIVERSE = Object.freeze(['jobs.header', 'jobs.keys', 'jobs.roleFamilyByKey', 'jobs.judgement', 'jobs.otherHarvesterCells', 'jobs.handAddedRows', 'jobs.handAddedRoleFamily', 'workbook.otherTabs']);

/** Every cell of the Jobs tab outside the named column: type, value and format, the surface a second merge could disturb. */
export function workbookCellsOutside(path, column = ROLE_FAMILY_COLUMN) {
  const book = XLSX.read(readFileSync(path), { cellNF: true });
  const sheet = book.Sheets.Jobs;
  const [header = []] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const skipped = header.indexOf(column);
  const cells = {};
  for (const address of Object.keys(sheet).filter((name) => !name.startsWith('!'))) {
    const { c } = XLSX.utils.decode_cell(address);
    if (c === skipped) continue;
    cells[address] = { t: sheet[address].t, v: sheet[address].v, z: sheet[address].z ?? null };
  }
  return cells;
}

/** The golden (or any titled) adverts of one family, with the key each was cached under. */
export const rowsOfFamily = (run, titles, family) => run.cached.map((advert, index) => ({ ...advert, family: titles[index].family })).filter((row) => row.family === family);

export const familiesInWorkbook = (path) => observeWorkbook(path)['jobs.roleFamilyByKey'];

// ------------------------------------------------------------- observing a Sheet

/** Port-exposed observables of the recorded Sheet: the Jobs header, cells by key, the grid width, tabs and Drive files. */
export function observeSheet(fake) {
  const snapshot = fake.snapshot();
  const familyCells = columnsByKey(snapshot, 'Jobs', KEY_COLUMN, [ROLE_FAMILY_COLUMN]);
  return {
    'jobs.header': tabRows(snapshot, 'Jobs').header,
    'jobs.keys': keysOf(snapshot, 'Jobs', KEY_COLUMN),
    'jobs.roleFamilyByKey': Object.fromEntries(Object.entries(familyCells).map(([key, value]) => [key, value[ROLE_FAMILY_COLUMN]])),
    'jobs.judgement': judgementOf(snapshot),
    'jobs.otherHarvesterCells': columnsByKey(snapshot, 'Jobs', KEY_COLUMN, OTHER_HARVESTER_COLUMNS),
    'jobs.gridColumns': snapshot.tabs.Jobs.grid.columnCount,
    'sheet.tabNames': snapshot.tabOrder,
    'drive.files': fake.files(),
  };
}
export const SHEET_UNIVERSE = Object.freeze(['jobs.header', 'jobs.keys', 'jobs.roleFamilyByKey', 'jobs.judgement', 'jobs.otherHarvesterCells', 'jobs.gridColumns', 'sheet.tabNames', 'drive.files']);

/** The one data batch the run sent, or null when it sent none. */
export const theDataBatch = (fake) => fake.requestsTo('batch-update')[0] ?? null;

/** The header cells of the Jobs tab a data batch writes: where, and what. */
export const headerCellsWrittenBy = (batch) =>
  (batch?.body?.requests ?? [])
    .filter((request) => request.updateCells?.start.sheetId === JOBS_SHEET_ID && request.updateCells.start.rowIndex === 0)
    .flatMap((request) => request.updateCells.rows[0].values.map((cell, offset) => ({ columnIndex: request.updateCells.start.columnIndex + offset, value: cell.userEnteredValue?.stringValue ?? null })));

/** Header names of the columns a data batch writes cells into, resolved against the header the Sheet held afterwards. */
export function columnsWrittenBy(batch, headerAfter) {
  const written = new Set();
  for (const request of batch?.body?.requests ?? []) {
    const payload = request.updateCells;
    if (!payload || payload.start.sheetId !== JOBS_SHEET_ID) continue;
    payload.rows.forEach((row) => row.values.forEach((_cell, offset) => written.add(headerAfter[payload.start.columnIndex + offset])));
  }
  return [...written];
}

/** How many cells of the Jobs tab's data rows (not its header) a data batch writes. */
export const jobsCellsWrittenBy = (batch) =>
  (batch?.body?.requests ?? [])
    .filter((request) => request.updateCells?.start.sheetId === JOBS_SHEET_ID && request.updateCells.start.rowIndex > 0)
    .reduce((sum, request) => sum + request.updateCells.rows.reduce((cells, row) => cells + row.values.length, 0), 0);

/** Total columns an appendDimension request added to the Jobs tab. */
export const columnsWidenedBy = (batch) =>
  (batch?.body?.requests ?? []).filter((request) => request.appendDimension?.dimension === 'COLUMNS' && request.appendDimension.sheetId === JOBS_SHEET_ID).reduce((sum, request) => sum + request.appendDimension.length, 0);

// ------------------------------------------------------------- reading the run's words

const lines = (text) => text.split('\n');

/** The tuning view on stderr: how many adverts fell through, and the most frequent titles with counts. Null when absent. */
export function tuningViewOf(stderr) {
  const all = lines(stderr);
  const at = all.findIndex((line) => /^harvest build: \d+ of \d+ advert\(s\) classified other; most frequent:\s*$/.test(line));
  if (at < 0) return null;
  const [, other, total] = /^harvest build: (\d+) of (\d+) /.exec(all[at]);
  const entries = [];
  for (const line of all.slice(at + 1)) {
    const entry = /^\s+(\d+)\s+(\S.*)$/.exec(line);
    if (!entry) break;
    entries.push({ count: Number(entry[1]), title: entry[2].trimEnd() });
  }
  return { other: Number(other), total: Number(total), entries };
}

/** The stderr line that counts adverts per family, or null. */
export const familyCountsLineOf = (stderr) => lines(stderr).find((line) => /role families/i.test(line)) ?? null;

/** Every stderr or report line that itemises a Role Family cell change, as `{ key, from, to }`. */
export function roleFamilyCorrectionsIn(text) {
  return lines(text)
    .map((line) => /^\s*Jobs\t([^\t]+)\tRole Family: (.*) -> (.*)$/.exec(line))
    .filter(Boolean)
    .map(([, key, from, to]) => ({ key, from, to }));
}

export const reportTextOf = (path) => readFileSync(path, 'utf8');

// ------------------------------------------------------------------ memoised golden run

let golden = null;
/** One `build` of a new workbook over the whole golden table, shared by the scenarios that read it. */
export async function theGoldenBuild(titles) {
  if (golden) return golden;
  const workspace = aWorkspace();
  const cached = aCacheOfAdverts(workspace, titles.map(({ title }) => anAdvert({ title })));
  const out = join(workspace, 'tracker.xlsx');
  const result = operatorBuildsNewWorkbook(workspace, out);
  golden = { workspace, out, cached, result, observed: result.status === 0 ? observeWorkbook(out) : null };
  return golden;
}
export const forgetTheGoldenBuild = () => {
  if (golden) rmSync(golden.workspace, { recursive: true, force: true });
  golden = null;
};

