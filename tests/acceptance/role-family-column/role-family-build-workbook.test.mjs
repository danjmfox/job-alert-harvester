// @contract-shape:bounded-change
// `harvest build` against an .xlsx tracker, as an operator runs it: a real subprocess through the production
// composition root, a real cache and a real workbook in an isolated workspace with an empty HOME-free run (the offline
// target needs no credential). Role Family is a harvester-owned derived column (DR-0014): a new workbook carries it
// after Fit Reason, an existing tracker gains it at the far right (DR-0004 rule 3), the first population is not itemised
// as corrections, a later re-classification is, and the operator's own cells never move. Subprocess layer: example-only,
// sad paths enumerated (Mandate 11); the pure properties live in role-family-properties.test.mjs.
import { afterAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { assertStateDelta, appendedWith, setTo, unchanged } from '../../common/state-delta.mjs';
import { GOLDEN_TITLES, TITLE_VARIANTS } from './support/golden-titles.mjs';
import {
  CLOSED_FAMILY_SET,
  FamilyName,
  JOBS_COLUMNS,
  LEGACY_JOBS_HEADER,
  ROLE_FAMILY_COLUMN,
  STANDARD_COHORT,
  TUNING_LIMIT,
  WORKBOOK_UNIVERSE,
  aCacheOfAdverts,
  aCohortCached,
  aScratchWorkspace,
  aTrackerWorkbook,
  anAdvert,
  anAlertSighting,
  familiesInWorkbook,
  familyCountsLineOf,
  fileDigests,
  forgetTheGoldenBuild,
  observeWorkbook,
  operatorBuildsNewWorkbook,
  operatorMerges,
  operatorPreviews,
  operatorRebuildsFromTheCache,
  reportTextOf,
  roleFamilyCorrectionsIn,
  rowsOfFamily,
  theAdvertsOf,
  theFamiliesExpectedOf,
  theGoldenBuild,
  theHarvestOf,
  theOperatorsContacts,
  tuningViewOf,
  useWorkspaceCleanup,
  workbookCellsOutside,
} from './support/role-family-domain-types.mjs';
import { scenario } from './support/red-gate.mjs';

useWorkspaceCleanup();
afterAll(forgetTheGoldenBuild);

const LEGACY_WITH_NOTES = Object.freeze([...LEGACY_JOBS_HEADER, 'My Notes']);
const [SCRUM, PRODUCT_OWNER, DATA_ANALYST, PROGRAMME] = STANDARD_COHORT;

/** A tracker on disk holding the cohort as the harvester last wrote it, the operator's judgement typed in, and a Contacts tab. */
function anExistingTracker(workspace, cohort, { header = LEGACY_WITH_NOTES, held, extraRows = [] } = {}) {
  const { cached, expected, rows } = aCohortCached(workspace, cohort, { held });
  const tracker = join(workspace, 'tracker.xlsx');
  aTrackerWorkbook(tracker, { header, rows: [...rows, ...extraRows], contacts: theOperatorsContacts() });
  return { tracker, cached, expected };
}
const WITH_THE_COLUMN = Object.freeze([...LEGACY_WITH_NOTES, ROLE_FAMILY_COLUMN]);
const upToDate = (expected) => expected;
const repeated = (title, family, times) => Array.from({ length: times }, () => ({ title, family }));

describe('@driving_adapter build creates a new workbook that carries Role Family', () => {
  for (const family of CLOSED_FAMILY_SET) {
    const edge = family === FamilyName.OTHER ? '@error ' : '';
    it(`@golden @real-io ${edge}every golden ${family} title carries ${family} in the Role Family column`, async () => {
      // Given a cache holding an advert for every golden title
      // When the operator builds a new workbook
      const run = await theGoldenBuild(GOLDEN_TITLES);
      // Then each advert of this family carries this family
      expect(run.result.status, run.result.stderr).toBe(0);
      const rows = rowsOfFamily(run, GOLDEN_TITLES, family);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.map((row) => run.observed['jobs.roleFamilyByKey'][row.key])).toEqual(rows.map(() => family));
    });
  }

  it('@golden @contested the nine contested cases and the double-qualifier titles land where the human ratified', async () => {
    const run = await theGoldenBuild(GOLDEN_TITLES);
    expect(run.result.status, run.result.stderr).toBe(0);
    const contested = run.cached.map((advert, index) => ({ ...advert, golden: GOLDEN_TITLES[index] })).filter(({ golden }) => ['contested', 'multi'].includes(golden.kind));
    expect(contested).toHaveLength(9 + 4);
    expect(Object.fromEntries(contested.map(({ title, key }) => [title, run.observed['jobs.roleFamilyByKey'][key]]))).toEqual(Object.fromEntries(contested.map(({ title, golden }) => [title, golden.family])));
  });

  it('@golden the header carries Role Family immediately after Fit Reason, and every row has its family', async () => {
    const run = await theGoldenBuild(GOLDEN_TITLES);
    expect(run.result.status, run.result.stderr).toBe(0);
    expect(run.observed['jobs.header']).toEqual(JOBS_COLUMNS);
    expect(run.observed['jobs.header'][run.observed['jobs.header'].indexOf('Fit Reason') + 1]).toBe(ROLE_FAMILY_COLUMN);
    expect(Object.values(run.observed['jobs.roleFamilyByKey'])).toHaveLength(GOLDEN_TITLES.length);
    expect(Object.values(run.observed['jobs.roleFamilyByKey']).every((family) => CLOSED_FAMILY_SET.includes(family))).toBe(true);
  });

  it('@real-io a rebuild from a directory of cached alerts carries the column too', () => {
    const workspace = aScratchWorkspace();
    const cached = aCacheOfAdverts(workspace, theAdvertsOf(STANDARD_COHORT));
    const out = join(workspace, 'rebuilt.xlsx');
    const result = operatorRebuildsFromTheCache(workspace, out);
    expect(result.status, result.stderr).toBe(0);
    expect(observeWorkbook(out)['jobs.header']).toEqual(JOBS_COLUMNS);
    expect(familiesInWorkbook(out)).toEqual(theFamiliesExpectedOf(cached, STANDARD_COHORT));
  });
});

