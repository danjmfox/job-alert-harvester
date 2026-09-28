// PURE. A UTC-day window -> the Gmail search query that selects exactly it.
//
// Gmail's `after:`/`before:` accept calendar dates, but interprets them in the
// account's timezone, while the cache windows by the UTC day of each message
// (DR-0002). Epoch seconds sidestep that: they are absolute, so the query
// boundary and the cache boundary are the same instant.

const ISO_CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
const SECONDS_PER_DAY = 86400;

const epochSecondsAtUtcMidnight = (isoDay) => Date.parse(`${isoDay}T00:00:00Z`) / 1000;

const assertCalendarDay = (value, label) => {
  if (!ISO_CALENDAR_DAY.test(value) || !Number.isFinite(epochSecondsAtUtcMidnight(value))) {
    throw new Error(`gmailWindowQuery: ${label} must be an ISO calendar day, got ${JSON.stringify(value)}`);
  }
};

/**
 * @param {{ from: string, to: string }} window inclusive UTC calendar days
 * @param {{ sender: string }} options
 * @returns {string} a Gmail query bounded at UTC midnight either side
 */
export function gmailWindowQuery(window, { sender } = {}) {
  if (!sender) {
    throw new Error('gmailWindowQuery: a sender is required — an unbounded query would read the whole mailbox');
  }
  assertCalendarDay(window.from, 'from');
  assertCalendarDay(window.to, 'to');
  if (window.to < window.from) {
    throw new Error(`gmailWindowQuery: to must not precede from, got ${window.from}..${window.to}`);
  }

  const after = epochSecondsAtUtcMidnight(window.from);
  // `before` is midnight of the day after `to`, so `to` itself is included.
  const before = epochSecondsAtUtcMidnight(window.to) + SECONDS_PER_DAY;
  return `from:${sender} after:${after} before:${before}`;
}
