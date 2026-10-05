// @contract-shape:pure-function
// The table is data, and data that decides what an operator's pivots show is linted (DR-0014, DR-0006 precedent):
// a repeated family, an empty or never-matching pattern, a pattern two descriptors share, and a pattern a
// higher-priority pattern shadows are all defects that no single classification would reveal. The second half closes
// the drift finding of the DESIGN (Q1): the declared column lists must describe one set, and a harvest must carry
// the new column in every row.
import { describe, expect, it } from 'vitest';
import { OTHER_FAMILY, ROLE_FAMILIES, classifyRoleFamily, normaliseTitle } from '../../../src/core/role-families.mjs';
import { JOBS_COLUMNS, harvest } from '../../../src/core/harvest.mjs';
import { HARVESTER_COLUMNS, HUMAN_COLUMNS, KEY_COLUMN, aMessage } from '../job-alert-harvester/support/domain-types.mjs';
import { TAB_OWNERSHIP } from '../../../src/core/sheets-model.mjs';
import { FAMILY_PRIORITY_ORDER, ROLE_FAMILY_COLUMN } from './support/family-names.mjs';
import { GOLDEN_TITLES } from './support/golden-titles.mjs';
import { containsRun, wordsOf } from './support/oracle.mjs';

const theTable = () => {
  expect(ROLE_FAMILIES.length).toBeGreaterThan(0);
  return ROLE_FAMILIES;
};
const patternsOf = (table) => table.flatMap((descriptor, index) => descriptor.patterns.map((pattern) => ({ index, family: descriptor.family, pattern })));

describe('the family table is linted: it is data that behaves like code', () => {
  it('the families are exactly the six the human ratified, in the order the human ratified, and other is not one of them', () => {
    const table = theTable();
    expect(table.map((descriptor) => descriptor.family)).toEqual(FAMILY_PRIORITY_ORDER);
    expect(table.map((descriptor) => descriptor.family)).not.toContain(OTHER_FAMILY);
  });

  it('@error no family name is repeated', () => {
    const names = theTable().map((descriptor) => descriptor.family);
    expect(new Set(names).size).toBe(names.length);
  });

  it('@error every descriptor has at least one pattern, and every pattern is a non-empty phrase already in normalised form', () => {
    for (const descriptor of theTable()) {
      expect(descriptor.patterns.length, descriptor.family).toBeGreaterThan(0);
      for (const pattern of descriptor.patterns) {
        expect(typeof pattern).toBe('string');
        expect(pattern.length, `${descriptor.family}: empty pattern`).toBeGreaterThan(0);
        expect(normaliseTitle(pattern), `${descriptor.family}: "${pattern}" can never match a normalised title`).toBe(pattern);
      }
    }
  });

  it('@error no pattern is held by two descriptors, or twice by one', () => {
    const phrases = patternsOf(theTable()).map(({ pattern }) => pattern);
    expect(phrases.filter((pattern, position) => phrases.indexOf(pattern) !== position)).toEqual([]);
  });

  it('@error no pattern of a later descriptor contains a pattern of an earlier one: it could never be reached', () => {
    const shadowed = [];
    const all = patternsOf(theTable());
    for (const later of all) {
      for (const earlier of all.filter((entry) => entry.index < later.index)) {
        if (containsRun(wordsOf(later.pattern), earlier.pattern)) shadowed.push(`${later.family}: "${later.pattern}" is shadowed by ${earlier.family}: "${earlier.pattern}"`);
      }
    }
    expect(shadowed).toEqual([]);
  });

  it('@error every pattern, classified on its own, lands in the family that owns it', () => {
    const misplaced = patternsOf(theTable()).filter(({ family, pattern }) => classifyRoleFamily(pattern) !== family);
    expect(misplaced.map(({ pattern, family }) => `"${pattern}" should be ${family}`)).toEqual([]);
  });

  it('every pattern is exercised by at least one golden title that lands in its family', () => {
    const unexercised = patternsOf(theTable()).filter(
      ({ family, pattern }) => !GOLDEN_TITLES.some((golden) => golden.family === family && containsRun(wordsOf(golden.title), pattern)),
    );
    expect(unexercised.map(({ pattern, family }) => `${family}: "${pattern}" has no golden title`)).toEqual([]);
  });

  it('@error the table cannot be changed at run time', () => {
    const table = theTable();
    expect(Object.isFrozen(table)).toBe(true);
    for (const descriptor of table) {
      expect(Object.isFrozen(descriptor), descriptor.family).toBe(true);
      expect(Object.isFrozen(descriptor.patterns), descriptor.family).toBe(true);
    }
  });
});

