// @contract-shape:pure-function
// DR-0014 as properties of the pure classifier and tuning summary (layers 1 and 2 only: fast-check never reaches a
// subprocess). Totality and determinism, normalisation, the table's priority, the fallback, and the whole-word rule
// are stated against an oracle that restates the DESIGN's definition independently of src/ (support/oracle.mjs).
// Each property first pins the ratified family names and order, so a scaffold with an empty table fails as RED.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ROLE_FAMILIES, classifyRoleFamily, normaliseTitle, summariseRoleFamilies } from '../../../src/core/role-families.mjs';
import { CLOSED_FAMILY_SET, FAMILY_PRIORITY_ORDER, FamilyName } from './support/family-names.mjs';
import { GOLDEN_TITLES } from './support/golden-titles.mjs';
import { classifiedPerDesign, matchingDescriptors } from './support/oracle.mjs';
import { holds } from './support/property.mjs';
import { scenario } from './support/red-gate.mjs';

const theRatifiedTable = () => {
  expect(ROLE_FAMILIES.map((descriptor) => descriptor.family)).toEqual(FAMILY_PRIORITY_ORDER);
  return ROLE_FAMILIES;
};

const NOISE_WORDS = ['data', 'analyst', 'java', 'developer', 'warehouse', 'operative', 'nurse', 'baker', 'mason', 'driver', 'chef', 'marketing', 'executive', 'consulting', 'london', 'remote', 'contract', 'senior', 'junior'];
const SEPARATORS = [' ', '  ', '\t', ' - ', '-', ' / ', ', ', ' (', ') ', ' | ', ' '];
const CASINGS = [(text) => text, (text) => text.toUpperCase(), (text) => text.toLowerCase(), (text) => text.replace(/\b\w/g, (letter) => letter.toUpperCase())];
const TRAILERS = ['', '.', '!', '...', ' -', ',,', ' ?!', ' )', ' /'];
const LEADERS = ['', '  ', '- ', '"', '(', '\t'];

const casing = fc.constantFrom(...CASINGS);
const separator = fc.constantFrom(...SEPARATORS);
const noiseWord = fc.constantFrom(...NOISE_WORDS);

/** Words joined by separators, then cased: the shapes a real title takes. */
const titleOf = (pieces, separators, apply) => apply(pieces.map((piece, index) => (index === 0 ? piece : `${separators[index % separators.length]}${piece}`)).join(''));

describe('@property the classifier is total and deterministic', () => {
  it('@property every string, and anything that is not a string, yields exactly one family of the closed set and never throws', () => {
    theRatifiedTable();
    holds(
      fc.property(fc.oneof(fc.string(), fc.string({ unit: 'binary' }), fc.string({ unit: 'grapheme' }), fc.anything()), (title) => {
        expect(CLOSED_FAMILY_SET).toContain(classifyRoleFamily(title));
      }),
    );
  });

  it('@property the same input always yields the same family', () => {
    theRatifiedTable();
    holds(fc.property(fc.oneof(fc.string(), fc.constantFrom(...GOLDEN_TITLES.map(({ title }) => title))), (title) => classifyRoleFamily(title) === classifyRoleFamily(title)));
  });

  it('@property a very long title is classified, whatever its length', () => {
    theRatifiedTable();
    holds(
      fc.property(fc.string({ minLength: 5000, maxLength: 20000 }), (title) => {
        expect(CLOSED_FAMILY_SET).toContain(classifyRoleFamily(title));
      }),
      { numRuns: 20 },
    );
  });
});

