// The DESIGN's definition of classification restated as an oracle for the properties (Hebert: modelling).
// DESIGN Q4: lower-case; fold accents (NFKD, strip combining marks); collapse every run outside a-z0-9 to one
// space; trim. A pattern matches when its words are a contiguous run of whole words of the normalised title.
// First descriptor with a matching pattern wins; otherwise `other`. Deliberately independent of src/.

import { FamilyName } from './family-names.mjs';

export const normalisedPerDesign = (title) =>
  typeof title === 'string' ? title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() : '';

export const wordsOf = (text) => normalisedPerDesign(text).split(' ').filter(Boolean);

/** True when `phrase`'s words appear as a contiguous run of `words`. */
export const containsRun = (words, phrase) => {
  const wanted = phrase.split(' ').filter(Boolean);
  if (wanted.length === 0) return false;
  for (let start = 0; start + wanted.length <= words.length; start += 1) {
    if (wanted.every((word, offset) => words[start + offset] === word)) return true;
  }
  return false;
};

/** Indexes of every descriptor with a pattern in the title, ascending. */
export const matchingDescriptors = (table, title) => {
  const words = wordsOf(title);
  return table.map((descriptor, index) => (descriptor.patterns.some((pattern) => containsRun(words, pattern)) ? index : -1)).filter((index) => index >= 0);
};

export const classifiedPerDesign = (table, title) => {
  const [first] = matchingDescriptors(table, title);
  return first === undefined ? FamilyName.OTHER : table[first].family;
};