describe('@driving_adapter build classifies from the title alone', () => {
  it('@error company and saved search never influence the family: a title with no pattern stays other whatever surrounds it', () => {
    // Given adverts whose company and saved search are full of pattern words, but whose titles are not
    const workspace = aScratchWorkspace();
    const cached = aCacheOfAdverts(
      workspace,
      [anAdvert({ title: 'Data Analyst', company: 'Scrum Master Consulting Ltd' }), anAdvert({ title: 'Data Analyst', company: 'Agile Coach Partners Ltd' }), anAdvert({ title: 'Scrum Master', company: 'Product Owner Ltd' })],
      { searchTerm: 'agile coach in United Kingdom' },
    );
    // When the operator builds a new workbook
    const out = join(workspace, 'tracker.xlsx');
    const result = operatorBuildsNewWorkbook(workspace, out);
    // Then the family follows the title in every case
    expect(result.status, result.stderr).toBe(0);
    expect(familiesInWorkbook(out)).toEqual({ [cached[0].key]: FamilyName.OTHER, [cached[1].key]: FamilyName.OTHER, [cached[2].key]: FamilyName.SCRUM_MASTER });
  });

  it('@error one advert surfaced by two saved searches is one row with one family, whichever alert arrived first', () => {
    const family = (searches) => {
      const workspace = aScratchWorkspace();
      const advert = [anAdvert({ title: 'Delivery Manager', id: '4410000001' })];
      anAlertSighting(workspace, { id: 'alert-a', date: '2026-07-24T09:00:00Z', searchTerm: searches[0], adverts: advert });
      anAlertSighting(workspace, { id: 'alert-b', date: '2026-07-25T09:00:00Z', searchTerm: searches[1], adverts: advert });
      const out = join(workspace, 'tracker.xlsx');
      const result = operatorBuildsNewWorkbook(workspace, out);
      expect(result.status, result.stderr).toBe(0);
      return familiesInWorkbook(out);
    };
    const oneWay = family(['scrum master in London', 'product manager in Leeds']);
    const otherWay = family(['product manager in Leeds', 'scrum master in London']);
    expect(oneWay).toEqual({ 'linkedin:4410000001': FamilyName.DELIVERY_MANAGER });
    expect(otherWay).toEqual(oneWay);
  });

  it('@error an advert retitled between sightings takes its family from the first sighting, as the row does, across the whole cache (DR-0009)', () => {
    // Given the same advert sighted in May as a Scrum Master and again in July as a Product Manager,
    // with the cache files named so that the July alert sorts first
    const workspace = aScratchWorkspace();
    anAlertSighting(workspace, { id: 'z-may', date: '2026-05-12T09:00:00Z', adverts: [anAdvert({ title: 'Scrum Master', id: '4420000001' })] });
    anAlertSighting(workspace, { id: 'a-july', date: '2026-07-25T09:00:00Z', adverts: [anAdvert({ title: 'Product Manager', id: '4420000001' })] });
    // When the operator builds from the whole cache
    const out = join(workspace, 'tracker.xlsx');
    const result = operatorBuildsNewWorkbook(workspace, out);
    // Then the row keeps the first sighting's title, and its family follows that title
    expect(result.status, result.stderr).toBe(0);
    expect(familiesInWorkbook(out)).toEqual({ 'linkedin:4420000001': FamilyName.SCRUM_MASTER });
    expect(theHarvestOf(workspace).jobs.rows[0].Job).toBe('Scrum Master');
  });

  it('@error reposts under new job ids with an identical title are separate rows with the same family', () => {
    const workspace = aScratchWorkspace();
    const cached = aCacheOfAdverts(workspace, [anAdvert({ title: 'Product Owner', company: 'Acme Ltd' }), anAdvert({ title: 'Product Owner', company: 'Acme Ltd' }), anAdvert({ title: 'Product Owner', company: 'Acme Ltd' })]);
    const out = join(workspace, 'tracker.xlsx');
    const result = operatorBuildsNewWorkbook(workspace, out);
    expect(result.status, result.stderr).toBe(0);
    expect(familiesInWorkbook(out)).toEqual(Object.fromEntries(cached.map(({ key }) => [key, FamilyName.PRODUCT])));
  });

  it('@error case, punctuation, spacing, accent and symbol variants of a title all reach their family', () => {
    const workspace = aScratchWorkspace();
    const cached = aCacheOfAdverts(workspace, TITLE_VARIANTS.map(({ title }) => anAdvert({ title })));
    const out = join(workspace, 'tracker.xlsx');
    const result = operatorBuildsNewWorkbook(workspace, out);
    expect(result.status, result.stderr).toBe(0);
    expect(familiesInWorkbook(out)).toEqual(Object.fromEntries(cached.map(({ key }, index) => [key, TITLE_VARIANTS[index].family])));
  });

  it('@error a title of only punctuation, and a title in a script no pattern uses, are other', () => {
    const workspace = aScratchWorkspace();
    const cached = aCacheOfAdverts(workspace, [anAdvert({ title: '!!!' }), anAdvert({ title: '( - )' }), anAdvert({ title: '敏捷教练' })]);
    const out = join(workspace, 'tracker.xlsx');
    const result = operatorBuildsNewWorkbook(workspace, out);
    expect(result.status, result.stderr).toBe(0);
    expect(familiesInWorkbook(out)).toEqual(Object.fromEntries(cached.map(({ key }) => [key, FamilyName.OTHER])));
  });

  it('@error a very long title is classified and written, whichever family it lands in', () => {
    const workspace = aScratchWorkspace();
    const filler = 'consulting '.repeat(300);
    const cached = aCacheOfAdverts(workspace, [anAdvert({ title: `Agile Coach ${filler}` }), anAdvert({ title: `${filler} Product Owner` }), anAdvert({ title: `Data Analyst ${filler}` })]);
    const out = join(workspace, 'tracker.xlsx');
    const result = operatorBuildsNewWorkbook(workspace, out);
    expect(result.status, result.stderr).toBe(0);
    expect(familiesInWorkbook(out)).toEqual({ [cached[0].key]: FamilyName.AGILE_COACH, [cached[1].key]: FamilyName.PRODUCT, [cached[2].key]: FamilyName.OTHER });
  });
});

