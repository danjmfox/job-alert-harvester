// Domain vocabulary for the sheets-api-target acceptance tests (nWave Mandate-12).
//
// Production owns the domain nouns: refusal codes, scope profiles, column ownership and request classes are
// re-exported from src/. This module adds the builders that shape a tracker Sheet and its plans, the credential
// home with a Sheets token slot, the composition of the Sheets adapters over a fake at the HTTP boundary, and the
// CLI runners. Nothing here decides anything a production module decides.

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as XLSX from 'xlsx';

import { createGoogleTokenSource } from '../../../../src/adapters/google-token-source.mjs';
import { createSheetProvisioner } from '../../../../src/adapters/sheet-provisioner.mjs';
import { createSheetsCredentialStore, SHEETS_TARGET_FILE, SHEETS_TOKEN_FILE, TARGET_RECORD_VERSION } from '../../../../src/adapters/credential-store.mjs';
import { createSheetsTargetReader, createSheetsTargetWriter } from '../../../../src/adapters/sheets-target.mjs';
import { createGoogleTransport } from '../../../../src/cli/google-transport.mjs';
import { COMPANIES_COLUMNS, JOBS_COLUMNS, SOURCES_COLUMNS } from '../../../../src/core/harvest.mjs';
import { ALLOWED_REQUEST_TYPES, RequestClass } from '../../../../src/core/sheets-requests.mjs';
import { ROW_KEY_METADATA, TAB_OWNERSHIP } from '../../../../src/core/sheets-model.mjs';
import { AuthTargetRefusal, BuildRefusal, DriveRefusal, ImportRefusal, SheetsRefusal, SheetsWarning } from '../../../../src/core/sheets-refusals.mjs';
import { DRIVE_FILE_SCOPE, NATIVE_SHEET_MIME, SHEETS_SENTINEL, SPREADSHEET_ID } from './sheets-constants.mjs';
import { AuthRefusal, GMAIL, GMAIL_READONLY_SCOPE, SHEETS, TOKEN_FILE_VERSION } from '../../../../src/core/oauth.mjs';
import { ENDPOINT_OVERRIDE_ENV, EndpointRefusal } from '../../../../src/core/endpoints.mjs';
import { MAX_ATTEMPTS, RATE_LIMIT_REASONS } from '../../../../src/core/retry-policy.mjs';
import { aClientFile, aTokenFile, SENTINEL, NOW_ISO, NOW_MS, MAILBOX } from '../../gmail-api-source/support/gmail-domain-types.mjs';
import { aSheetRow, KEY_COLUMN, HARVESTER_COLUMNS, HUMAN_COLUMNS, UNKNOWN_COLUMNS } from '../../job-alert-harvester/support/domain-types.mjs';

export {
  aWorkspace,
  writeJson,
  writeText,
  aMessage,
  fileDigests,
  refusalOf,
  PROJECT_ROOT,
  CLI,
} from '../../job-alert-harvester/support/domain-types.mjs';
export { fileModes, readJsonFile, refusalOfAsync, runHarvestAsync, runHarvestWith } from '../../gmail-api-source/support/gmail-domain-types.mjs';
export { aTokenFile, aClientFile, SENTINEL, NOW_ISO, NOW_MS, MAILBOX, TOKEN_FILE_VERSION, GMAIL_READONLY_SCOPE, AuthRefusal, EndpointRefusal, ENDPOINT_OVERRIDE_ENV };
export { SheetsRefusal, SheetsWarning, DriveRefusal, ImportRefusal, BuildRefusal, AuthTargetRefusal, DRIVE_FILE_SCOPE, GMAIL, SHEETS };
export { ALLOWED_REQUEST_TYPES, RequestClass, ROW_KEY_METADATA, TAB_OWNERSHIP, MAX_ATTEMPTS, RATE_LIMIT_REASONS };
export { JOBS_COLUMNS, COMPANIES_COLUMNS, SOURCES_COLUMNS, KEY_COLUMN, HARVESTER_COLUMNS, HUMAN_COLUMNS, UNKNOWN_COLUMNS };
export { SHEETS_TARGET_FILE, SHEETS_TOKEN_FILE, TARGET_RECORD_VERSION };

export { SPREADSHEET_ID, NATIVE_SHEET_MIME, SHEETS_SENTINEL };

