// Orchestration of `harvest update` (DR-0016): plan, fetch, decide, build, summarise. Stages and clock arrive as arguments.
import { LockRefusal } from '../adapters/run-lock.mjs';
import { Next, UpdateRefusal, decideAfterFetch, dryRunLine, newsAboutFetch, planUpdateRange, previewUpdateRange, summariseUpdate } from '../core/update-plan.mjs';

const NO_BASELINE_GUIDANCE = 'no fetched days to start from; run harvest fetch --from <day> first';
const ALREADY_RUNNING_GUIDANCE = 'another update holds .cache/update.lock; wait for it to finish';
const LOCK_STAGE = 'lock';

const refuse = (code, guidance) => {
  throw Object.assign(new Error(guidance === undefined ? code : `${code}: ${guidance}`), { code });
};

const withoutLeadingCode = (message, code) => (code && message.startsWith(`${code}: `) ? message.slice(code.length + 2) : message);

const failureOf = (error) => ({ ok: false, code: error?.code ?? null, detail: withoutLeadingCode(String(error?.message ?? error), error?.code) });

const attempt = async (stage, argument) => {
  try {
    return { ok: true, ...(await stage(argument)) };
  } catch (error) {
    return failureOf(error);
  }
};

const orRefuse = (plan) => (plan.refusal === undefined ? plan : refuse(plan.refusal, plan.refusal === UpdateRefusal.NO_BASELINE ? NO_BASELINE_GUIDANCE : undefined));

const planOrRefuse = (ledgerIntervals, source, nowIso, fromOverride) => orRefuse(planUpdateRange(ledgerIntervals, source, nowIso, fromOverride));

// The ledger is the fetch's coverage record: failing to read it is the fetch stage's failure.
const fetchOutcome = async ({ readLedger, options, source, now, fetchStage }) => {
  const ledger = await attempt(() => ({ intervals: readLedger() }));
  if (!ledger.ok) return ledger;
  const { from, to } = planOrRefuse(ledger.intervals, source, now(), options.from);
  return attempt(fetchStage, { source, from, to });
};

const takeLock = (lock) => {
  try {
    lock.probe();
    return lock.acquire();
  } catch (error) {
    if (error?.code === LockRefusal.HELD) refuse(UpdateRefusal.ALREADY_RUNNING, ALREADY_RUNNING_GUIDANCE);
    throw Object.assign(new Error(`${UpdateRefusal.STAGE_FAILED}: ${LOCK_STAGE} stopped at ${error?.code ?? 'unknown'}`), { code: UpdateRefusal.STAGE_FAILED });
  }
};

const raiseStderr = (lines) => {
  throw Object.assign(new Error(lines.join('\n')), { code: UpdateRefusal.STAGE_FAILED });
};

/**
 * @param {{ options: { from?: string }, source: string, now: () => string, readLedger: () => object[],
 *           lock: { probe: () => void, acquire: () => () => void },
 *           fetchStage: (range: { source: string, from: string, to: string }) => Promise<{ windowsCommitted: number }>,
 *           buildStage: (options: { flags: Set<string> }) => Promise<unknown>, print: (line: string) => void }} capabilities
 * @returns {Promise<{ windowsCommitted: number }>} a failed stage is thrown as the `update.stage-failed` line
 */
export async function runUpdate({ options, source, now, readLedger, lock, fetchStage, buildStage, print }) {
  const release = takeLock(lock);
  try {
    const fetch = await fetchOutcome({ readLedger, options, source, now, fetchStage });
    newsAboutFetch(fetch).forEach(print);
    const build = decideAfterFetch(fetch) === Next.BUILD ? await attempt(buildStage, { flags: new Set() }) : null;
    const { stdout, stderr, status } = summariseUpdate({ fetch, build });
    stdout.slice(newsAboutFetch(fetch).length).forEach(print);
    if (status !== 0) raiseStderr(stderr);
    return { windowsCommitted: fetch.windowsCommitted };
  } finally {
    release();
  }
}

/**
 * The preview of `harvest update --dry-run`: it is handed no fetch capability, so it cannot fetch.
 * @param {{ options: { from?: string }, source: string, now: () => string, readLedger: () => object[],
 *           buildStage: (options: { flags: Set<string> }) => Promise<unknown>, print: (line: string) => void }} capabilities
 */
export async function runUpdatePreview({ options, source, now, readLedger, buildStage, print }) {
  const preview = orRefuse(previewUpdateRange(readLedger(), source, now(), options.from));
  print(dryRunLine(preview));
  await buildStage({ flags: new Set(['dry-run']) });
}
