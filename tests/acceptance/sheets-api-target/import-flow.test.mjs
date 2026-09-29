// @contract-shape:bounded-change
// DR-0012 / DESIGN Q6: `harvest import --from <file.xlsx>` creates the tracker Sheet once, verifies the conversion,
// records the id, then binds row-key metadata. It never updates an existing Sheet and deletes only the file it created
// itself. Orchestration level: the real workbook reader, provisioner and Sheets adapters over the fake, real files.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTargetSheet } from '../../../src/adapters/xlsx-target-sheet.mjs';
import { runImport } from '../../../src/cli/import.mjs';
import {
  COMPANIES_COLUMNS,
  DriveRefusal,
  ImportRefusal,
  JOBS_COLUMNS,
  NOW_ISO,
  SOURCES_COLUMNS,
  TARGET_RECORD_VERSION,
  aCompanyRow,
  aProvisioner,
  aSheetsCredentialHome,
  aSheetsTarget,
  aSourceRow,
  aTargetRecord,
  aTrackedJob,
  aTracker,
  aWorkbookFile,
  aWorkspace,
  fileDigests,
  noSecretsIn,
  readJsonFile,
  refusalOfAsync,
  tabRows,
  writeText,
} from './support/sheets-domain-types.mjs';
import { createSheetsFake, forbiddenFor, rateLimited } from './support/sheets-fake.mjs';
import { assertStateDelta, grownBy, unchanged } from '../../common/state-delta.mjs';
import { scenario } from './support/red-gate.mjs';

const JOBS_WITH_NOTES = [...JOBS_COLUMNS, 'My Notes'];
const anOperatorWorkbook = () =>
  aTracker({
    jobs: [aTrackedJob('1', { Status: 'Applied', 'My Notes': 'call back' }), aTrackedJob('2', { Status: 'Interview', 'My Notes': 'second round' })],
    companies: [aCompanyRow('Acme Ltd'), aCompanyRow('Beta Ltd')],
    sources: [aSourceRow('agile coach'), aSourceRow('scrum master')],
    jobsHeader: JOBS_WITH_NOTES,
  });

function anImportOver({ fake, tabs = anOperatorWorkbook(), home = aSheetsCredentialHome({ target: null }), from, storeOverride } = {}) {
  const path = from ?? aWorkbookFile(join(aWorkspace(), 'tracker.xlsx'), tabs);
  const provisioned = aProvisioner({ fake, home });
  const lines = [];
  const collaborators = {
    from: path,
    store: storeOverride ? storeOverride(provisioned.store) : provisioned.store,
    workbook: createTargetSheet(path),
    provisioner: provisioned.provisioner,
    sheets: (spreadsheetId) => {
      const wired = aSheetsTarget({ fake, home, spreadsheetId });
      return { reader: wired.reader, writer: wired.writer };
    },
    print: (line) => lines.push(line),
    now: () => NOW_ISO,
  };
  return { collaborators, lines, home, path, run: () => runImport(collaborators) };
}
const observe = (fake, home) => ({
  'drive.files': fake.files(),
  'target.record': existsSync(home.targetPath) ? readFileSync(home.targetPath, 'utf8') : null,
});
const UNIVERSE = ['drive.files', 'target.record'];
const unchangedAll = { 'drive.files': unchanged(), 'target.record': unchanged() };