/** The Google bases as DESIGN Q8 names them; adapter suites do not depend on the endpoint table's implementation. */
export const GOOGLE_ENDPOINTS = Object.freeze({
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  authUri: 'https://accounts.google.com/o/oauth2/v2/auth',
  gmailBase: 'https://gmail.googleapis.com/gmail/v1',
  sheetsBase: 'https://sheets.googleapis.com/v4',
  driveBase: 'https://www.googleapis.com/drive/v3',
  driveUploadBase: 'https://www.googleapis.com/upload/drive/v3',
});

const SECRET_VALUES = [...Object.values(SENTINEL), ...Object.values(SHEETS_SENTINEL)];
export const noSecretsIn = (text) => SECRET_VALUES.filter((secret) => String(text).includes(secret));

// ------------------------------------------------------------- credential home

export const aSheetsTokenFile = ({ refreshToken = SHEETS_SENTINEL.refreshToken, scope = DRIVE_FILE_SCOPE, obtainedAt = '2026-09-29T08:00:00Z' } = {}) => ({
  version: TOKEN_FILE_VERSION,
  refreshToken,
  scope,
  obtainedAt,
});

export const aTargetRecord = ({ spreadsheetId = SPREADSHEET_ID, importedAt = '2026-09-29T08:30:00Z' } = {}) => ({
  version: TARGET_RECORD_VERSION,
  spreadsheetId,
  importedAt,
});

const writeMode = (path, content, mode) => {
  writeFileSync(path, content, 'utf8');
  chmodSync(path, mode);
};

/**
 * A HOME holding ~/.config/job-alert-harvester as `auth --target sheets` and `import` would leave it, beside the
 * Gmail token. `null` for any file leaves it absent; a string writes it raw; modes are set explicitly, never by umask.
 */
export function aSheetsCredentialHome({
  root,
  client = aClientFile(),
  gmailToken = aTokenFile(),
  sheetsToken = aSheetsTokenFile(),
  target = aTargetRecord(),
  sheetsTokenMode = 0o600,
  targetMode = 0o600,
  clientMode = 0o600,
  directoryMode = 0o700,
} = {}) {
  const home = root ?? join(mkdtempSync(join(tmpdir(), 'sheets-tgt-')), 'home');
  const directory = join(home, '.config', 'job-alert-harvester');
  mkdirSync(directory, { recursive: true });
  chmodSync(directory, 0o700);
  const paths = {
    home,
    directory,
    clientPath: join(directory, 'client.json'),
    tokenPath: join(directory, 'token.json'),
    sheetsTokenPath: join(directory, SHEETS_TOKEN_FILE),
    targetPath: join(directory, SHEETS_TARGET_FILE),
  };
  const asText = (value) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  if (client !== null) writeMode(paths.clientPath, asText(client), clientMode);
  if (gmailToken !== null) writeMode(paths.tokenPath, asText(gmailToken), 0o600);
  if (sheetsToken !== null) writeMode(paths.sheetsTokenPath, asText(sheetsToken), sheetsTokenMode);
  if (target !== null) writeMode(paths.targetPath, asText(target), targetMode);
  chmodSync(directory, directoryMode);
  return paths;
}

// ------------------------------------------------------------ tracker fixtures

/** A full Jobs row as the tracker holds it: every JOBS_COLUMNS name, human columns as the operator left them. */
export const aTrackedJob = (jobId, overrides = {}) => ({
  ...Object.fromEntries(JOBS_COLUMNS.map((column) => [column, null])),
  ...aSheetRow({
    'Dedup Key': `linkedin:${jobId}`,
    'Job': `Agile Coach ${jobId}`,
    'Advert Link': `https://www.linkedin.com/jobs/view/${jobId}/`,
    'Company': `Company ${jobId}`,
  }),
  ...overrides,
});

/** A job as the harvest derives it: harvester-owned cells filled, human columns null. */
export const aHarvestedJob = (jobId, overrides = {}) =>
  aTrackedJob(jobId, { 'Status': null, 'Qualified?': null, 'Applied on Date': null, ...overrides });

export const aCompanyRow = (name, overrides = {}) => ({ 'Company': name, 'Source Type': 'recruiter', 'Jobs Seen': 1, 'First Seen': '2026-07-25T09:48:00Z', 'Last Seen': '2026-07-25T21:48:00Z', ...overrides });

