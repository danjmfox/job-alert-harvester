// PURE. The planning and summarising halves of `harvest update` (DR-0016): the range to fetch, what follows the fetch,
// and the closing lines and exit status of an outcome.
import { clampToSettledDays, mergeIntervals, subtractCoverage } from './coverage.mjs';

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

const utcDayOf = (nowIso) => new Date(nowIso).toISOString().slice(0, 10);

const laterOf = (day, otherDay) => (day > otherDay ? day : otherDay);

const earliestCoveredDay = (ledgerIntervals, source) => mergeIntervals(ledgerIntervals.filter((interval) => interval.source === source))[0]?.from;

const STAGE = Object.freeze({ FETCH: 'fetch', BUILD: 'build' });
const NOTHING_NEW_LINE = 'harvest update: nothing new from Gmail';
const KEEPS_THE_FETCH = '; the fetch is kept, run update again';
const summaryLine = (days) => `harvest update: complete, fetched ${days} day(s), built the Sheet`;

const failureOf = ({ fetch, build }) => {
  if (!fetch.ok) return { stage: STAGE.FETCH, ...fetch };
  if (build !== null && !build.ok) return { stage: STAGE.BUILD, ...build };
  return null;
};

const stoppedAt = (code) => (code === null ? ' stopped' : ` stopped at ${code}`);

const withDetail = (detail) => (detail === '' ? '' : `: ${detail}`);

const stageFailedLine = ({ stage, code, detail }) =>
  `${UpdateRefusal.STAGE_FAILED}: ${stage}${stoppedAt(code)}${withDetail(detail)}${stage === STAGE.BUILD ? KEEPS_THE_FETCH : ''}`;

const succeeded = (fetch) => ({ stdout: [...newsAboutFetch(fetch), summaryLine(fetch.windowsCommitted)], stderr: [], status: 0 });

const failed = (failure) => ({ stdout: [], stderr: [stageFailedLine(failure)], status: 1 });

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
  return fetchResult.ok ? Next.BUILD : Next.STOP;
}

/**
 * @param {FetchResult} fetchResult
 * @returns {string[]} the stdout lines owed once the fetch is done, before the build's own output: the nothing-new line when a successful fetch committed no window, else none
 */
export function newsAboutFetch(fetchResult) {
  return fetchResult.ok && fetchResult.windowsCommitted === 0 ? [NOTHING_NEW_LINE] : [];
}

/**
 * @param {{ fetch: FetchResult, build: { ok: true } | { ok: false, code: string | null, detail: string } | null }} outcome `build` is null when the fetch failed
 * @returns {{ stdout: string[], stderr: string[], status: 0 | 1 }} status 0 only when both stages succeeded; a failure's last stderr line is its `update.stage-failed` line
 * @typedef {{ ok: true, windowsCommitted: number } | { ok: false, code: string | null, detail: string, windowsCommitted?: number }} FetchResult
 */
export function summariseUpdate(outcome) {
  const failure = failureOf(outcome);
  return failure === null ? succeeded(outcome.fetch) : failed(failure);
}

const daysIn = ({ from, to }) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

const uncoveredDaysWithin = (range, ledgerIntervals, source) =>
  subtractCoverage(range, ledgerIntervals.filter((interval) => interval.source === source)).reduce((total, gap) => total + daysIn(gap), 0);

/**
 * @param {{ source: string, from: string, to: string, completedAt: string, messageCount: number }[]} ledgerIntervals every interval the ledger holds
 * @param {string} source the source id whose coverage counts
 * @param {string} nowIso the clock's instant, ISO 8601 UTC
 * @param {string | undefined} fromOverride `--from`, a calendar day, already validated
 * @returns {{ from: string, to: string, uncoveredDays: number } | { refusal: 'update.no-baseline' }} `to` clamped to settled days; zero uncovered days when nothing has settled since `from`
 */
export function previewUpdateRange(ledgerIntervals, source, nowIso, fromOverride) {
  const plan = planUpdateRange(ledgerIntervals, source, nowIso, fromOverride);
  if (plan.refusal !== undefined) return plan;
  const settled = clampToSettledDays(plan, nowIso);
  return settled === null ? { ...plan, uncoveredDays: 0 } : { ...settled, uncoveredDays: uncoveredDaysWithin(settled, ledgerIntervals, source) };
}

/** The stdout line that opens a `harvest update --dry-run`. */
export const dryRunLine = ({ from, to, uncoveredDays }) => `harvest update --dry-run: would fetch ${from}..${to}, ${uncoveredDays} uncovered day(s)`;