describe('import creates the tracker Sheet from the operator workbook', () => {
  scenario('@real-io @adapter-integration creates one Sheet, verifies it, records its id and binds every keyed row', async () => {
    // Given the operator has a workbook with three tabs, an unknown column and their own Status entries
    const fake = createSheetsFake();
    const flow = anImportOver({ fake });
    const before = observe(fake, flow.home);

    // When the operator imports it
    const { spreadsheetId } = await flow.run();

    // Then exactly one native Sheet exists, its id is recorded beside the credentials, and every keyed row is bound
    assertStateDelta(before, observe(fake, flow.home), {
      universe: UNIVERSE,
      expected: { 'drive.files': grownBy(1), 'target.record': (() => ({ description: 'the target record', holds: (_b, after) => JSON.parse(after).spreadsheetId === spreadsheetId }))() },
    });
    expect(readJsonFile(flow.home.targetPath)).toEqual({ version: TARGET_RECORD_VERSION, spreadsheetId, importedAt: NOW_ISO });
    const snapshot = fake.snapshot(spreadsheetId);
    expect(snapshot.tabOrder).toEqual(['Jobs', 'Companies', 'Sources']);
    expect(tabRows(snapshot, 'Jobs').rows.map((row) => [row['Dedup Key'], row.Status, row['My Notes']])).toEqual([['linkedin:1', 'Applied', 'call back'], ['linkedin:2', 'Interview', 'second round']]);
    expect(Object.fromEntries(Object.entries(snapshot.tabs).map(([title, tab]) => [title, tab.metadata.map((meta) => meta.value)]))).toEqual({
      Jobs: ['linkedin:1', 'linkedin:2'],
      Companies: ['Acme Ltd', 'Beta Ltd'],
      Sources: ['["LinkedIn","agile coach"]', '["LinkedIn","scrum master"]'],
    });
    const [first, ...rest] = fake.writeRequests().map((request) => request.route);
    expect([first, rest.every((route) => route === 'batch-update')]).toEqual(['drive-create', true]);
    expect(noSecretsIn(flow.lines.join('\n'))).toEqual([]);
  });

  scenario('preserves an unknown extra tab and an unknown column: import adds nothing and removes nothing', async () => {
    const fake = createSheetsFake();
    const tabs = { ...anOperatorWorkbook(), Notes: { header: ['Thoughts'], rows: [['keep me']] } };
    const flow = anImportOver({ fake, tabs });

    const { spreadsheetId } = await flow.run();

    const snapshot = fake.snapshot(spreadsheetId);
    expect(snapshot.tabOrder).toContain('Notes');
    expect(snapshot.tabs.Notes.cells).toEqual([['Thoughts'], ['keep me']]);
    expect(snapshot.tabs.Notes.metadata).toEqual([]);
  });

  scenario('@error a workbook that has a Jobs header only is imported: the operator may start from an empty tracker', async () => {
    const fake = createSheetsFake();
    const flow = anImportOver({ fake, tabs: aTracker({ jobs: [] }) });

    const { spreadsheetId } = await flow.run();

    expect(tabRows(fake.snapshot(spreadsheetId), 'Jobs').rows).toEqual([]);
  });

  scenario('@error a second import refuses import.already-imported before any request, and creates no second Sheet', async () => {
    const fake = createSheetsFake();
    const first = anImportOver({ fake });
    await first.run();
    const second = anImportOver({ fake, home: first.home });
    const before = observe(fake, first.home);
    const requestsBefore = fake.requests.length;

    const refusal = await refusalOfAsync(() => second.run());

    expect(refusal?.code).toBe(ImportRefusal.ALREADY_IMPORTED);
    assertStateDelta(before, observe(fake, first.home), { universe: UNIVERSE, expected: unchangedAll });
    expect(fake.requests).toHaveLength(requestsBefore);
    expect(fake.driveCreates()).toHaveLength(1);
  });

  scenario('@error an existing target record is never overwritten, whatever it holds', async () => {
    const fake = createSheetsFake();
    const home = aSheetsCredentialHome({ target: aTargetRecord({ spreadsheetId: 'the-operators-existing-sheet' }) });
    const flow = anImportOver({ fake, home });
    const before = fileDigests(home.directory);

    const refusal = await refusalOfAsync(() => flow.run());

    expect(refusal?.code).toBe(ImportRefusal.ALREADY_IMPORTED);
    expect(fileDigests(home.directory)).toEqual(before);
    expect(fake.requests).toEqual([]);
  });
});

describe('import refuses before it creates anything when the workbook cannot be trusted', () => {
  scenario('@error refuses import.file-missing when --from names no file', async () => {
    const fake = createSheetsFake();
    const flow = anImportOver({ fake, from: join(aWorkspace(), 'absent.xlsx') });

    expect((await refusalOfAsync(() => flow.run()))?.code).toBe(ImportRefusal.FILE_MISSING);
    expect(fake.requests).toEqual([]);
  });

  scenario('@error refuses import.not-a-workbook when --from is not an .xlsx, even one SheetJS would parse', async () => {
    const fake = createSheetsFake();
    const path = writeText(join(aWorkspace(), 'notes.xlsx'), 'Dedup Key,Job\nlinkedin:1,Coach\n');
    const flow = anImportOver({ fake, from: path });

    expect((await refusalOfAsync(() => flow.run()))?.code).toBe(ImportRefusal.NOT_A_WORKBOOK);
    expect(fake.requests).toEqual([]);
  });

  const UNTRUSTED = [
    ['the Jobs tab is absent', ImportRefusal.NO_DEDUP_KEY_COLUMN, () => { const { Jobs: _jobs, ...rest } = aTracker({ jobs: [], companies: [] }); return rest; }],
    ['the Jobs tab has no Dedup Key column', ImportRefusal.NO_DEDUP_KEY_COLUMN, () => aTracker({ jobs: [], jobsHeader: JOBS_COLUMNS.filter((column) => column !== 'Dedup Key') })],
    ['the Companies tab has no Company column', ImportRefusal.KEY_COLUMN_MISSING, () => aTracker({ jobs: [], companies: [], companiesHeader: COMPANIES_COLUMNS.filter((column) => column !== 'Company') })],
    ['the Sources tab has no Search Term column', ImportRefusal.KEY_COLUMN_MISSING, () => aTracker({ jobs: [], sources: [], sourcesHeader: SOURCES_COLUMNS.filter((column) => column !== 'Search Term') })],
    ['the Jobs tab shares no header with the harvester', ImportRefusal.UNRECOGNISED_HEADERS, () => ({ Jobs: { header: ['Dedup Key', 'Foo', 'Bar'], rows: [['k1', 1, 2]] } })],
    ['two Jobs rows share a Dedup Key', ImportRefusal.DUPLICATE_KEY, () => aTracker({ jobs: [aTrackedJob('1'), aTrackedJob('1')] })],
  ];
  for (const [title, code, tabs] of UNTRUSTED) {
    scenario(`@error refuses ${code} when ${title}, creating nothing and recording nothing`, async () => {
      const fake = createSheetsFake();
      const flow = anImportOver({ fake, tabs: tabs() });
      const before = observe(fake, flow.home);

      const refusal = await refusalOfAsync(() => flow.run());

      expect(refusal?.code).toBe(code);
      assertStateDelta(before, observe(fake, flow.home), { universe: UNIVERSE, expected: unchangedAll });
      expect(fake.writeRequests()).toEqual([]);
    });
  }
});

