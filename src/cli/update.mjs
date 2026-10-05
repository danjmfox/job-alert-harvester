// Orchestration of `harvest update` (DR-0016): plan, fetch, decide, build, summarise. Stages and clock arrive as arguments.
import { Next, UpdateRefusal, decideAfterFetch, dryRunLine, planUpdateRange, previewUpdateRange, summariseUpdate } from '../core/update-plan.mjs';

const NO_BASELINE_GUIDANCE = 'no fetched days to start from; run harvest fetch --from <day> first';

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

// Every stdout line of a good outcome but the last is news about the fetch, owed before the build's own output.
const reportedBeforeBuild = (fetch) => (fetch.ok ? summariseUpdate({ fetch, build: { ok: true } }).stdout.slice(0, -1) : []);

const closingLines = (stdout) => stdout.slice(-1);

const raiseStderr = (lines) => {
  throw Object.assign(new Error(lines.join('\n')), { code: UpdateRefusal.STAGE_FAILED });
};

/**
 * @param {{ options: { from?: string }, source: string, now: () => string, readLedger: () => object[],
 *           fetchStage: (range: { source: string, from: string, to: string }) => Promise<{ windowsCommitted: number }>,
 *           buildStage: (options: { flags: Set<string> }) => Promise<unknown>, print: (line: string) => void }} capabilities
 * @returns {Promise<{ windowsCommitted: number }>} a failed stage is thrown as the `update.stage-failed` line
 */
export async function runUpdate({ options, source, now, readLedger, fetchStage, buildStage, print }) {
  const { from, to } = planOrRefuse(readLedger(), source, now(), options.from);
  const fetch = await attempt(fetchStage, { source, from, to });
  reportedBeforeBuild(fetch).forEach(print);
  const build = decideAfterFetch(fetch) === Next.BUILD ? await attempt(buildStage, { flags: new Set() }) : null;
  const { stdout, stderr, status } = summariseUpdate({ fetch, build });
  closingLines(stdout).forEach(print);
  if (status !== 0) raiseStderr(stderr);
  return { windowsCommitted: fetch.windowsCommitted };
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