describe('@driving_adapter build merges Role Family into an existing tracker (DR-0004 rule 3)', () => {
  it('@driving_adapter @real-io the column is appended at the far right, every advert is filled, and the operator\'s own cells and tabs are untouched', () => {
    // Given a tracker that predates the column, holding the operator's Status, qualifications, notes and a Contacts tab
    const workspace = aScratchWorkspace();
    const { tracker, expected } = anExistingTracker(workspace, STANDARD_COHORT);
    const before = observeWorkbook(tracker);
    // When the operator merges the cache into it
    const result = operatorMerges(workspace, tracker);
    // Then Role Family arrives after the last column the operator has, each advert carries its family, and nothing else moved
    expect(result.status, result.stderr).toBe(0);
    const after = observeWorkbook(tracker);
    assertStateDelta(before, after, {
      universe: WORKBOOK_UNIVERSE,
      expected: { 'jobs.header': appendedWith(ROLE_FAMILY_COLUMN), 'jobs.roleFamilyByKey': setTo(expected) },
    });
    expect(after['jobs.header'].slice(-2)).toEqual(['My Notes', ROLE_FAMILY_COLUMN]);
  });

  it('@error a row the operator added by hand, with no Dedup Key, is neither classified nor touched', () => {
    const workspace = aScratchWorkspace();
    const handTyped = { Job: 'Scrum Master', Status: 'Interested', 'My Notes': 'found this myself' };
    const { tracker, expected } = anExistingTracker(workspace, STANDARD_COHORT, { extraRows: [handTyped] });
    const before = observeWorkbook(tracker);
    const result = operatorMerges(workspace, tracker);
    expect(result.status, result.stderr).toBe(0);
    assertStateDelta(before, observeWorkbook(tracker), {
      universe: WORKBOOK_UNIVERSE,
      expected: { 'jobs.header': appendedWith(ROLE_FAMILY_COLUMN), 'jobs.roleFamilyByKey': setTo(expected), 'jobs.handAddedRoleFamily': setTo([null]) },
    });
  });

  it('@error the first population is not itemised as corrections: stdout counts the appended column, stderr says no derived corrections, the report holds nothing about it', () => {
    const workspace = aScratchWorkspace();
    const { tracker } = anExistingTracker(workspace, STANDARD_COHORT);
    const report = join(workspace, 'changes.txt');
    const result = operatorMerges(workspace, tracker, '--report', report);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Jobs: rows updated: 4, rows appended: 0, columns appended: 1, cell changes: 4/);
    expect(result.stderr).toMatch(/no derived corrections/);
    expect(roleFamilyCorrectionsIn(result.stderr)).toEqual([]);
    expect(roleFamilyCorrectionsIn(reportTextOf(report))).toEqual([]);
  });

  it('@error a later re-classification is itemised, one line per changed advert, and the unchanged adverts are not mentioned', () => {
    // Given a tracker whose Role Family column holds two stale families and two right ones
    const workspace = aScratchWorkspace();
    const held = (expected, cached) => ({ [cached[0].key]: FamilyName.OTHER, [cached[1].key]: expected[cached[1].key], [cached[2].key]: FamilyName.AGILE_COACH, [cached[3].key]: expected[cached[3].key] });
    const { tracker, cached, expected } = anExistingTracker(workspace, STANDARD_COHORT, { header: WITH_THE_COLUMN, held });
    const report = join(workspace, 'changes.txt');
    const before = observeWorkbook(tracker);
    // When the operator merges the cache into it
    const result = operatorMerges(workspace, tracker, '--report', report);
    // Then the two stale cells are corrected and itemised in stderr and in the report, as derived corrections
    expect(result.status, result.stderr).toBe(0);
    assertStateDelta(before, observeWorkbook(tracker), { universe: WORKBOOK_UNIVERSE, expected: { 'jobs.roleFamilyByKey': setTo(expected) } });
    const itemised = [
      { key: cached[0].key, from: FamilyName.OTHER, to: FamilyName.SCRUM_MASTER },
      { key: cached[2].key, from: FamilyName.AGILE_COACH, to: FamilyName.OTHER },
    ];
    expect(roleFamilyCorrectionsIn(result.stderr)).toEqual(itemised);
    expect(roleFamilyCorrectionsIn(reportTextOf(report))).toEqual(itemised);
    expect(result.stderr).toMatch(/2 derived correction\(s\)/);
    expect(result.stdout).toMatch(/columns appended: 0/);
  });

  it('@error a family the operator typed over the harvester\'s is overwritten, and itemised: the column is harvester-owned', () => {
    const workspace = aScratchWorkspace();
    const held = (expected, cached) => ({ ...expected, [cached[0].key]: 'my own label' });
    const { tracker, cached, expected } = anExistingTracker(workspace, STANDARD_COHORT, { header: WITH_THE_COLUMN, held });
    const before = observeWorkbook(tracker);
    const result = operatorMerges(workspace, tracker);
    expect(result.status, result.stderr).toBe(0);
    assertStateDelta(before, observeWorkbook(tracker), { universe: WORKBOOK_UNIVERSE, expected: { 'jobs.roleFamilyByKey': setTo(expected) } });
    expect(roleFamilyCorrectionsIn(result.stderr)).toEqual([{ key: cached[0].key, from: 'my own label', to: FamilyName.SCRUM_MASTER }]);
  });

  it('@error a Role Family column the operator created by hand becomes harvester-owned: the preview appends nothing, and the build fills it where it stands', () => {
    // Given a tracker whose operator already added an empty Role Family column beside Status, to try pivots
    const workspace = aScratchWorkspace();
    const withColumnBesideStatus = [LEGACY_JOBS_HEADER[0], ROLE_FAMILY_COLUMN, ...LEGACY_JOBS_HEADER.slice(1), 'My Notes'];
    const { tracker, cached, expected } = anExistingTracker(workspace, STANDARD_COHORT, { header: withColumnBesideStatus, held: () => ({}) });
    const before = observeWorkbook(tracker);
    // When the operator previews, then builds
    const preview = operatorPreviews(workspace, '--merge', tracker);
    const built = operatorMerges(workspace, tracker);
    // Then the preview names no column to append, the column stays in place, and each filled cell is itemised
    expect(preview.status, preview.stderr).toBe(0);
    expect(preview.stdout).toMatch(/columns to append: 0/);
    expect(built.status, built.stderr).toBe(0);
    assertStateDelta(before, observeWorkbook(tracker), { universe: WORKBOOK_UNIVERSE, expected: { 'jobs.roleFamilyByKey': setTo(expected) } });
    expect(roleFamilyCorrectionsIn(built.stderr).map(({ key, from, to }) => [key, from, to])).toEqual(cached.map(({ key }) => [key, '(blank)', expected[key]]));
  });

  it('@error a second build changes nothing: no cell written, no correction, no column appended', () => {
    // Given a tracker that the first build has already given the column
    const workspace = aScratchWorkspace();
    const { tracker, expected } = anExistingTracker(workspace, STANDARD_COHORT);
    const first = operatorMerges(workspace, tracker);
    expect(first.status, first.stderr).toBe(0);
    expect(familiesInWorkbook(tracker)).toEqual(expected);
    const before = observeWorkbook(tracker);
    const cellsBefore = workbookCellsOutside(tracker, null);
    const second = operatorMerges(workspace, tracker);
    expect(second.status, second.stderr).toBe(0);
    assertStateDelta(before, observeWorkbook(tracker), { universe: WORKBOOK_UNIVERSE, expected: Object.fromEntries(WORKBOOK_UNIVERSE.map((name) => [name, unchanged()])) });
    expect(workbookCellsOutside(tracker, null)).toEqual(cellsBefore);
    expect(second.stdout).toMatch(/Jobs: rows updated: 4, rows appended: 0, columns appended: 0, cell changes: 0/);
    expect(second.stderr).toMatch(/no derived corrections/);
    expect(second.stderr).not.toMatch(/bookkeeping/);
  });
});

