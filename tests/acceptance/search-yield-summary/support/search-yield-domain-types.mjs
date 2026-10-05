// Domain vocabulary for the search-yield-summary acceptance tests (nWave Mandate-12).
//
// Production owns the domain nouns: the yield constants and column lists are re-exported from src/. This module adds the
// builders that shape a cache of alerts (synthetic searches, titles and overlap, written where the harvest reads them and
// parsed by the real extractJobs), the trackers a merge starts from, the composition of the driving port (`build`, as an
// operator runs it: offline into an .xlsx, and into a Sheet through the loopback fake), and the observers that read a
// tracker and the run's stderr back. Nothing here decides anything a production module decides: the expected figures live
// in yield-oracle.mjs, which shares no code with src/.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach } from 'vitest';
import * as XLSX from 'xlsx';

import { createMessageReader } from '../../../../src/adapters/json-message-reader.mjs';
import { harvest } from '../../../../src/core/harvest.mjs';
import { extractJobs } from '../../../../src/core/parse-linkedin.mjs';
import { createSheetsFake } from '../../sheets-api-target/support/sheets-fake.mjs';
import {
  ALLOWED_REQUEST_TYPES,
  COMPANIES_COLUMNS,
  JOBS_COLUMNS,
  KEY_COLUMN,
  SOURCES_COLUMNS,
  aMessage,
  aSheetsCredentialHome,
  aTracker,
  aWorkbookFile,
  aWorkspace,
  cacheAlert,
  environment,
  fileDigests,
  runHarvestAsync,
  runHarvestWith,
  tabRows,
} from '../../sheets-api-target/support/sheets-domain-types.mjs';
import { aDigestBody } from '../../job-alert-harvester/support/domain-types.mjs';
import { expectedSearchYield, expectedStderrFor } from './yield-oracle.mjs';
import { NO_SEARCH, Role } from './yield-vocabulary.mjs';

export {
  TOTAL_ROW_LABEL,
  UNIQUE_NOT_SHOWN,
  UNPARSED_SEARCH_LABEL,
  YIELD_LABEL_WIDTH,
  YIELD_NAMED_SEARCH_LIMIT,
  YIELD_WINDOW_DAYS,
} from '../../../../src/core/search-yield.mjs';
export { ALLOWED_REQUEST_TYPES, COMPANIES_COLUMNS, JOBS_COLUMNS, KEY_COLUMN, SOURCES_COLUMNS, aSheetsCredentialHome, fileDigests };
export { expectedSearchYield, expectedStderrFor };
export * from './yield-vocabulary.mjs';

/** The Role Family cell value of an advert that fell through. */
export const OTHER_FAMILY_CELL = 'other';
/** The marker every printed block's heading starts with. */
export const YIELD_HEADING_PREFIX = 'harvest build: search yield,';
export const ALL_TIME_HEADING = 'harvest build: search yield, all cached alerts (distinct adverts per saved search)';
export const recentHeadingTo = (endDate) => `harvest build: search yield, last 28 days to ${endDate}`;
const FIRST_ADVERT_ID = 4600000000;
const SYNTHETIC_COMPANIES = Object.freeze(['Acme Ltd', 'Globex Ltd', 'Initech Ltd', 'Umbrella Ltd', 'Example Co']);
const ALERT_SUBJECT = 'New roles matching your saved search';
const FIXED_CLOCK = pathToFileURL(new URL('./fixed-clock.mjs', import.meta.url).pathname).href;

// ---------------------------------------------------------------- workspaces

const scratch = [];
/** An isolated working directory removed after the scenario. */
export function aScratchWorkspace() {
  const workspace = aWorkspace();
  scratch.push(workspace);
  return workspace;
}
/** A HOME that holds nothing: the offline target needs no credential and must find none. */
export function anEmptyHome() {
  const home = mkdtempSync(join(tmpdir(), 'yield-home-'));
  scratch.push(home);
  return home;
}
export const useWorkspaceCleanup = () =>
  afterEach(() => {
    while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
  });

