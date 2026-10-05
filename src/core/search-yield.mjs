// PURE. RED scaffold (created by DISTILL for search-yield-summary, DR-0015): signatures and constants only.
// The per-search summary and its stderr formatter are DELIVER's. Both behavioural functions throw, so an unskipped
// scenario classifies as RED, not BROKEN. `harvest()` and the CLI do not call this module yet.
export const __SCAFFOLD__ = true;

import { OTHER_FAMILY, classifyRoleFamily } from './role-families.mjs';

/** The recent scope: this many calendar dates ending at the latest sighting date in the cache. */
export const YIELD_WINDOW_DAYS = 28;
/** The most named searches a printed block lists; the rest are counted in a "more not shown" line. */
export const YIELD_NAMED_SEARCH_LIMIT = 20;
/** The width of the search column; a longer label is cut to its first width-3 characters plus `...`. */
export const YIELD_LABEL_WIDTH = 40;
/** The label of the row for sightings whose message names no saved search. */
export const UNPARSED_SEARCH_LABEL = '(no search term)';
/** The label of the row counting every distinct advert once. */
export const TOTAL_ROW_LABEL = 'all searches';
/** Shown in the unique column of the rows that are not a named search. */
export const UNIQUE_NOT_SHOWN = '-';

const notImplemented = (name) => {
  throw new Error(`RED scaffold: ${name} is not implemented`);
};

const READABLE_DAY = /^\d{4}-\d{2}-\d{2}/;

const ascending = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const isNamed = (sighting) => typeof sighting.searchTerm === 'string' && sighting.searchTerm !== '';

/** @returns {string | null} the YYYY-MM-DD the sighting happened on, or null when the date cannot be read */
const dayOf = (sighting) => (typeof sighting.seenAt === 'string' && READABLE_DAY.test(sighting.seenAt) ? sighting.seenAt.slice(0, 10) : null);

const shiftDay = (day, delta) => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + delta)).toISOString().slice(0, 10);
};

/** The adverts whose first-sighting title is in a family other than `other`: the family never depends on the scope counted. */
const onTargetAdvertKeys = (adverts) =>
  new Set(adverts.filter(({ title }) => classifyRoleFamily(title) !== OTHER_FAMILY).map(({ dedupKey }) => dedupKey));

const distinctKeys = (sightings) => new Set(sightings.map(({ dedupKey }) => dedupKey));

const figuresOf = (keys, onTargetKeys) => {
  const onTarget = [...keys].filter((key) => onTargetKeys.has(key)).length;
  return { found: keys.size, other: keys.size - onTarget, onTarget };
};

const keysBySearch = (named) =>
  new Map([...new Set(named.map(({ searchTerm }) => searchTerm))].map((search) => [search, distinctKeys(named.filter((sighting) => sighting.searchTerm === search))]));

const searchersPerAdvert = (keysByName) =>
  [...keysByName.values()].flatMap((keys) => [...keys]).reduce((counts, key) => counts.set(key, (counts.get(key) ?? 0) + 1), new Map());

const byFoundThenSearch = (left, right) => right.found - left.found || ascending(left.search, right.search);

const searchRows = (keysByName, onTargetKeys) => {
  const searchers = searchersPerAdvert(keysByName);
  return [...keysByName]
    .map(([search, keys]) => ({
      search,
      ...figuresOf(keys, onTargetKeys),
      unique: [...keys].filter((key) => onTargetKeys.has(key) && searchers.get(key) === 1).length,
    }))
    .sort(byFoundThenSearch);
};

/** @returns {YieldBlock | null} the block for the sightings in one scope; null when fewer than two named searches are in it */
const blockOf = (scopeSightings, onTargetKeys, scopeFields) => {
  const named = scopeSightings.filter(isNamed);
  const keysByName = keysBySearch(named);
  if (keysByName.size < 2) return null;
  const unparsedKeys = distinctKeys(scopeSightings.filter((sighting) => !isNamed(sighting)));
  return {
    ...scopeFields,
    searches: searchRows(keysByName, onTargetKeys),
    unparsed: unparsedKeys.size > 0 ? figuresOf(unparsedKeys, onTargetKeys) : null,
    total: figuresOf(distinctKeys(scopeSightings), onTargetKeys),
  };
};

const recentBlockOf = (sightings, onTargetKeys) => {
  const days = sightings.map(dayOf).filter((day) => day !== null).sort(ascending);
  if (days.length === 0) return null;
  const endDate = days.at(-1);
  const startDate = shiftDay(endDate, -(YIELD_WINDOW_DAYS - 1));
  if (days[0] >= startDate) return null;
  const inWindow = sightings.filter((sighting) => {
    const day = dayOf(sighting);
    return day !== null && day >= startDate && day <= endDate;
  });
  return blockOf(inWindow, onTargetKeys, { scope: 'recent', endDate });
};

/**
 * @param {{ searchTerm: string | null, dedupKey: string, seenAt: string }[]} sightings one per advert card in one alert message
 * @param {{ dedupKey: string, title: string }[]} adverts one per distinct dedupKey, titled by its first sighting
 * @returns {{ allTime: YieldBlock | null, recent: YieldBlock | null }} a block is null when it is not to be printed
 * @typedef {{ scope: 'all' | 'recent', endDate?: string, searches: { search: string, found: number, other: number, onTarget: number, unique: number }[], unparsed: { found: number, other: number, onTarget: number } | null, total: { found: number, other: number, onTarget: number } }} YieldBlock
 */
export function summariseSearchYield(sightings, adverts) {
  const onTargetKeys = onTargetAdvertKeys(adverts);
  return {
    allTime: blockOf(sightings, onTargetKeys, { scope: 'all' }),
    recent: recentBlockOf(sightings, onTargetKeys),
  };
}

/** @param {ReturnType<typeof summariseSearchYield>} searchYield @returns {string[]} stderr lines; empty when both blocks are null */
export function formatSearchYield(searchYield) {
  return notImplemented('formatSearchYield');
}
