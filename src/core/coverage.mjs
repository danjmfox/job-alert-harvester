// PURE. Interval algebra over harvested windows (DR-0002).
// Coverage records what was *searched to completion*; it is never derived from
// what the cache happens to hold.

/** A closed interval: { source, from, to, completedAt, messageCount }. */
export const CoverageRefusal = Object.freeze({
  INVERTED_INTERVAL: 'coverage.interval.inverted',
});

const MILLISECONDS_PER_DAY = 86_400_000;

// Day arithmetic over ISO `YYYY-MM-DD` strings, computed in UTC so neither the
// host timezone nor Date mutation can shift a boundary by a day.
const toEpochDay = (isoDate) => {
  const [year, month, day] = isoDate.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / MILLISECONDS_PER_DAY;
};

const fromEpochDay = (epochDay) => {
  const date = new Date(epochDay * MILLISECONDS_PER_DAY);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const refuse = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};

/** Throws with CoverageRefusal.INVERTED_INTERVAL when `to` precedes `from`. */
export function validateInterval(interval) {
  if (toEpochDay(interval.to) < toEpochDay(interval.from)) {
    refuse(CoverageRefusal.INVERTED_INTERVAL);
  }
}

const byFromAscending = (a, b) => toEpochDay(a.from) - toEpochDay(b.from);

/** True when `next` overlaps or sits exactly one day after `current` ends. */
const isAdjacentOrOverlapping = (current, next) => toEpochDay(next.from) <= toEpochDay(current.to) + 1;

const mergeTwo = (current, next) => ({
  ...current,
  to: fromEpochDay(Math.max(toEpochDay(current.to), toEpochDay(next.to))),
  messageCount: current.messageCount + next.messageCount,
});

/** Sort, collapse overlapping intervals, and join day-adjacent ones. */
export function mergeIntervals(intervals) {
  const sorted = [...intervals].sort(byFromAscending);

  return sorted.reduce((merged, interval) => {
    const last = merged[merged.length - 1];
    if (last && isAdjacentOrOverlapping(last, interval)) {
      return [...merged.slice(0, -1), mergeTwo(last, interval)];
    }
    return [...merged, interval];
  }, []);
}

/** The parts of `window` that no interval covers, in ascending order. */
export function subtractCoverage(window, intervals) {
  const covering = mergeIntervals(intervals)
    .filter((interval) => toEpochDay(interval.to) >= toEpochDay(window.from) && toEpochDay(interval.from) <= toEpochDay(window.to))
    .sort(byFromAscending);

  const gaps = [];
  let cursor = toEpochDay(window.from);
  const windowEnd = toEpochDay(window.to);

  for (const interval of covering) {
    const intervalStart = toEpochDay(interval.from);
    const intervalEnd = toEpochDay(interval.to);
    if (intervalStart > cursor) {
      gaps.push({ from: fromEpochDay(cursor), to: fromEpochDay(Math.min(intervalStart - 1, windowEnd)) });
    }
    cursor = Math.max(cursor, intervalEnd + 1);
    if (cursor > windowEnd) break;
  }

  if (cursor <= windowEnd) {
    gaps.push({ from: fromEpochDay(cursor), to: fromEpochDay(windowEnd) });
  }

  return gaps;
}

/** The first uncovered sub-window of `request`, or null when fully covered. */
export function nextUncoveredWindow(request, intervals) {
  const [firstGap] = subtractCoverage(request, intervals);
  return firstGap ?? null;
}

/** The earliest uncovered UTC day within `request`, or null when fully covered (DR-0002 amendment). */
export function nextUncoveredDay(request, intervals) {
  const firstGap = nextUncoveredWindow(request, intervals);
  return firstGap === null ? null : { from: firstGap.from, to: firstGap.from };
}