// ------------------------------------------------------------- adverts and alerts

/** An advert as an alert carries it: a title, and the job id that is its identity (a repost is a new id). */
export const anAdvert = (title, nth) => ({ id: String(FIRST_ADVERT_ID + nth), title, company: SYNTHETIC_COMPANIES[nth % SYNTHETIC_COMPANIES.length] });
/** Adverts numbered from 1 in the order given; `theAdverts([Role.COACH, Role.SCRUM])` gives two. */
export const theAdverts = (titles, first = 1) => titles.map((title, index) => anAdvert(title, first + index));

/** One alert message: the saved search that sent it (null: it names none), the day, and the adverts it carries. */
export const anAlert = ({ search, on, adverts }) => ({ search, on, adverts });

/** The `search`-less header the parser reads as "no search term": the digest minus its first line. */
const withoutSearchLine = (body) => body.replace(/^Your job alert for .*\n\n/, '');

const clockTime = (sequence) => `${String(8 + Math.floor(sequence / 60)).padStart(2, '0')}:${String(sequence % 60).padStart(2, '0')}:00Z`;

/** The cached message each alert is: distinct arrival minute per alert, in plan order, so first sightings are unambiguous. */
export function messagesOf(alerts) {
  if (alerts.length > 900) throw new Error('aCacheOfAlerts gives each alert a distinct minute of one day; at most 900 per plan');
  return alerts.map(({ search, on, adverts }, sequence) => {
    const date = `${on}T${clockTime(sequence)}`;
    const jobs = adverts.map(({ id, title, company }) => ({ id, title, company }));
    const body = aDigestBody({ jobs, searchTerm: search ?? 'placeholder' });
    return aMessage({ id: `alert-${String(sequence).padStart(4, '0')}`, date, subject: ALERT_SUBJECT, jobs, plaintextBody: search === NO_SEARCH ? withoutSearchLine(body) : body });
  });
}

/** Writes the alerts where the harvest reads them (`.cache/messages/<month>/<id>.json`); returns the messages written. */
export function aCacheOfAlerts(workspace, alerts) {
  const messages = messagesOf(alerts);
  messages.forEach((message) => cacheAlert(workspace, message));
  return messages;
}

/** The search term as the parser reads it from the alert's first line: null when the alert has none, trimmed otherwise. */
export const termAsParsed = (search) => (search === NO_SEARCH ? null : search.trim());

/** The oracle's view of a plan: one sighting per advert card, the search it came from, the title it carried, when. */
export const sightingsOf = (alerts) =>
  messagesOf(alerts).flatMap((message, index) => alerts[index].adverts.map(({ id, title }) => ({ search: termAsParsed(alerts[index].search), id, title, at: message.date })));

/** What the real parser reads out of a plan: the rows `extractJobs` gives for every message, in plan order. */
export const parsedRowsOf = (alerts) => messagesOf(alerts).flatMap(extractJobs);

/** What `build` derives from the whole cache (DR-0009): the production derivation, used to shape trackers that match it. */
export const theHarvestOf = (workspace) => harvest(createMessageReader(join(workspace, '.cache/messages')).readAll());

/** The Dedup Key the harvester gives a LinkedIn advert. */
export const dedupKeyOf = (id) => `linkedin:${id}`;

/**
 * The inputs of the pure summary for oracle-style sightings: the rows `extractJobs` would give (term, key, date, title),
 * and the collapsed adverts titled by their first sighting, as `harvest()` holds them.
 */
export function summaryInputsOf(sightings) {
  const rows = sightings.map(({ search, id, title, at }) => ({ searchTerm: search, dedupKey: dedupKeyOf(id), seenAt: at, title }));
  const firsts = new Map();
  for (const row of [...rows].sort((left, right) => (left.seenAt < right.seenAt ? -1 : left.seenAt > right.seenAt ? 1 : 0))) if (!firsts.has(row.dedupKey)) firsts.set(row.dedupKey, { dedupKey: row.dedupKey, title: row.title });
  return { sightings: rows, adverts: [...firsts.values()] };
}