describe('import verifies the converted Sheet, and cleans up only what it created', () => {
  const LOSSES = [
    ['a data row is lost', 'drops-last-data-row'],
    ['a header is renamed', 'renames-first-header'],
    ['a tab is lost', 'drops-tab'],
  ];
  for (const [title, conversion] of LOSSES) {
    scenario(`@error refuses import.conversion-mismatch when ${title}, deletes the created file and records nothing`, async () => {
      const fake = createSheetsFake({ conversion });
      const flow = anImportOver({ fake });
      const before = observe(fake, flow.home);

      const refusal = await refusalOfAsync(() => flow.run());

      expect(refusal?.code).toBe(ImportRefusal.CONVERSION_MISMATCH);
      assertStateDelta(before, observe(fake, flow.home), { universe: UNIVERSE, expected: unchangedAll });
      expect(fake.driveCreates()).toHaveLength(1);
      expect(fake.requestsTo('drive-delete')).toHaveLength(1);
      expect(fake.writeRequests().map((request) => request.route)).toEqual(['drive-create', 'drive-delete']);
    });
  }

  scenario('@error a record that cannot be written refuses import.record-failed and deletes the file it created', async () => {
    const fake = createSheetsFake();
    const flow = anImportOver({ fake, storeOverride: (store) => ({ ...store, writeTarget: () => { throw new Error('disk full'); } }) });
    const before = observe(fake, flow.home);

    const refusal = await refusalOfAsync(() => flow.run());

    expect(refusal?.code).toBe(ImportRefusal.RECORD_FAILED);
    assertStateDelta(before, observe(fake, flow.home), { universe: UNIVERSE, expected: unchangedAll });
  });

  scenario('@error when that cleanup also fails the refusal prints the file id, which is not a secret, for manual removal', async () => {
    const fake = createSheetsFake();
    fake.override('drive-delete', () => forbiddenFor('forbidden'));
    const flow = anImportOver({ fake, storeOverride: (store) => ({ ...store, writeTarget: () => { throw new Error('disk full'); } }) });

    const refusal = await refusalOfAsync(() => flow.run());

    expect(refusal?.code).toBe(ImportRefusal.RECORD_FAILED);
    expect(refusal.message).toContain(fake.files()[0].id);
    expect(noSecretsIn(refusal.message)).toEqual([]);
  });

  scenario('@error deletes only the id it created: the operator other files are never named in a delete', async () => {
    const fake = createSheetsFake({ tabs: { Jobs: { header: ['Dedup Key'], rows: [] } }, conversion: 'drops-last-data-row' });
    const flow = anImportOver({ fake });

    await refusalOfAsync(() => flow.run());

    const created = fake.requestsTo('drive-create');
    expect(created).toHaveLength(1);
    expect(fake.requestsTo('drive-delete').map((request) => request.id)).not.toContain(fake.spreadsheetId);
    expect(fake.files().map((file) => file.id)).toEqual([fake.spreadsheetId]);
  });

  const DRIVE_FAILURES = [
    ['Drive throttles the upload', () => rateLimited({ retryAfter: 1 }), DriveRefusal.QUOTA_EXHAUSTED],
    ['the operator Drive is full', () => forbiddenFor('storageQuotaExceeded'), DriveRefusal.STORAGE_FULL],
  ];
  for (const [title, answer, code] of DRIVE_FAILURES) {
    scenario(`@error passes ${code} through when ${title}, and records nothing`, async () => {
      const fake = createSheetsFake();
      fake.override('drive-create', answer);
      const flow = anImportOver({ fake });
      const before = observe(fake, flow.home);

      const refusal = await refusalOfAsync(() => flow.run());

      expect(refusal?.code).toBe(code);
      assertStateDelta(before, observe(fake, flow.home), { universe: UNIVERSE, expected: unchangedAll });
    });
  }
});

describe('binding row keys is the last, non-fatal step', () => {
  scenario('@error a binding that fails leaves the import complete and the record in place, for build to heal', async () => {
    const fake = createSheetsFake();
    fake.override('batch-update', () => forbiddenFor('forbidden'), { when: (request) => request.requestTypes.every((type) => type === 'createDeveloperMetadata') });
    const flow = anImportOver({ fake });

    const { spreadsheetId } = await flow.run();

    expect(readJsonFile(flow.home.targetPath).spreadsheetId).toBe(spreadsheetId);
    expect(fake.snapshot(spreadsheetId).tabs.Jobs.metadata).toEqual([]);
    expect(fake.files()).toHaveLength(1);
  });
});