describe('@property the normaliser reduces every title to one canonical form', () => {
  it('@property normalising twice is normalising once', () => {
    holds(fc.property(fc.oneof(fc.string(), fc.string({ unit: 'binary' })), (title) => normaliseTitle(normaliseTitle(title)) === normaliseTitle(title)));
  });

  it('@property a normalised title holds only lower-case letters and digits, single-spaced, with no space at either end', () => {
    holds(
      fc.property(fc.oneof(fc.string(), fc.string({ unit: 'binary' })), (title) => {
        expect(normaliseTitle(title)).toMatch(/^(?:[a-z0-9]+(?: [a-z0-9]+)*)?$/);
      }),
    );
  });

  it('@property case, repeated whitespace, separators and trailing punctuation never change the family of a golden title', () => {
    theRatifiedTable();
    const variant = fc.record({ golden: fc.constantFrom(...GOLDEN_TITLES), apply: casing, spacer: separator, leader: fc.constantFrom(...LEADERS), trailer: fc.constantFrom(...TRAILERS) });
    holds(
      fc.property(variant, ({ golden, apply, spacer, leader, trailer }) => {
        const title = `${leader}${apply(golden.title.split(' ').join(spacer))}${trailer}`;
        expect(classifyRoleFamily(title)).toBe(golden.family);
        expect(normaliseTitle(title)).toBe(normaliseTitle(golden.title));
      }),
    );
  });

  it('@property accents on vowels never change the family of a golden title', () => {
    theRatifiedTable();
    const accented = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú' };
    holds(
      fc.property(fc.constantFrom(...GOLDEN_TITLES), fc.constantFrom(...Object.keys(accented)), (golden, vowel) => {
        const title = golden.title.replaceAll(vowel, accented[vowel]);
        expect(classifyRoleFamily(title)).toBe(golden.family);
      }),
    );
  });
});

describe('@property the order of the table is the priority', () => {
  it('@property a title holding a phrase of two descriptors takes the earlier descriptor, never the later', () => {
    const table = theRatifiedTable();
    const phrases = table.flatMap((descriptor, index) => descriptor.patterns.map((pattern) => ({ index, pattern })));
    holds(
      fc.property(fc.constantFrom(...phrases), fc.constantFrom(...phrases), fc.array(noiseWord, { maxLength: 2 }), separator, casing, (first, second, noise, spacer, apply) => {
        const title = titleOf([...noise, first.pattern, second.pattern], [spacer], apply);
        const earliest = Math.min(first.index, second.index);
        const [winner] = matchingDescriptors(table, title);
        expect(winner).toBeLessThanOrEqual(earliest);
        expect(classifyRoleFamily(title)).toBe(table[winner].family);
      }),
    );
  });

  it('@property classification equals first-matching-descriptor on whole words, for titles built from the table and from noise', () => {
    const table = theRatifiedTable();
    const everyPattern = table.flatMap((descriptor) => descriptor.patterns);
    const piece = fc.oneof(fc.constantFrom(...everyPattern), noiseWord);
    holds(
      fc.property(fc.array(piece, { minLength: 1, maxLength: 5 }), fc.array(separator, { minLength: 1, maxLength: 3 }), casing, (pieces, spacers, apply) => {
        const title = titleOf(pieces, spacers, apply);
        expect(classifyRoleFamily(title)).toBe(classifiedPerDesign(table, title));
      }),
    );
  });

  it('@property @error gluing letters onto a pattern word stops it matching: only whole words count', () => {
    const table = theRatifiedTable();
    const everyPattern = table.flatMap((descriptor) => descriptor.patterns);
    holds(
      fc.property(fc.constantFrom(...everyPattern), fc.constantFrom('x', 'zz', 'ing', '2'), fc.boolean(), (pattern, glue, atStart) => {
        const title = atStart ? `${glue}${pattern}` : `${pattern}${glue}`;
        expect(classifyRoleFamily(title)).toBe(classifiedPerDesign(table, title));
      }),
    );
  });
});