describe('the declared column lists describe one set (DESIGN Q1, scenario S9)', () => {
  const asSet = (columns) => new Set(columns);

  it('@error the Jobs header is the Dedup Key plus the harvester-owned columns plus the human-owned columns, as a set, with no column named twice', () => {
    expect(asSet(JOBS_COLUMNS).size).toBe(JOBS_COLUMNS.length);
    expect(asSet(HARVESTER_COLUMNS).size).toBe(HARVESTER_COLUMNS.length);
    expect(asSet(HUMAN_COLUMNS).size).toBe(HUMAN_COLUMNS.length);
    expect(HARVESTER_COLUMNS.filter((column) => HUMAN_COLUMNS.includes(column))).toEqual([]);
    expect(HARVESTER_COLUMNS).not.toContain(KEY_COLUMN);
    expect(HUMAN_COLUMNS).not.toContain(KEY_COLUMN);
    expect([...asSet(JOBS_COLUMNS)].sort()).toEqual([KEY_COLUMN, ...HARVESTER_COLUMNS, ...HUMAN_COLUMNS].sort());
  });

  it('Role Family is in the Jobs header and is harvester-owned, never human-owned, never the key', () => {
    expect(JOBS_COLUMNS).toContain(ROLE_FAMILY_COLUMN);
    expect(HARVESTER_COLUMNS).toContain(ROLE_FAMILY_COLUMN);
    expect(HUMAN_COLUMNS).not.toContain(ROLE_FAMILY_COLUMN);
    expect(TAB_OWNERSHIP.Jobs.harvesterColumns).toContain(ROLE_FAMILY_COLUMN);
    expect(TAB_OWNERSHIP.Jobs.keyColumns).not.toContain(ROLE_FAMILY_COLUMN);
  });

  it('Role Family sits immediately after Fit Reason in a new workbook header and in the harvester-owned list', () => {
    expect(JOBS_COLUMNS[JOBS_COLUMNS.indexOf('Fit Reason') + 1]).toBe(ROLE_FAMILY_COLUMN);
    expect(HARVESTER_COLUMNS[HARVESTER_COLUMNS.indexOf('Fit Reason') + 1]).toBe(ROLE_FAMILY_COLUMN);
  });

  it('the header a tracker had before the column is exactly the old 26 columns, so a new column needs a wider grid', () => {
    expect(JOBS_COLUMNS.filter((column) => column !== ROLE_FAMILY_COLUMN)).toHaveLength(26);
    expect(JOBS_COLUMNS).toHaveLength(27);
  });

  it('a harvest carries Role Family in every Jobs row, under every declared Jobs column and none other', () => {
    const jobs = GOLDEN_TITLES.slice(0, 6).map(({ title }, index) => ({ id: `440000000${index}`, title, company: 'Acme Ltd' }));
    const model = harvest([aMessage({ id: 'alert-1', jobs })]);
    expect(model.jobs.columns).toEqual(JOBS_COLUMNS);
    expect(model.jobs.columns).toContain(ROLE_FAMILY_COLUMN);
    expect(model.jobs.rows).toHaveLength(6);
    for (const row of model.jobs.rows) expect(Object.keys(row).sort()).toEqual([...JOBS_COLUMNS].sort());
  });

  it('a harvest fills Role Family from the title of the advert: the golden family for every golden title', () => {
    const jobs = GOLDEN_TITLES.map(({ title }, index) => ({ id: String(4400000000 + index), title, company: 'Acme Ltd' }));
    const model = harvest(jobs.map((job, index) => aMessage({ id: `alert-${index}`, jobs: [job] })));
    const familyByTitle = Object.fromEntries(model.jobs.rows.map((row) => [row.Job, row[ROLE_FAMILY_COLUMN]]));
    expect(GOLDEN_TITLES.map(({ title }) => familyByTitle[title])).toEqual(GOLDEN_TITLES.map(({ family }) => family));
  });
});