describe('@driving_adapter build --dry-run previews the column and writes nothing', () => {
  // @contract-shape:unbounded-preservation
  it('@error the preview names the column it would append and the cell changes, and the workspace is byte-identical afterwards', () => {
    const workspace = aScratchWorkspace();
    const { tracker } = anExistingTracker(workspace, STANDARD_COHORT);
    const before = { 'workspace.files': fileDigests(workspace) };
    const result = operatorPreviews(workspace, '--merge', tracker);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/columns to append: 1 \(Role Family\)/);
    expect(result.stdout).toMatch(/cell changes: 4/);
    expect(roleFamilyCorrectionsIn(result.stderr)).toEqual([]);
    assertStateDelta(before, { 'workspace.files': fileDigests(workspace) }, { universe: ['workspace.files'] });
  });

  // @contract-shape:unbounded-preservation
  scenario('@error a preview with no tracker plans every advert as a new row, tells which fell through, and writes no file', () => {
    const workspace = aScratchWorkspace();
    aCacheOfAdverts(workspace, theAdvertsOf(STANDARD_COHORT));
    const before = { 'workspace.files': fileDigests(workspace) };
    const result = operatorPreviews(workspace);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/rows to append: 4/);
    expect(tuningViewOf(result.stderr)).toEqual({ other: 1, total: 4, entries: [{ count: 1, title: 'data analyst' }] });
    assertStateDelta(before, { 'workspace.files': fileDigests(workspace) }, { universe: ['workspace.files'] });
  });
});

