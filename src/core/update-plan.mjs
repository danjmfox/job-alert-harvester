// PURE. RED scaffold (created by DISTILL for update-subcommand, DR-0016): signatures and constants only.
// Range choice, the post-fetch decision and the summary are DELIVER's. Each behavioural function throws, so an unskipped
// scenario classifies as RED, not BROKEN. `harvest.mjs` does not import this module yet.
export const __SCAFFOLD__ = true;
import { mergeIntervals } from './coverage.mjs';

/** The refusal codes `update` names (DR-0016 decision 2, Q-f and Q-g). */
export const UpdateRefusal = Object.freeze({
  NO_BASELINE: 'update.no-baseline',
  STAGE_FAILED: 'update.stage-failed',
  ALREADY_RUNNING: 'update.already-running',
});

/** What happens after the fetch stage (DR-0016 decisions 4 and 5). */
export const Next = Object.freeze({
  BUILD: 'build',
  STOP: 'stop',
});

const notImplemented = (name) => {
  throw new Error(`RED scaffold: ${name} is not implemented`);
};

const utcDayOf = (nowIso) => new Date(nowIso).toISOString().slice(0, 10);

const laterOf = (day, otherDay) => (day > otherDay ? day : otherDay);

const earliestCoveredDay = (ledgerIntervals, source) => mergeIntervals(ledgerIntervals.filter((interval) => interval.source === source))[0]?.from;

/**
 * @param {{ source: string, from: string, to: string, completedAt: string, messageCount: number }[]} ledgerIntervals every interval the ledger holds
 * @param {string} source the source id whose coverage counts (intervals of other sources are ignored)
 * @param {string} nowIso the clock's instant, ISO 8601 UTC
 * @param {string | undefined} fromOverride `--from`, a calendar day, already validated
 * @returns {{ from: string, to: string } | { refusal: 'update.no-baseline' }} `to` is the UTC day of `nowIso` (never before `from`); the fetch stage clamps it to settled days
 */
export function planUpdateRange(ledgerIntervals, source, nowIso, fromOverride) {
  const start = fromOverride ?? earliestCoveredDay(ledgerIntervals, source);
  if (start === undefined) return { refusal: UpdateRefusal.NO_BASELINE };
  return { from: start, to: laterOf(utcDayOf(nowIso), start) };
}

/**
 * @param {{ ok: true, windowsCommitted: number } | { ok: false, code: string | null, detail: string, windowsCommitted?: number }} fetchResult
 * @returns {'build' | 'stop'} BUILD for every successful fetch, even one that committed no window; STOP for every failure
 */
export function decideAfterFetch(fetchResult) {
  return notImplemented('decideAfterFetch');
}

/**
 * @param {{ fetch: FetchResult, build: { ok: true } | { ok: false, code: string | null, detail: string } | null }} outcome `build` is null when the fetch failed
 * @returns {{ stdout: string[], stderr: string[], status: 0 | 1 }} status 0 only when both stages succeeded; a failure's last stderr line is its `update.stage-failed` line
 * @typedef {{ ok: true, windowsCommitted: number } | { ok: false, code: string | null, detail: string, windowsCommitted?: number }} FetchResult
 */
export function summariseUpdate(outcome) {
  return notImplemented('summariseUpdate');
}