// ---------------------------------------------------------------- the cohorts the scenarios start from

/**
 * Eleven adverts, four named searches that overlap, and one alert that names no search; every sighting within 6 days.
 * The figures by hand (found / other / on-target / unique):
 *   agile coach in Examplestan 6/1/5/1, engineering manager in Examplestan 5/3/2/1, scrum master in Exampleshire 5/2/3/1,
 *   agile coach (remote) in Examplestan 2/0/2/0, (no search term) 2/0/2/-, all searches 11/3/8/-.
 */
export function theCohort() {
  const [a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11] = theAdverts([
    Role.COACH, Role.COACH, Role.SCRUM, Role.SCRUM, Role.DELIVERY, Role.ANALYST, Role.DEVELOPER, Role.ANALYST, Role.OWNER, Role.CHANGE, Role.PROGRAMME,
  ]);
  const alerts = [
    anAlert({ search: 'agile coach in Examplestan', on: '2026-09-01', adverts: [a1, a2, a3, a5, a6, a9] }),
    anAlert({ search: 'agile coach in Examplestan', on: '2026-09-02', adverts: [a1, a2] }),
    anAlert({ search: 'scrum master in Exampleshire', on: '2026-09-03', adverts: [a3, a4, a5, a7, a8] }),
    anAlert({ search: 'engineering manager in Examplestan', on: '2026-09-04', adverts: [a5, a6, a7, a8, a10] }),
    anAlert({ search: 'agile coach (remote) in Examplestan', on: '2026-09-05', adverts: [a1, a2] }),
    anAlert({ search: NO_SEARCH, on: '2026-09-06', adverts: [a9, a11] }),
  ];
  return { alerts, adverts: { a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11 } };
}

/**
 * The same shape over two months, for the recent window. The latest sighting date is 2026-09-30, so the window is the 28
 * dates 2026-09-03 to 2026-09-30. The figures by hand, all alerts: agile coach in Examplestan 4/1/3/2, scrum master in
 * Exampleshire 4/1/3/2, change manager in Examplestan 1/0/1/1, all searches 8/2/6; last 28 days: scrum master in Exampleshire
 * 3/0/3/3, agile coach in Examplestan 2/1/1/1, change manager in Examplestan 1/0/1/1, all searches 6/1/5.
 */
export function theSpreadCohort() {
  const [b1, b2, b3, b4, b5, b6, b7, b8] = theAdverts([Role.COACH, Role.SCRUM, Role.SCRUM, Role.ANALYST, Role.DELIVERY, Role.OWNER, Role.DEVELOPER, Role.CHANGE], 101);
  const alerts = [
    anAlert({ search: 'agile coach in Examplestan', on: '2026-08-10', adverts: [b1, b2, b5] }),
    anAlert({ search: 'scrum master in Exampleshire', on: '2026-09-02', adverts: [b4] }),
    anAlert({ search: 'scrum master in Exampleshire', on: '2026-09-03', adverts: [b3] }),
    anAlert({ search: 'agile coach in Examplestan', on: '2026-09-20', adverts: [b1] }),
    anAlert({ search: 'change manager in Examplestan', on: '2026-09-25', adverts: [b8] }),
    anAlert({ search: 'agile coach in Examplestan', on: '2026-09-30', adverts: [b7] }),
    anAlert({ search: 'scrum master in Exampleshire', on: '2026-09-30', adverts: [b5, b6] }),
  ];
  return { alerts, adverts: { b1, b2, b3, b4, b5, b6, b7, b8 }, endDate: '2026-09-30' };
}