describe('@driving_adapter build shows the most frequent other titles so the operator can tune the table', () => {
  const TITLES_BY_FREQUENCY = [
    ['Lighthouse Keeper Alpha', 5], ['Lighthouse Keeper Bravo', 4], ['Lighthouse Keeper Charlie', 4],
    ['Lighthouse Keeper Delta', 3], ['Lighthouse Keeper Echo', 3], ['Lighthouse Keeper Foxtrot', 3],
    ['Lighthouse Keeper Golf', 2], ['Lighthouse Keeper Hotel', 2], ['Lighthouse Keeper India', 2], ['Lighthouse Keeper Juliet', 2],
    ['Lighthouse Keeper Kilo', 1], ['Lighthouse Keeper Lima', 1], ['Lighthouse Keeper Mike', 1], ['Lighthouse Keeper November', 1],
    ['Lighthouse Keeper Oscar', 1], ['Lighthouse Keeper Papa', 1], ['Lighthouse Keeper Quebec', 1],
  ];
  const THE_FIFTEEN = [
    { count: 5, title: 'lighthouse keeper alpha' }, { count: 4, title: 'lighthouse keeper bravo' }, { count: 4, title: 'lighthouse keeper charlie' },
    { count: 3, title: 'lighthouse keeper delta' }, { count: 3, title: 'lighthouse keeper echo' }, { count: 3, title: 'lighthouse keeper foxtrot' },
    { count: 2, title: 'lighthouse keeper golf' }, { count: 2, title: 'lighthouse keeper hotel' }, { count: 2, title: 'lighthouse keeper india' }, { count: 2, title: 'lighthouse keeper juliet' },
    { count: 1, title: 'lighthouse keeper kilo' }, { count: 1, title: 'lighthouse keeper lima' }, { count: 1, title: 'lighthouse keeper mike' }, { count: 1, title: 'lighthouse keeper november' },
    { count: 1, title: 'lighthouse keeper oscar' },
  ];
  const aLongTailOfOtherTitles = () => [...TITLES_BY_FREQUENCY.flatMap(([title, times]) => repeated(title, FamilyName.OTHER, times)), SCRUM, PRODUCT_OWNER];

  scenario('@error a merge prints how many adverts fell through, the titles that fell most often grouped by normalised title, and the count per family, on stderr only', () => {
    // Given adverts of which some fall through, under titles that differ only in case, punctuation and spacing
    const workspace = aScratchWorkspace();
    const cohort = [
      ...['Data Analyst', 'DATA ANALYST', 'data  analyst!'].map((title) => ({ title, family: FamilyName.OTHER })),
      ...repeated('Java Developer', FamilyName.OTHER, 2),
      { title: 'Warehouse Operative', family: FamilyName.OTHER },
      SCRUM,
    ];
    const { tracker } = anExistingTracker(workspace, cohort, { header: WITH_THE_COLUMN, held: upToDate });
    // When the operator merges
    const result = operatorMerges(workspace, tracker);
    // Then stderr carries the tuning view and stdout does not
    expect(result.status, result.stderr).toBe(0);
    expect(tuningViewOf(result.stderr)).toEqual({
      other: 6,
      total: 7,
      entries: [{ count: 3, title: 'data analyst' }, { count: 2, title: 'java developer' }, { count: 1, title: 'warehouse operative' }],
    });
    expect(familyCountsLineOf(result.stderr)).toMatch(/scrum master\D+1\b/);
    expect(familyCountsLineOf(result.stderr)).toMatch(/other\D+6\b/);
    expect(result.stdout).not.toMatch(/classified other/);
  });

  scenario('@error a preview shows the same view, lists at most fifteen titles by count then title, and cuts the rest', () => {
    const workspace = aScratchWorkspace();
    aCacheOfAdverts(workspace, theAdvertsOf(aLongTailOfOtherTitles()));
    const result = operatorPreviews(workspace);
    expect(result.status, result.stderr).toBe(0);
    expect(TUNING_LIMIT).toBe(15);
    expect(tuningViewOf(result.stderr)).toEqual({ other: 37, total: 39, entries: THE_FIFTEEN });
  });

  scenario('@error the view says nothing when every advert has a family', () => {
    // Given adverts that all match a family, in a tracker that predates the column
    const workspace = aScratchWorkspace();
    const { tracker, expected } = anExistingTracker(workspace, [SCRUM, PRODUCT_OWNER, PROGRAMME]);
    // When the operator merges
    const result = operatorMerges(workspace, tracker);
    // Then every advert has its family, and stderr says nothing about adverts that fell through
    expect(result.status, result.stderr).toBe(0);
    expect(familiesInWorkbook(tracker)).toEqual(expected);
    expect(tuningViewOf(result.stderr)).toBeNull();
    expect(familyCountsLineOf(result.stderr)).toBeNull();
    expect(result.stderr).not.toMatch(/classified other/);
  });

  scenario('@error a title that falls through is shown from the very first preview of a tracker that lacks the column, and the tracker is not written', () => {
    const workspace = aScratchWorkspace();
    const { tracker } = anExistingTracker(workspace, [DATA_ANALYST, SCRUM]);
    const before = { 'workspace.files': fileDigests(workspace) };
    const result = operatorPreviews(workspace, '--merge', tracker);
    expect(result.status, result.stderr).toBe(0);
    expect(tuningViewOf(result.stderr)).toEqual({ other: 1, total: 2, entries: [{ count: 1, title: 'data analyst' }] });
    assertStateDelta(before, { 'workspace.files': fileDigests(workspace) }, { universe: ['workspace.files'] });
  });

  scenario('@error the view never enters the report file, so an empty report still means nothing changed', () => {
    // Given a tracker already holding every family, and adverts that fall through
    const workspace = aScratchWorkspace();
    const { tracker } = anExistingTracker(workspace, [DATA_ANALYST, SCRUM], { header: WITH_THE_COLUMN, held: upToDate });
    const report = join(workspace, 'changes.txt');
    // When the operator merges and asks for the report
    const result = operatorMerges(workspace, tracker, '--report', report);
    // Then stderr shows the view, and the report file exists and is empty
    expect(result.status, result.stderr).toBe(0);
    expect(tuningViewOf(result.stderr)).not.toBeNull();
    expect(reportTextOf(report)).toBe('');
  });
});
