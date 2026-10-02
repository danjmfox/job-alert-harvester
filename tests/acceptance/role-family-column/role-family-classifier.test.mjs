// @contract-shape:pure-function
// DR-0014: the title of an advert, and nothing else, names its role family. The classifier is a total, deterministic
// function over an ordered data table: first descriptor with a matching pattern wins, otherwise `other`. This file is the
// pure layer (the function's own signature is its driving port) and holds the golden table, the double-qualifier cases the
// human ratified, the degenerate inputs, the normaliser and the tuning summary. Properties live in
// role-family-properties.test.mjs; the same table is driven through `build` in the two build files.
import { describe, expect, it } from 'vitest';
import { OTHER_FAMILY, classifyRoleFamily, normaliseTitle, summariseRoleFamilies } from '../../../src/core/role-families.mjs';
import { GOLDEN_TITLES, TITLE_VARIANTS } from './support/golden-titles.mjs';
import { FamilyName } from './support/family-names.mjs';
import { scenario } from './support/red-gate.mjs';

const TAG = { family: '@golden', contested: '@golden @contested', multi: '@golden @double-qualifier', boundary: '@golden @error @whole-word', other: '@golden @error @fallback' };

describe('the classifier names the family of a generic advert title', () => {
  for (const { kind, title, family } of GOLDEN_TITLES) {
    it(`${TAG[kind]} "${title}" is classified ${family}`, () => {
      // Given an advert titled as in the golden table
      // When the title is classified
      // Then it lands in exactly the ratified family
      expect(classifyRoleFamily(title)).toBe(family);
    });
  }
});

describe('case, punctuation, whitespace, accents and symbols do not change the family', () => {
  for (const { title, family } of TITLE_VARIANTS) {
    it(`@error @variant "${title}" is classified ${family}`, () => {
      expect(classifyRoleFamily(title)).toBe(family);
    });
  }
});

describe('the order of the table is the priority: a named practice role outranks a generic noun', () => {
  const PRIORITY_CASES = [
    ['Agile Coach / Scrum Master', FamilyName.AGILE_COACH, 'agile coach is ranked before scrum master'],
    ['Scrum Master / Delivery Lead', FamilyName.SCRUM_MASTER, 'scrum master is ranked before delivery lead'],
    ['AI Transformation Delivery Manager', FamilyName.AI_TRANSFORMATION, 'AI transformation is ranked before delivery manager'],
    ['Transformation Product Manager', FamilyName.TRANSFORMATION_CHANGE, 'transformation is ranked before product manager'],
    ['Product Manager (Delivery Lead)', FamilyName.DELIVERY_MANAGER, 'delivery lead is ranked before product manager'],
    ['Agile Transformation Coach (AI Transformation)', FamilyName.AGILE_COACH, 'agile coach is ranked before AI transformation'],
  ];
  for (const [title, family, reason] of PRIORITY_CASES) {
    it(`@priority "${title}" is classified ${family}: ${reason}`, () => {
      expect(classifyRoleFamily(title)).toBe(family);
    });
  }
});