export const aSourceRow = (term, overrides = {}) => ({ 'Source': 'LinkedIn', 'Search Term': term, 'Sender': 'jobalerts-noreply@linkedin.com', 'First Seen': '2026-07-25T09:48:00Z', 'Last Seen': '2026-07-25T21:48:00Z', 'Messages': 2, 'Jobs Found': 3, ...overrides });

/** The tabs of a tracker Sheet (fake config, or workbook content): Jobs always, the others when given. */
export function aTracker({ jobs = [], companies = null, sources = null, jobsHeader = JOBS_COLUMNS, companiesHeader = COMPANIES_COLUMNS, sourcesHeader = SOURCES_COLUMNS } = {}) {
  return {
    Jobs: { header: jobsHeader, rows: jobs },
    ...(companies === null ? {} : { Companies: { header: companiesHeader, rows: companies } }),
    ...(sources === null ? {} : { Sources: { header: sourcesHeader, rows: sources } }),
  };
}

/** A harvest model as core/harvest.mjs produces it, three tabs. */
export const aHarvest = ({ jobs = [], companies = [], sources = [] } = {}) => ({
  sources: { columns: SOURCES_COLUMNS, rows: sources },
  companies: { columns: COMPANIES_COLUMNS, rows: companies },
  jobs: { columns: JOBS_COLUMNS, rows: jobs },
});

/** The bytes of an .xlsx holding `tabs` (the shape aTracker returns). */
export function aWorkbookBytes(tabs) {
  const book = XLSX.utils.book_new();
  for (const [name, { header, rows }] of Object.entries(tabs)) {
    const sheet = XLSX.utils.aoa_to_sheet([header, ...rows.map((row) => (Array.isArray(row) ? row : header.map((column) => row[column] ?? null)))]);
    XLSX.utils.book_append_sheet(book, sheet, name);
  }
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}

export function aWorkbookFile(path, tabs) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, aWorkbookBytes(tabs));
  return path;
}

// ------------------------------------------------------------ observing a Sheet

/** A tab of the snapshot as rows keyed by header; the header row itself is `header`. */
export function tabRows(snapshot, title) {
  const [header = [], ...rows] = snapshot.tabs[title]?.cells ?? [];
  return { header, rows: rows.map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? null]))) };
}

/** `key -> { column: value }` for the named columns of a tab keyed by one column. */
export function columnsByKey(snapshot, title, keyColumn, columns) {
  const { rows } = tabRows(snapshot, title);
  return Object.fromEntries(rows.filter((row) => row[keyColumn] !== null).map((row) => [row[keyColumn], Object.fromEntries(columns.map((column) => [column, row[column] ?? null]))]));
}

export const keysOf = (snapshot, title, keyColumn) => tabRows(snapshot, title).rows.map((row) => row[keyColumn]).filter((key) => key !== null);

/** What the operator's own judgement looks like: human-owned and unknown columns of Jobs, by key. */
export const judgementOf = (snapshot) => columnsByKey(snapshot, 'Jobs', KEY_COLUMN, [...HUMAN_COLUMNS, ...UNKNOWN_COLUMNS]);

/** The observable universe of a whole tracker Sheet, for state-delta assertions. */
export function observeSheet(fake) {
  const snapshot = fake.snapshot();
  return {
    'sheet.tabNames': snapshot.tabOrder,
    'sheet.cells': Object.fromEntries(Object.entries(snapshot.tabs).map(([title, tab]) => [title, tab.cells])),
    'sheet.rowKeyMetadata': Object.fromEntries(Object.entries(snapshot.tabs).map(([title, tab]) => [title, tab.metadata])),
    'sheet.grid': Object.fromEntries(Object.entries(snapshot.tabs).map(([title, tab]) => [title, tab.grid])),
    'drive.files': fake.files(),
  };
}
export const SHEET_UNIVERSE = ['sheet.tabNames', 'sheet.cells', 'sheet.rowKeyMetadata', 'sheet.grid', 'drive.files'];

// ------------------------------------------------------------- composition

