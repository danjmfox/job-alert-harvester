// Test infrastructure for role-family-column: not a scenario, and unskipped. It proves the builders hand the scenarios
// what they claim (so a scenario cannot fail, or pass, because of a fixture), and that the golden table agrees with the
// DESIGN's illustrative table through an oracle that shares no code with src/.
import { describe, expect, it } from 'vitest';
import { GOLDEN_TITLES, TITLE_VARIANTS } from './support/golden-titles.mjs';
import { CLOSED_FAMILY_SET, FamilyName } from './support/family-names.mjs';
import { classifiedPerDesign, containsRun, wordsOf } from './support/oracle.mjs';
import {
  JOBS_COLUMNS,
  ROLE_FAMILY_COLUMN,
  STANDARD_COHORT,
  aCacheOfAdverts,
  aCohortCached,
  aScratchWorkspace,
  aTrackerWorkbook,
  anAdvert,
  observeWorkbook,
  operatorMerges,
  theAdvertsOf,
  theHarvestOf,
  useWorkspaceCleanup,
} from './support/role-family-domain-types.mjs';
import { join } from 'node:path';

useWorkspaceCleanup();

/** DESIGN Q4, "Proposed order and rationale": the illustrative table the human ratified (OQ-1). */
const DESIGN_ILLUSTRATIVE_TABLE = [
  { family: FamilyName.AGILE_COACH, patterns: ['agile coach', 'enterprise agile coach', 'business agility', 'agile transformation coach'] },
  { family: FamilyName.SCRUM_MASTER, patterns: ['scrum master'] },
  { family: FamilyName.AI_TRANSFORMATION, patterns: ['ai transformation', 'artificial intelligence transformation'] },
  { family: FamilyName.TRANSFORMATION_CHANGE, patterns: ['transformation', 'change manager', 'change lead', 'business change'] },
  { family: FamilyName.DELIVERY_MANAGER, patterns: ['delivery manager', 'delivery lead', 'head of delivery', 'engineering manager', 'programme manager', 'project manager'] },
  { family: FamilyName.PRODUCT, patterns: ['product owner', 'product manager', 'product operations', 'product ops'] },
];

describe('the golden table', () => {
  it('has unique titles, every family at least once, and the nine contested cases', () => {
    const titles = GOLDEN_TITLES.map(({ title }) => title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(GOLDEN_TITLES.map(({ family }) => family))).toEqual(new Set(CLOSED_FAMILY_SET));
    expect(GOLDEN_TITLES.filter(({ kind }) => kind === 'contested')).toHaveLength(9);
  });

  it('agrees with the DESIGN\'s illustrative table, judged by an oracle independent of src/', () => {
    const disagreements = [...GOLDEN_TITLES, ...TITLE_VARIANTS].filter(({ title, family }) => classifiedPerDesign(DESIGN_ILLUSTRATIVE_TABLE, title) !== family);
    expect(disagreements).toEqual([]);
  });

  it('exercises every pattern of the DESIGN\'s illustrative table', () => {
    const unexercised = DESIGN_ILLUSTRATIVE_TABLE.flatMap(({ family, patterns }) => patterns.filter((pattern) => !GOLDEN_TITLES.some((golden) => golden.family === family && containsRun(wordsOf(golden.title), pattern))).map((pattern) => `${family}: ${pattern}`));
    expect(unexercised).toEqual([]);
  });
});

describe('the cache and tracker builders', () => {
  it('cache every golden title so that the real parser reads each back unchanged, one row per advert', () => {
    const workspace = aScratchWorkspace();
    const cached = aCacheOfAdverts(workspace, theAdvertsOf(GOLDEN_TITLES));
    const rows = theHarvestOf(workspace).jobs.rows;
    expect(rows).toHaveLength(GOLDEN_TITLES.length);
    const titleByKey = Object.fromEntries(rows.map((row) => [row['Dedup Key'], row.Job]));
    expect(cached.map(({ key }) => titleByKey[key])).toEqual(GOLDEN_TITLES.map(({ title }) => title));
  });

  it('cache every title variant as its own advert, whitespace aside', () => {
    const workspace = aScratchWorkspace();
    const cached = aCacheOfAdverts(workspace, TITLE_VARIANTS.map(({ title }) => anAdvert({ title })));
    const titleByKey = Object.fromEntries(theHarvestOf(workspace).jobs.rows.map((row) => [row['Dedup Key'], row.Job]));
    expect(cached.map(({ key }) => titleByKey[key])).toEqual(TITLE_VARIANTS.map(({ title }) => title.trim().replace(/\s+/g, ' ')));
  });

  it('shape a tracker that never holds the answer: the rows of a tracker predating the column lack Role Family', () => {
    const { rows, expected } = aCohortCached(aScratchWorkspace(), STANDARD_COHORT);
    expect(rows).toHaveLength(STANDARD_COHORT.length);
    expect(rows.every((row) => !(ROLE_FAMILY_COLUMN in row))).toBe(true);
    expect(Object.values(expected)).toEqual(STANDARD_COHORT.map(({ family }) => family));
  });

  it('shape a tracker that matches what the harvest derives, so a merge into it changes no cell', () => {
    // Given a tracker holding exactly what the harvest derives, under every declared Jobs column
    const workspace = aScratchWorkspace();
    aCacheOfAdverts(workspace, theAdvertsOf(STANDARD_COHORT));
    const model = theHarvestOf(workspace);
    const tracker = join(workspace, 'tracker.xlsx');
    aTrackerWorkbook(tracker, { header: model.jobs.columns, rows: model.jobs.rows });
    // When the operator merges the same cache into it
    const result = operatorMerges(workspace, tracker);
    // Then nothing changes
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Jobs: rows updated: 4, rows appended: 0, columns appended: 0, cell changes: 0/);
    expect(observeWorkbook(tracker)['jobs.header']).toEqual(model.jobs.columns);
    expect(model.jobs.columns.length).toBeGreaterThanOrEqual(JOBS_COLUMNS.length - 1);
  });
});