describe('the classifier is total: every input has a family and none throws', () => {
  scenario('@error an empty title, a blank title and a title of only punctuation fall back to other', () => {
    expect(['', '   ', '\t\n', '!!!', '( - )', '/', ' '].map(classifyRoleFamily)).toEqual(Array(7).fill(OTHER_FAMILY));
  });

  scenario('@error a missing title, and anything that is not text, falls back to other without throwing', () => {
    const notText = [null, undefined, 42, 0, true, {}, [], ['Scrum Master'], { title: 'Scrum Master' }, Symbol('Scrum Master'), () => 'Scrum Master', 10n];
    expect(notText.map(classifyRoleFamily)).toEqual(Array(notText.length).fill(OTHER_FAMILY));
  });

  scenario('@error a title in a script with no letters a pattern could match falls back to other', () => {
    expect(['敏捷教练', 'Скрам мастер', '🚀🚀🚀'].map(classifyRoleFamily)).toEqual(Array(3).fill(OTHER_FAMILY));
  });

  scenario('@error a very long title carrying a pattern is still classified by it', () => {
    const filler = 'consulting '.repeat(20000);
    expect(classifyRoleFamily(`Agile Coach ${filler}`)).toBe(FamilyName.AGILE_COACH);
    expect(classifyRoleFamily(`${filler} Product Owner`)).toBe(FamilyName.PRODUCT);
  });

  scenario('@error a very long title carrying no pattern falls back to other', () => {
    expect(classifyRoleFamily(`Data Analyst ${'consulting '.repeat(20000)}`)).toBe(OTHER_FAMILY);
  });

  it('@error a pattern never matches inside a longer word', () => {
    // "rail" ends in "ai" but is not the word AI; "mastery" starts with "master" but is not the word master
    expect(classifyRoleFamily('Rail Transformation Lead')).toBe(FamilyName.TRANSFORMATION_CHANGE);
    expect(classifyRoleFamily('Scrum Mastery Facilitator')).toBe(OTHER_FAMILY);
  });

  scenario('the same title always yields the same family', () => {
    const runs = Array.from({ length: 5 }, () => GOLDEN_TITLES.map(({ title }) => classifyRoleFamily(title)));
    expect(runs.every((run) => JSON.stringify(run) === JSON.stringify(runs[0]))).toBe(true);
  });
});

describe('the normaliser reduces a title to the form the matcher sees', () => {
  const NORMALISED = [
    ['Scrum  Master', 'scrum master'],
    ['  Agile—Coach!!  ', 'agile coach'],
    ['Scrum-Master (Contract)', 'scrum master contract'],
    ['AI/ML Lead', 'ai ml lead'],
    ['Café Manager', 'cafe manager'],
    ['Scrüm Mästér', 'scrum master'],
    ['Product Owner 2', 'product owner 2'],
    ['', ''],
    ['!!!', ''],
    ['   ', ''],
  ];
  for (const [title, normalised] of NORMALISED) {
    scenario(`@normalise ${JSON.stringify(title)} reads as ${JSON.stringify(normalised)}`, () => {
      expect(normaliseTitle(title)).toBe(normalised);
    });
  }

  scenario('@error a title that is not text normalises to the empty string without throwing', () => {
    expect([null, undefined, 42, {}, [], Symbol('x')].map(normaliseTitle)).toEqual(Array(6).fill(''));
  });
});

const aJobsRow = (index, title, family) => ({ 'Dedup Key': `linkedin:${index}`, 'Job': title, 'Role Family': family });
const OTHER = FamilyName.OTHER;
const deepFrozen = (rows) => Object.freeze(rows.map((row) => Object.freeze({ ...row })));