/** The Sheets adapters wired as the composition root wires them, over a fake at the HTTP boundary. */
export function aSheetsTarget({ fake, home = aSheetsCredentialHome(), spreadsheetId, jitter = () => 0.5, maxBatchBytes, endpoints = GOOGLE_ENDPOINTS }) {
  const sleeps = [];
  const sleep = async (milliseconds) => {
    sleeps.push(milliseconds);
  };
  const fetch = (url, init) => fake.handle(url, init);
  const store = createSheetsCredentialStore({ directory: home.directory });
  const tokenSource = createGoogleTokenSource({ store: store.sheetsSlot(), fetch, endpoints, nowMs: () => NOW_MS, sleep, jitter, profile: SHEETS });
  const transport = createGoogleTransport({ tokenSource, fetch, sleep, jitter, namespace: 'sheets' });
  const shared = { store, tokenSource, endpoints, sleep, jitter, ...(spreadsheetId ? { spreadsheetId } : {}) };
  const reader = createSheetsTargetReader({ ...shared, transport: { read: transport.read } });
  const writer = createSheetsTargetWriter({ ...shared, transport, ...(maxBatchBytes ? { maxBatchBytes } : {}) });
  return { reader, writer, store, tokenSource, transport, sleeps, home, fake, endpoints };
}

/** A transport over an in-memory credential slot: no filesystem, so transport suites stand apart from the credential store. */
export function aTransport({ fake, namespace = 'sheets', jitter = () => 0.5, endpoints = GOOGLE_ENDPOINTS }) {
  const sleeps = [];
  const sleep = async (milliseconds) => {
    sleeps.push(milliseconds);
  };
  const fetch = (url, init) => fake.handle(url, init);
  const store = {
    readClient: () => ({ clientId: aClientFile().installed.client_id, clientSecret: SENTINEL.clientSecret }),
    readToken: () => ({ refreshToken: SHEETS_SENTINEL.refreshToken, scope: DRIVE_FILE_SCOPE, obtainedAt: NOW_ISO }),
    writeToken: () => {},
    probe: () => {},
  };
  const tokenSource = createGoogleTokenSource({ store, fetch, endpoints, nowMs: () => NOW_MS, sleep, jitter, profile: SHEETS });
  const transport = createGoogleTransport({ tokenSource, fetch, sleep, jitter, namespace });
  return { transport, tokenSource, sleeps };
}

/** The Drive provisioner wired over the same fake. */
export function aProvisioner({ fake, home = aSheetsCredentialHome({ target: null }), jitter = () => 0.5, endpoints = GOOGLE_ENDPOINTS }) {
  const sleeps = [];
  const sleep = async (milliseconds) => {
    sleeps.push(milliseconds);
  };
  const fetch = (url, init) => fake.handle(url, init);
  const store = createSheetsCredentialStore({ directory: home.directory });
  const tokenSource = createGoogleTokenSource({ store: store.sheetsSlot(), fetch, endpoints, nowMs: () => NOW_MS, sleep, jitter, profile: SHEETS });
  const transport = createGoogleTransport({ tokenSource, fetch, sleep, jitter, namespace: 'drive' });
  const provisioner = createSheetProvisioner({ transport: { write: transport.write }, tokenSource, endpoints });
  return { provisioner, store, tokenSource, transport, sleeps, home, fake, endpoints };
}

// ------------------------------------------------------------------- running

export const environment = (home, baseUrl) => ({ HOME: home.home, [ENDPOINT_OVERRIDE_ENV]: baseUrl });

export const readText = (path) => readFileSync(path, 'utf8');

/** The cache record for one alert, written where the harvest reads it. */
export function cacheAlert(workspace, record) {
  const month = record.date.slice(0, 7);
  const path = join(workspace, '.cache/messages', month, `${record.id}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(record, null, 2), 'utf8');
  return path;
}

/** Every cell a plan may write, keyed by tab then encoded key: the oracle for what a request builder may touch. */
export const ownedNonKeyColumns = (tab) => TAB_OWNERSHIP[tab].harvesterColumns.filter((column) => !TAB_OWNERSHIP[tab].keyColumns.includes(column));

// ------------------------------------------------------- Sheets response bodies

/** A spreadsheets.get body in the shape the fake serves (composed from memory until captured: ledger L19). */
export const aSpreadsheetBody = ({ id = SPREADSHEET_ID, tabs = [{ sheetId: 1, title: 'Jobs' }] } = {}) => ({
  spreadsheetId: id,
  properties: { title: 'Job tracker' },
  sheets: tabs.map((tab, index) => ({
    properties: { sheetId: tab.sheetId, title: tab.title, index, sheetType: 'GRID', gridProperties: { rowCount: tab.rowCount ?? 1000, columnCount: tab.columnCount ?? 26 } },
  })),
  spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`,
});

