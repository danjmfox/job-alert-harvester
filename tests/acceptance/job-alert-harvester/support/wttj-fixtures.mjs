// Domain vocabulary for the Welcome to the Jungle source's acceptance tests (release R1: slices 01a, 01b and 05).
//
// The synthetic alerts live in fixtures/wttj/ and are the only place markup appears. Tests name alerts by what
// they advertise (WelcomeAlert), read the Jobs tab through the rebuild form, and never mention the markup.
// Wording of the two stderr lines is the contract DISTILL pins for the rebuild form (feature-delta, DISTILL R1).

import { copyFileSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { PROJECT_ROOT, aWorkspace, runHarvest } from './domain-types.mjs';

export const WELCOME_FIXTURES_DIR = join(PROJECT_ROOT, 'fixtures/wttj');
export const LINKEDIN_FIXTURES_DIR = join(PROJECT_ROOT, 'fixtures/linkedin');
export const LINKEDIN_VARIANT_FIXTURES_DIR = join(PROJECT_ROOT, 'fixtures/linkedin-variants');

export const WELCOME_SENDER = 'help@welcometothejungle.com';
export const WELCOME_LABEL = 'Welcome to the Jungle';
export const LINKEDIN_LABEL = 'LinkedIn';
export const UK_REMOTE = 'Remote (within the UK)';

/** The synthetic alerts, by what each one advertises. Values are the file names under fixtures/wttj/ (no extension). */
export const WelcomeAlert = Object.freeze({
  THREE_CARDS: 'three-cards',
  RESEND_WITH_NEW_CARD: 'resend-two-cards',
  ONE_CARD: 'one-card',
  CARD_WITHOUT_TITLE: 'card-without-title',
  TITLE_WITH_AMPERSAND: 'entity-title',
  TITLE_WITH_NUMBER: 'title-with-number',
  NO_SALARY: 'salary-absent',
  SALARY_ABOVE_MINIMUM: 'salary-above-minimum',
  SALARY_DOLLAR_RANGE: 'salary-dollar-range',
  SALARY_STERLING_RANGE: 'salary-sterling-range',
  SALARY_STERLING_SINGLE: 'salary-sterling-single',
  SALARY_STERLING_SINGLE_LATER: 'salary-sterling-single-later',
  SALARY_EURO_RANGE: 'salary-euro-range',
});

/** What the three-card alert advertises, in card order. Taglines are listed so a test can prove none leaks into a row. */
export const THREE_CARD_ADVERTS = Object.freeze([
  Object.freeze({ company: 'Northwind Analytics', tagline: 'Open-source dashboards for product teams', job: 'Technical Product Lead', location: UK_REMOTE, advertLink: 'https://example.invalid/ls/click?upn=u001.three-1' }),
  Object.freeze({ company: 'Fabrikam Security', tagline: 'Threat detection for small teams', job: 'Engineering Manager (AI Platform)', location: UK_REMOTE, advertLink: 'https://example.invalid/ls/click?upn=u001.three-2' }),
  Object.freeze({ company: 'Contoso Data', tagline: 'Observability without the noise', job: 'Product Manager (Monitoring)', location: UK_REMOTE, advertLink: 'https://example.invalid/ls/click?upn=u001.three-3' }),
]);

/** Every cell of every tab of the LinkedIn fixtures' workbooks, captured before the build was routed through the registry. */
export const LINKEDIN_BASELINE = JSON.parse(readFileSync(new URL('./linkedin-baseline.json', import.meta.url), 'utf8'));

/** A grid (header row first) as an array of rows keyed by column name. */
export const rowsOfGrid = ([header, ...rows]) => rows.map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? null])));

export const welcomeAlertRecord = (alert) => JSON.parse(readFileSync(join(WELCOME_FIXTURES_DIR, `${alert}.json`), 'utf8'));

/** Every message record in a fixture folder, in file-name order. */
export const messagesIn = (directory) =>
  readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(directory, name), 'utf8')));