describe('the tuning summary tells the operator which titles fell through', () => {
  scenario('@summary it totals the adverts, counts them by family, and lists the most frequent other titles by count then title', () => {
    const rows = [
      aJobsRow(1, 'Data Analyst', OTHER),
      aJobsRow(2, 'Java Developer', OTHER),
      aJobsRow(3, 'Data Analyst', OTHER),
      aJobsRow(4, 'Scrum Master', FamilyName.SCRUM_MASTER),
      aJobsRow(5, 'Registered Nurse', OTHER),
      aJobsRow(6, 'Java Developer', OTHER),
      aJobsRow(7, 'Product Owner', FamilyName.PRODUCT),
      aJobsRow(8, 'Data Analyst', OTHER),
    ];
    const summary = summariseRoleFamilies(deepFrozen(rows), { limit: 15 });
    expect(summary.total).toBe(8);
    expect(summary.byFamily[OTHER]).toBe(6);
    expect(summary.byFamily[FamilyName.SCRUM_MASTER]).toBe(1);
    expect(summary.byFamily[FamilyName.PRODUCT]).toBe(1);
    expect(summary.otherTitles).toEqual([
      { title: 'data analyst', count: 3 },
      { title: 'java developer', count: 2 },
      { title: 'registered nurse', count: 1 },
    ]);
  });

  scenario('@summary it groups titles that differ only in case, punctuation and spacing, and shows the normalised form', () => {
    const rows = [aJobsRow(1, 'Data Analyst', OTHER), aJobsRow(2, 'DATA ANALYST', OTHER), aJobsRow(3, 'data  analyst!', OTHER), aJobsRow(4, 'Data-Analyst (London)', OTHER)];
    expect(summariseRoleFamilies(deepFrozen(rows), { limit: 15 }).otherTitles).toEqual([
      { title: 'data analyst', count: 3 },
      { title: 'data analyst london', count: 1 },
    ]);
  });

  scenario('@summary equal counts are ordered by title, ascending', () => {
    const rows = [aJobsRow(1, 'Zoo Keeper', OTHER), aJobsRow(2, 'Baker', OTHER), aJobsRow(3, 'Mason', OTHER), aJobsRow(4, 'Cooper', OTHER)];
    expect(summariseRoleFamilies(deepFrozen(rows), { limit: 15 }).otherTitles.map((entry) => entry.title)).toEqual(['baker', 'cooper', 'mason', 'zoo keeper']);
  });

  scenario('@summary it shows at most the limit, keeping the most frequent', () => {
    const titles = ['Baker', 'Baker', 'Baker', 'Cooper', 'Cooper', 'Mason', 'Zoo Keeper'];
    const rows = titles.map((title, index) => aJobsRow(index, title, OTHER));
    const summary = summariseRoleFamilies(deepFrozen(rows), { limit: 2 });
    expect(summary.otherTitles).toEqual([
      { title: 'baker', count: 3 },
      { title: 'cooper', count: 2 },
    ]);
    expect(summary.total).toBe(7);
    expect(summary.byFamily[OTHER]).toBe(7);
  });

  scenario('@error @summary a title of a family other than other never appears in the tuning list', () => {
    const rows = [aJobsRow(1, 'Scrum Master', FamilyName.SCRUM_MASTER), aJobsRow(2, 'Data Analyst', OTHER)];
    expect(summariseRoleFamilies(deepFrozen(rows), { limit: 15 }).otherTitles).toEqual([{ title: 'data analyst', count: 1 }]);
  });

  scenario('@error @summary no adverts at all is a summary of nothing, not a failure', () => {
    const summary = summariseRoleFamilies([], { limit: 15 });
    expect(summary.total).toBe(0);
    expect(summary.otherTitles).toEqual([]);
    expect(Object.values(summary.byFamily).reduce((sum, count) => sum + count, 0)).toBe(0);
  });

  scenario('@error @summary a limit of zero lists no titles but still counts', () => {
    const summary = summariseRoleFamilies(deepFrozen([aJobsRow(1, 'Data Analyst', OTHER)]), { limit: 0 });
    expect(summary.otherTitles).toEqual([]);
    expect(summary.byFamily[OTHER]).toBe(1);
  });

  scenario('@error @summary adverts that all have a family give an empty tuning list', () => {
    const rows = [aJobsRow(1, 'Scrum Master', FamilyName.SCRUM_MASTER), aJobsRow(2, 'Product Owner', FamilyName.PRODUCT)];
    const summary = summariseRoleFamilies(deepFrozen(rows), { limit: 15 });
    expect(summary.otherTitles).toEqual([]);
    expect(summary.byFamily[OTHER] ?? 0).toBe(0);
  });

  scenario('@error @summary the rows it is handed are left exactly as they were', () => {
    const rows = deepFrozen([aJobsRow(1, 'Data Analyst', OTHER), aJobsRow(2, 'Scrum Master', FamilyName.SCRUM_MASTER)]);
    const before = JSON.stringify(rows);
    summariseRoleFamilies(rows, { limit: 15 });
    expect(JSON.stringify(rows)).toBe(before);
  });
});