describe('@property a title no pattern matches is other', () => {
  it('@property @error a title of noise words alone is other', () => {
    const table = theRatifiedTable();
    holds(
      fc.property(fc.array(noiseWord, { minLength: 1, maxLength: 6 }), fc.array(separator, { minLength: 1, maxLength: 3 }), casing, (words, spacers, apply) => {
        const title = titleOf(words, spacers, apply);
        expect(matchingDescriptors(table, title)).toEqual([]);
        expect(classifyRoleFamily(title)).toBe(FamilyName.OTHER);
      }),
    );
  });

  it('@property @error a title with no letters or digits is other', () => {
    theRatifiedTable();
    holds(fc.property(fc.stringMatching(/^[ \t\-_.,;:!?()\/\\|*+#@&%$^~`'"<>=]*$/), (title) => classifyRoleFamily(title) === FamilyName.OTHER));
  });
});

describe('@property no pattern is shadowed: every pattern is reachable by some title', () => {
  it('@property a title that is a pattern, with noise either side, is classified into that pattern\'s own family', () => {
    const table = theRatifiedTable();
    const owned = table.flatMap((descriptor) => descriptor.patterns.map((pattern) => ({ family: descriptor.family, pattern })));
    holds(
      fc.property(fc.constantFrom(...owned), fc.array(noiseWord, { maxLength: 2 }), fc.array(noiseWord, { maxLength: 2 }), separator, casing, ({ family, pattern }, before, after, spacer, apply) => {
        const title = titleOf([...before, pattern, ...after], [spacer], apply);
        expect(classifyRoleFamily(title)).toBe(family);
      }),
    );
  });
});

describe('@property the tuning summary is consistent with the adverts it summarises', () => {
  const rowsFrom = (entries) => Object.freeze(entries.map(({ title, family }, index) => Object.freeze({ 'Dedup Key': `linkedin:${index}`, 'Job': title, 'Role Family': family })));
  const anyGoldenOrNoise = fc.oneof(
    fc.constantFrom(...GOLDEN_TITLES).map(({ title, family }) => ({ title, family })),
    fc.tuple(fc.array(noiseWord, { minLength: 1, maxLength: 3 }), casing).map(([words, apply]) => ({ title: apply(words.join(' ')), family: FamilyName.OTHER })),
  );

  scenario('@property the family counts add up to the total, and the other count is the number of other adverts', () => {
    holds(
      fc.property(fc.array(anyGoldenOrNoise, { maxLength: 40 }), fc.integer({ min: 0, max: 20 }), (entries, limit) => {
        const summary = summariseRoleFamilies(rowsFrom(entries), { limit });
        expect(summary.total).toBe(entries.length);
        expect(Object.values(summary.byFamily).reduce((sum, count) => sum + count, 0)).toBe(entries.length);
        expect(summary.byFamily[FamilyName.OTHER] ?? 0).toBe(entries.filter((entry) => entry.family === FamilyName.OTHER).length);
      }),
    );
  });

  scenario('@property the tuning list holds at most the limit, is ordered by count then title, and never counts more adverts than fell through', () => {
    holds(
      fc.property(fc.array(anyGoldenOrNoise, { maxLength: 40 }), fc.integer({ min: 0, max: 20 }), (entries, limit) => {
        const { otherTitles, byFamily } = summariseRoleFamilies(rowsFrom(entries), { limit });
        expect(otherTitles.length).toBeLessThanOrEqual(limit);
        otherTitles.slice(1).forEach((entry, index) => {
          const previous = otherTitles[index];
          expect(previous.count > entry.count || (previous.count === entry.count && previous.title < entry.title)).toBe(true);
        });
        expect(otherTitles.reduce((sum, entry) => sum + entry.count, 0)).toBeLessThanOrEqual(byFamily[FamilyName.OTHER] ?? 0);
        expect(new Set(otherTitles.map((entry) => entry.title)).size).toBe(otherTitles.length);
        expect(otherTitles.every((entry) => entry.title === normaliseTitle(entry.title))).toBe(true);
      }),
    );
  });

  scenario('@property with room for every title the list accounts for every advert that fell through', () => {
    holds(
      fc.property(fc.array(anyGoldenOrNoise, { maxLength: 40 }), (entries) => {
        const { otherTitles, byFamily } = summariseRoleFamilies(rowsFrom(entries), { limit: 1000 });
        expect(otherTitles.reduce((sum, entry) => sum + entry.count, 0)).toBe(byFamily[FamilyName.OTHER] ?? 0);
      }),
    );
  });

  scenario('@property the order of the adverts never changes the summary', () => {
    holds(
      fc.property(fc.array(anyGoldenOrNoise, { maxLength: 30 }), (entries) => {
        const forwards = summariseRoleFamilies(rowsFrom(entries), { limit: 15 });
        const backwards = summariseRoleFamilies(rowsFrom([...entries].reverse()), { limit: 15 });
        expect(backwards).toEqual(forwards);
      }),
    );
  });
});