/** A values.batchGet body: one valueRange per tab, `values` omitted when the range is empty. */
export const aValueRangesBody = (grids, { id = SPREADSHEET_ID } = {}) => ({
  spreadsheetId: id,
  valueRanges: Object.entries(grids).map(([title, values]) => ({ range: `${title}!A1:Z1000`, majorDimension: 'ROWS', ...(values.length > 0 ? { values } : {}) })),
});

/** A developerMetadata.search body for row-key metadata. */
export const aMetadataBody = (entries) =>
  entries.length === 0
    ? {}
    : {
        matchedDeveloperMetadata: entries.map(({ metadataId, key, value, sheetId, rowIndex }) => ({
          developerMetadata: {
            metadataId,
            metadataKey: ROW_KEY_METADATA,
            metadataValue: key ?? value,
            location: { locationType: 'ROW', dimensionRange: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 } },
            visibility: 'DOCUMENT',
          },
        })),
      };

// ------------------------------------------------------------- shared arrangements

import { createSheetsFake } from './sheets-fake.mjs';

export const JOBS_WITH_NOTES = Object.freeze([...JOBS_COLUMNS, 'My Notes']);

/** The operator's tracker as it stands in Drive: three tabs, human judgement typed in, a column the harvester does not know. */
export function aTrackerFake({ jobs, companies = [aCompanyRow('Acme Ltd')], sources = [aSourceRow('agile coach')], jobsHeader = JOBS_WITH_NOTES, companiesHeader = COMPANIES_COLUMNS, sourcesHeader = SOURCES_COLUMNS, ...options } = {}) {
  const seeded = jobs ?? [aTrackedJob('1', { Status: 'Applied', 'My Notes': 'call back', Job: 'Old title' }), aTrackedJob('2', { Status: 'Interview', 'My Notes': 'second round' })];
  return createSheetsFake({ tabs: aTracker({ jobs: seeded, companies, sources, jobsHeader, companiesHeader, sourcesHeader }), ...options });
}


/** Reads, plans with the real merge planner, and applies: what `build --target sheets` does after its probe. */
export async function mergeHarvest(wired, harvest, planMergeAll) {
  const state = await wired.writer.read();
  return wired.writer.apply(planMergeAll(state, harvest));
}

// ------------------------------------------------------ what the operator sees of the tracker

/** Port-exposed observables of the recorded Sheet: cells by key, headers, tabs, row-key bindings, Drive files. */
export function observeTracker(fake) {
  const snapshot = fake.snapshot();
  const tab = (title) => (snapshot.tabs[title] ? tabRows(snapshot, title) : null);
  return {
    'jobs.header': tab('Jobs')?.header ?? null,
    'jobs.keys': keysOf(snapshot, 'Jobs', KEY_COLUMN),
    'jobs.judgement': judgementOf(snapshot),
    'jobs.harvesterCells': columnsByKey(snapshot, 'Jobs', KEY_COLUMN, HARVESTER_COLUMNS),
    'companies.rows': tab('Companies')?.rows ?? null,
    'sources.rows': tab('Sources')?.rows ?? null,
    'sheet.tabNames': snapshot.tabOrder,
    'sheet.rowKeyBindings': Object.fromEntries(Object.entries(snapshot.tabs).map(([title, entry]) => [title, entry.metadata.map((meta) => meta.value)])),
    'drive.files': fake.files(),
  };
}
export const TRACKER_UNIVERSE = ['jobs.header', 'jobs.keys', 'jobs.judgement', 'jobs.harvesterCells', 'companies.rows', 'sources.rows', 'sheet.tabNames', 'sheet.rowKeyBindings', 'drive.files'];

const isMetadataOnly = (request) => request.requestTypes.length > 0 && request.requestTypes.every((type) => type === 'createDeveloperMetadata');
export const dataBatches = (fake) => fake.requestsTo('batch-update').filter((request) => !isMetadataOnly(request));
export const metadataBatches = (fake) => fake.requestsTo('batch-update').filter(isMetadataOnly);

/** The harvester-owned cells of a job, as a harvest row would carry them. */
export const harvesterCellsOf = (row) => Object.fromEntries(HARVESTER_COLUMNS.map((column) => [column, row[column] ?? null]));
