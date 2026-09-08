// PURE. Interval algebra over harvested windows (DR-0002).
// Coverage records what was *searched to completion*; it is never derived from
// what the cache happens to hold.
//
// RED scaffold — created by DISTILL. Signatures are the contract; bodies are not.

export const __SCAFFOLD__ = true;

const notImplemented = (name) => {
  throw new Error(`${name}: Not yet implemented — RED scaffold`);
};

/** A closed interval: { source, from, to, completedAt, messageCount }. */
export const CoverageRefusal = Object.freeze({
  INVERTED_INTERVAL: 'coverage.interval.inverted',
});

/** Sort, collapse overlapping intervals, and join day-adjacent ones. */
export function mergeIntervals(_intervals) {
  return notImplemented('mergeIntervals');
}

/** The parts of `window` that no interval covers, in ascending order. */
export function subtractCoverage(_window, _intervals) {
  return notImplemented('subtractCoverage');
}

/** The first uncovered sub-window of `request`, or null when fully covered. */
export function nextUncoveredWindow(_request, _intervals) {
  return notImplemented('nextUncoveredWindow');
}

/** Throws with CoverageRefusal.INVERTED_INTERVAL when `to` precedes `from`. */
export function validateInterval(_interval) {
  return notImplemented('validateInterval');
}