/** What the cohort prints, written out once and proved equal to the oracle's rendering in support-builders.test.mjs. */
export const THE_COHORT_YIELD_LINES = Object.freeze([
  'harvest build: search yield, all cached alerts (distinct adverts per saved search)',
  '  search                                    found      other  on-target  unique',
  '  agile coach in Examplestan                    6    1 (17%)          5       1',
  '  engineering manager in Examplestan            5    3 (60%)          2       1',
  '  scrum master in Exampleshire                  5    2 (40%)          3       1',
  '  agile coach (remote) in Examplestan           2     0 (0%)          2       0',
  '  (no search term)                              2     0 (0%)          2       -',
  '  all searches                                 11    3 (27%)          8       -',
]);

/** What the spread cohort prints: both blocks. */
export const THE_SPREAD_YIELD_LINES = Object.freeze([
  'harvest build: search yield, all cached alerts (distinct adverts per saved search)',
  '  search                                    found      other  on-target  unique',
  '  agile coach in Examplestan                    4    1 (25%)          3       2',
  '  scrum master in Exampleshire                  4    1 (25%)          3       2',
  '  change manager in Examplestan                 1     0 (0%)          1       1',
  '  all searches                                  8    2 (25%)          6       -',
  'harvest build: search yield, last 28 days to 2026-09-30',
  '  search                                    found      other  on-target  unique',
  '  scrum master in Exampleshire                  3     0 (0%)          3       3',
  '  agile coach in Examplestan                    2    1 (50%)          1       1',
  '  change manager in Examplestan                 1     0 (0%)          1       1',
  '  all searches                                  6    1 (17%)          5       -',
]);

/** `count` saved searches, each sending the same two adverts (one on-target, one other) on one day; a search per alert. */
export function manySearches(count, { on = '2026-09-10', first = 1 } = {}) {
  const adverts = theAdverts([Role.COACH, Role.ANALYST], 201);
  return Array.from({ length: count }, (_, index) => anAlert({ search: `search ${String(first + index).padStart(2, '0')} in Examplestan`, on, adverts }));
}

// ------------------------------------------------------------------ trackers

/** An .xlsx tracker whose three harvester tabs hold only their headers: a merge appends everything. */
export const anEmptyTracker = (path, { contacts = null } = {}) =>
  aWorkbookFile(path, { ...aTracker({ jobs: [], companies: [], sources: [], jobsHeader: JOBS_COLUMNS }), ...(contacts ? { Contacts: contacts } : {}) });

/** What the operator typed against their jobs. */
export const aHumansJudgement = (_row, index) => ({ 'Status': ['Applied', 'Interview', null][index % 3], 'My Notes': `note ${index}` });

/** An .xlsx tracker holding exactly what the harvest derives from the cache, the operator's notes typed in beside it. */
export function aTrackerHoldingTheCache(path, workspace, { judgement = true } = {}) {
  const model = theHarvestOf(workspace);
  const jobs = model.jobs.rows.map((row, index) => ({ ...row, ...(judgement ? aHumansJudgement(row, index) : {}) }));
  return aWorkbookFile(path, aTracker({ jobs, companies: model.companies.rows, sources: model.sources.rows, jobsHeader: judgement ? [...JOBS_COLUMNS, 'My Notes'] : JOBS_COLUMNS }));
}

/** A Sheet in the operator's Drive holding exactly what the harvest derives from the cache. */
export function aSheetHoldingTheCache(workspace, { grid } = {}) {
  const model = theHarvestOf(workspace);
  return createSheetsFake({ tabs: aTracker({ jobs: model.jobs.rows, companies: model.companies.rows, sources: model.sources.rows, jobsHeader: JOBS_COLUMNS }), ...(grid ? { grid } : {}), bindMetadata: false });
}
/** A Sheet whose tabs hold only their headers: a build appends everything. */
export const anEmptySheet = () => createSheetsFake({ tabs: aTracker({ jobs: [], companies: [], sources: [], jobsHeader: JOBS_COLUMNS }), bindMetadata: false });

// ------------------------------------------------------------------- running

/** The environment of an offline run: an empty HOME, and optionally a clock stopped at `clock` (an ISO instant). */
const offlineEnvironment = ({ clock } = {}) => ({ HOME: anEmptyHome(), ...(clock ? { FIXED_CLOCK_ISO: clock, NODE_OPTIONS: `--import=${FIXED_CLOCK}` } : {}) });
const runOffline = (workspace, args, options) => runHarvestWith(args, { cwd: workspace, env: offlineEnvironment(options) });