/** A message from a sender no source claims, with a body that is not a job digest. */
export function anUnclaimedMessage({ id = '0ddba11000000001', sender = 'newsletter@example.invalid', date = '2026-07-26T08:00:00Z' } = {}) {
  return {
    id,
    date,
    sender,
    subject: 'Three tips for tidy spreadsheets',
    snippet: 'Three tips for tidy spreadsheets',
    plaintextBody: 'This week: three tips for tidy spreadsheets.\nRead more on the example site.\n',
  };
}

/** The line the rebuild prints on stderr for a message no source claims. */
export const unclaimedLine = ({ id, sender }) => `unclaimed message ${id} from ${sender}`;

/** The pattern of the line the rebuild prints on stderr for a message a source claimed but could not read. */
export const unparsedLinePattern = ({ id, sender }) => new RegExp(`^unparsed message ${id} from ${sender.replace(/\./g, '\\.')}: \\S.*$`);

/** The stderr lines that mention `word`, in order. */
export const linesMentioning = (stderr, word) => stderr.split('\n').filter((line) => line.includes(word));

// ------------------------------------------------------------------ folders

const madeFolders = [];

/** Removes every folder this module made. Call from afterEach. */
export function cleanUpFolders() {
  while (madeFolders.length > 0) rmSync(madeFolders.pop(), { recursive: true, force: true });
}

/**
 * A fresh message folder holding every fixture of `folders`, the named Welcome to the Jungle `alerts`
 * (from fixtures/wttj/), and any extra message `records`. Files are named by message id, as the cache names them.
 */
export function aFolderHolding({ folders = [], alerts = [], records = [] } = {}) {
  const folder = aWorkspace();
  madeFolders.push(folder);
  for (const source of folders) {
    for (const name of readdirSync(source).filter((entry) => entry.endsWith('.json'))) copyFileSync(join(source, name), join(folder, name));
  }
  for (const alert of alerts) {
    const record = welcomeAlertRecord(alert);
    writeFileSync(join(folder, `${record.id}.json`), JSON.stringify(record), 'utf8');
  }
  for (const record of records) writeFileSync(join(folder, `${record.id}.json`), JSON.stringify(record), 'utf8');
  return folder;
}

// ---------------------------------------------------------------- rebuilding

const TAB_NAMES = Object.freeze(['Jobs', 'Companies', 'Sources']);

/** Every sheet of a workbook as a grid (header row first); blank cells read as null. */
export function workbookGrids(path) {
  const book = XLSX.readFile(path);
  return {
    sheetNames: book.SheetNames,
    grids: Object.fromEntries(book.SheetNames.map((name) => [name, XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: null, blankrows: false })])),
  };
}

/** Each tab of a workbook as an array of rows keyed by column name; blank cells read as null. */
export function tabsOf(path) {
  const book = XLSX.readFile(path);
  return Object.fromEntries(TAB_NAMES.map((name) => [name, XLSX.utils.sheet_to_json(book.Sheets[name], { defval: null })]));
}

/**
 * Runs the real rebuild form (`harvest --in <folder> --out <file>`) and reads the workbook it wrote.
 * `tabs` and `grids` are null when no workbook was written.
 */
export function rebuild(folder) {
  const workspace = aWorkspace();
  madeFolders.push(workspace);
  const out = join(workspace, 'out', 'job-alerts.xlsx');
  mkdirSync(join(workspace, 'out'), { recursive: true });
  const result = runHarvest(['--in', folder, '--out', out]);
  const wrote = result.status === 0;
  return { ...result, tabs: wrote ? tabsOf(out) : null, grids: wrote ? workbookGrids(out) : null };
}

/**
 * Runs the real `harvest build --out <new workbook>` over a cache holding the given messages (the same arguments as
 * `aFolderHolding`), in an isolated workspace, and reads the workbook it wrote. `tabs` is null when none was written.
 */
export function buildFromCache(contents) {
  const workspace = aWorkspace();
  madeFolders.push(workspace);
  cpSync(aFolderHolding(contents), join(workspace, '.cache', 'messages', '2026-07'), { recursive: true });
  const target = join(workspace, 'tracker.xlsx');
  const result = runHarvest(['build', '--out', target], { cwd: workspace });
  return { ...result, tabs: result.status === 0 ? tabsOf(target) : null };
}
