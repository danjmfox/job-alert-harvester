// PURE. RED scaffold (created by DISTILL for search-yield-summary, DR-0015): signatures and constants only.
// The per-search summary and its stderr formatter are DELIVER's. Both behavioural functions throw, so an unskipped
// scenario classifies as RED, not BROKEN. `harvest()` and the CLI do not call this module yet.
export const __SCAFFOLD__ = true;

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

/**
 * @param {{ searchTerm: string | null, dedupKey: string, seenAt: string }[]} sightings one per advert card in one alert message
 * @param {{ dedupKey: string, title: string }[]} adverts one per distinct dedupKey, titled by its first sighting
 * @returns {{ allTime: YieldBlock | null, recent: YieldBlock | null }} a block is null when it is not to be printed
 * @typedef {{ scope: 'all' | 'recent', endDate?: string, searches: { search: string, found: number, other: number, onTarget: number, unique: number }[], unparsed: { found: number, other: number, onTarget: number } | null, total: { found: number, other: number, onTarget: number } }} YieldBlock
 */
export function summariseSearchYield(sightings, adverts) {
  return notImplemented('summariseSearchYield');
}

/** @param {ReturnType<typeof summariseSearchYield>} searchYield @returns {string[]} stderr lines; empty when both blocks are null */
export function formatSearchYield(searchYield) {
  return notImplemented('formatSearchYield');
}