export const operatorBuildsNewWorkbook = (workspace, out, ...extra) => runOffline(workspace, ['build', '--out', out, ...extra]);
export const operatorMerges = (workspace, tracker, ...extra) => runOffline(workspace, ['build', '--out', tracker, '--merge', tracker, ...extra]);
export const operatorMergesOnAnotherDay = (workspace, tracker, clock, ...extra) => runOffline(workspace, ['build', '--out', tracker, '--merge', tracker, ...extra], { clock });
export const operatorPreviews = (workspace, ...args) => runOffline(workspace, ['build', '--dry-run', ...args]);
export const operatorRebuildsFromTheCache = (workspace, out) => runOffline(workspace, ['--in', join(workspace, '.cache/messages'), '--out', out]);
export const operatorRunsBuildWith = (workspace, ...args) => runOffline(workspace, ['build', ...args]);
export const operatorBuildsIntoTheSheet = (workspace, baseUrl, ...args) =>
  runHarvestAsync(['build', '--target', 'sheets', ...args], { cwd: workspace, env: environment(aSheetsCredentialHome(), baseUrl), timeoutMs: 90_000 });

// ------------------------------------------------------------- observing a workbook

const DERIVED_TABS = Object.freeze(['Jobs', 'Companies', 'Sources']);

/** Port-exposed observables of a tracker workbook: its tab names, and every tab's header and cell values. */
export function observeTracker(path) {
  const book = XLSX.read(readFileSync(path));
  const grid = (name) => XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: null });
  const [jobsHeader = [], ...jobsRows] = book.Sheets.Jobs ? grid('Jobs') : [];
  const [companiesHeader = [], ...companiesRows] = book.Sheets.Companies ? grid('Companies') : [];
  const [sourcesHeader = [], ...sourcesRows] = book.Sheets.Sources ? grid('Sources') : [];
  return {
    'tracker.tabNames': book.SheetNames,
    'tracker.jobs': { header: jobsHeader, rows: jobsRows },
    'tracker.companies': { header: companiesHeader, rows: companiesRows },
    'tracker.sources': { header: sourcesHeader, rows: sourcesRows },
    'tracker.otherTabs': Object.fromEntries(book.SheetNames.filter((name) => !DERIVED_TABS.includes(name)).map((name) => [name, grid(name)])),
  };
}
export const TRACKER_UNIVERSE = Object.freeze(['tracker.tabNames', 'tracker.jobs', 'tracker.companies', 'tracker.sources', 'tracker.otherTabs']);

/** Every cell of every tab: type, value and format, the surface a second merge could disturb. */
export function trackerCells(path) {
  const book = XLSX.read(readFileSync(path), { cellNF: true });
  return Object.fromEntries(book.SheetNames.map((name) => [name, Object.fromEntries(Object.keys(book.Sheets[name]).filter((address) => !address.startsWith('!')).map((address) => [address, { t: book.Sheets[name][address].t, v: book.Sheets[name][address].v, z: book.Sheets[name][address].z ?? null }]))]));
}

const namedRows = ({ header, rows }) => rows.map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? null])));
/** The Sources tab of a workbook as `search term -> Jobs Found`. */
export const jobsFoundBySearch = (path) => Object.fromEntries(namedRows(observeTracker(path)['tracker.sources']).map((row) => [row['Search Term'], row['Jobs Found']]));
/** The Jobs tab of a workbook as `Dedup Key -> { Job, Role Family }`. */
export const jobFamiliesIn = (path) => Object.fromEntries(namedRows(observeTracker(path)['tracker.jobs']).filter((row) => row[KEY_COLUMN] !== null).map((row) => [row[KEY_COLUMN], { Job: row.Job, 'Role Family': row['Role Family'] }]));
export const jobCountIn = (path) => Object.keys(jobFamiliesIn(path)).length;
export const otherJobCountIn = (path) => Object.values(jobFamiliesIn(path)).filter((row) => row['Role Family'] === OTHER_FAMILY_CELL).length;
export const reportTextOf = (path) => readFileSync(path, 'utf8');

// ------------------------------------------------------------- observing a Sheet

/** Port-exposed observables of the recorded Sheet: every tab's cells and grid, the tab order, Drive's files, and how many write requests it saw. */
export function observeSheet(fake) {
  const snapshot = fake.snapshot();
  return {
    'sheet.tabNames': snapshot.tabOrder,
    'sheet.jobs': tabRows(snapshot, 'Jobs'),
    'sheet.companies': tabRows(snapshot, 'Companies'),
    'sheet.sources': tabRows(snapshot, 'Sources'),
    'sheet.grids': Object.fromEntries(Object.entries(snapshot.tabs).map(([title, tab]) => [title, tab.grid])),
    'drive.files': fake.files(),
    'sheet.writeRequests': fake.writeRequests().length,
  };
}
export const SHEET_UNIVERSE = Object.freeze(['sheet.tabNames', 'sheet.jobs', 'sheet.companies', 'sheet.sources', 'sheet.grids', 'drive.files', 'sheet.writeRequests']);
/** The one data batch the run sent, or null when it sent none. */
export const theDataBatch = (fake) => fake.requestsTo('batch-update')[0] ?? null;

// ------------------------------------------------------------- reading the run's words

const linesOf = (text) => text.split('\n');
const COLUMNS_AFTER_LABEL = /^\s+(\d+)\s+(\d+) \((\d+)%\)\s+(\d+)\s+(\d+|-)$/;

/** Every heading line of a printed block, in order. */
export const yieldHeadingsIn = (stderr) => linesOf(stderr).filter((line) => line.startsWith(YIELD_HEADING_PREFIX));

/** Every stderr line that belongs to a printed block: a heading and the indented lines under it. Empty when none printed. */
export function yieldLinesIn(stderr) {
  const lines = linesOf(stderr);
  const collected = [];
  let inside = false;
  for (const line of lines) {
    if (line.startsWith(YIELD_HEADING_PREFIX)) inside = true;
    else if (!line.startsWith('  ')) inside = false;
    if (inside) collected.push(line);
  }
  return collected;
}

/** The printed blocks as figures: `[{ heading, rows: [{ label, found, other, otherShare, onTarget, unique }], more }]`, rows including `(no search term)` and `all searches`. */
export function yieldBlocksIn(stderr) {
  const blocks = [];
  for (const line of yieldLinesIn(stderr)) {
    if (line.startsWith(YIELD_HEADING_PREFIX)) {
      blocks.push({ heading: line, rows: [], more: null });
      continue;
    }
    const block = blocks.at(-1);
    const more = /^ {2}\.\.\. and (\d+) more search\(es\) not shown$/.exec(line);
    if (more) {
      block.more = Number(more[1]);
      continue;
    }
    const cells = COLUMNS_AFTER_LABEL.exec(line.slice(42));
    if (cells && line.slice(0, 2) === '  ') block.rows.push({ label: line.slice(2, 42).trimEnd(), found: Number(cells[1]), other: Number(cells[2]), otherShare: Number(cells[3]), onTarget: Number(cells[4]), unique: cells[5] === '-' ? null : Number(cells[5]) });
  }
  return blocks;
}
/** The row of one label in the first block (or the block at `index`). */
export const rowOf = (blocks, label, index = 0) => blocks[index]?.rows.find((row) => row.label === label) ?? null;

/** The stderr lines other than the yield block(s), in order: the run's existing words. */
export const stderrWithoutYield = (stderr) => {
  const mine = new Set(yieldLinesIn(stderr));
  return linesOf(stderr).filter((line) => !mine.has(line));
};
export const indexOfLine = (stderr, pattern) => linesOf(stderr).findIndex((line) => pattern.test(line));
