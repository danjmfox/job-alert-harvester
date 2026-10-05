// @contract-shape:pure-function
// The pure core of `harvest update` (DR-0016 decisions 1 to 6): which range a run plans from the ledger and the clock, what
// happens after the fetch, and the exit status and closing lines of an outcome. Layers 1 and 2: in memory, no subprocess,
// no clock read (the instant is an argument). The inputs are the ledger's intervals as `fetch` writes them, so the
// examples use the same shapes. Every scenario first calls the module, so the scaffold's throw fails it as RED.
import { describe, expect, it } from 'vitest';
import { clampToSettledDays } from '../../../src/core/coverage.mjs';
import { Next, UpdateRefusal, decideAfterFetch, planUpdateRange, summariseUpdate } from '../../../src/core/update-plan.mjs';
import { scenario } from './support/red-gate.mjs';
import { KEEPS_THE_FETCH, RUN_AGAIN, STAGE_FAILED_PREFIX, SUMMARY_LINE, summaryLineFor } from './support/update-domain-types.mjs';

const interval = (from, to, source = 'linkedin') => ({ source, from, to, completedAt: '2026-09-01T00:00:00Z', messageCount: 1 });
const NOW = '2026-09-10T07:30:00.000Z';
const deepFreeze = (value) => {
  Object.values(value).forEach((inner) => typeof inner === 'object' && inner !== null && deepFreeze(inner));
  return Object.freeze(value);
};
const last = (lines) => lines[lines.length - 1];

describe('planUpdateRange chooses the range from the ledger and the clock', () => {
  it('the range starts at the earliest covered day and ends today', () => {
    expect(planUpdateRange([interval('2026-09-01', '2026-09-08')], 'linkedin', NOW, undefined)).toEqual({ from: '2026-09-01', to: '2026-09-10' });
  });

  it('@error a ledger with a gap starts at its first interval, not after the gap', () => {
    expect(planUpdateRange([interval('2026-09-05', '2026-09-06'), interval('2026-09-01', '2026-09-02')], 'linkedin', NOW, undefined)).toEqual({ from: '2026-09-01', to: '2026-09-10' });
  });

  it('@error only the named source\'s coverage counts: another source\'s earlier interval is ignored', () => {
    const ledger = [interval('2026-08-01', '2026-08-31', 'glassdoor'), interval('2026-09-05', '2026-09-08')];
    expect(planUpdateRange(ledger, 'linkedin', NOW, undefined)).toEqual({ from: '2026-09-05', to: '2026-09-10' });
  });

  it('@error an empty ledger has no baseline: the plan is the refusal, not a guess', () => {
    expect(planUpdateRange([], 'linkedin', NOW, undefined)).toEqual({ refusal: UpdateRefusal.NO_BASELINE });
  });

  it('@error a ledger that covers only another source has no baseline for this one', () => {
    expect(planUpdateRange([interval('2026-08-01', '2026-08-31', 'glassdoor')], 'linkedin', NOW, undefined)).toEqual({ refusal: UpdateRefusal.NO_BASELINE });
  });

  it('--from overrides the baseline when it is earlier than the first covered day', () => {
    expect(planUpdateRange([interval('2026-09-05', '2026-09-08')], 'linkedin', NOW, '2026-09-01')).toEqual({ from: '2026-09-01', to: '2026-09-10' });
  });

  it('@error --from overrides the baseline when it is later than the first covered day too', () => {
    expect(planUpdateRange([interval('2026-09-01', '2026-09-08')], 'linkedin', NOW, '2026-09-07')).toEqual({ from: '2026-09-07', to: '2026-09-10' });
  });

  it('@error the end is today\'s UTC day at the first second and at the last second of the day', () => {
    const ledger = [interval('2026-09-01', '2026-09-08')];
    expect(planUpdateRange(ledger, 'linkedin', '2026-09-10T00:00:00.000Z', undefined).to).toBe('2026-09-10');
    expect(planUpdateRange(ledger, 'linkedin', '2026-09-10T23:59:59.999Z', undefined).to).toBe('2026-09-10');
  });

  it('@error the end crosses a month, a year and a leap day correctly', () => {
    expect(planUpdateRange([interval('2026-12-01', '2026-12-30')], 'linkedin', '2026-12-31T23:30:00.000Z', undefined).to).toBe('2026-12-31');
    expect(planUpdateRange([interval('2026-12-01', '2026-12-30')], 'linkedin', '2027-01-01T00:30:00.000Z', undefined).to).toBe('2027-01-01');
    expect(planUpdateRange([interval('2028-02-01', '2028-02-28')], 'linkedin', '2028-02-29T12:00:00.000Z', undefined).to).toBe('2028-02-29');
  });

  it('@error a --from later than today is a one-day range that the fetch will clamp away, never an inverted one', () => {
    const plan = planUpdateRange([interval('2026-09-01', '2026-09-08')], 'linkedin', NOW, '2026-09-20');
    expect(plan).toEqual({ from: '2026-09-20', to: '2026-09-20' });
    expect(clampToSettledDays(plan, NOW)).toBeNull();
  });

  it('@error the plan clamps to settled days: nothing later than yesterday is fetched', () => {
    const plan = planUpdateRange([interval('2026-09-01', '2026-09-08')], 'linkedin', NOW, undefined);
    expect(clampToSettledDays(plan, NOW)).toEqual({ from: '2026-09-01', to: '2026-09-09' });
  });

  it('@error it never changes the ledger it is handed, whatever the clock says', () => {
    const ledger = deepFreeze([interval('2026-09-05', '2026-09-08'), interval('2026-09-01', '2026-09-02')]);
    const snapshot = JSON.stringify(ledger);
    planUpdateRange(ledger, 'linkedin', NOW, undefined);
    planUpdateRange(ledger, 'linkedin', '2031-01-01T00:00:00.000Z', undefined);
    expect(JSON.stringify(ledger)).toBe(snapshot);
  });
});

describe('decideAfterFetch decides whether the build runs', () => {
  scenario('a fetch that covered days is followed by the build', () => {
    expect(decideAfterFetch({ ok: true, windowsCommitted: 3 })).toBe(Next.BUILD);
  });

  scenario('@error a fetch that covered no window is still followed by the build, so a build that failed last time heals', () => {
    expect(decideAfterFetch({ ok: true, windowsCommitted: 0 })).toBe(Next.BUILD);
  });

  scenario('@error a fetch that failed stops the update', () => {
    expect(decideAfterFetch({ ok: false, code: 'gmail.quota-exhausted', detail: '' })).toBe(Next.STOP);
  });

  scenario('@error a fetch that failed partway stops the update even though it committed days', () => {
    expect(decideAfterFetch({ ok: false, code: 'gmail.unauthorized', detail: '', windowsCommitted: 2 })).toBe(Next.STOP);
  });

  scenario('@error a failure that carries no code stops the update too', () => {
    expect(decideAfterFetch({ ok: false, code: null, detail: 'the cache is unreadable' })).toBe(Next.STOP);
  });
});

describe('summariseUpdate gives the closing lines and the exit status of an outcome', () => {
  scenario('both stages succeeded: status 0, a closing line on stdout counting the days fetched, nothing on stderr', () => {
    const summary = summariseUpdate({ fetch: { ok: true, windowsCommitted: 2 }, build: { ok: true } });
    expect(summary.status).toBe(0);
    expect(last(summary.stdout)).toBe(summaryLineFor(2));
    expect(summary.stderr).toEqual([]);
  });

  scenario('@error a fetch that covered nothing and a build that succeeded: still status 0, closing line says zero days', () => {
    const summary = summariseUpdate({ fetch: { ok: true, windowsCommitted: 0 }, build: { ok: true } });
    expect(summary.status).toBe(0);
    expect(last(summary.stdout)).toBe(summaryLineFor(0));
  });

  scenario('@error a fetch that failed: status 1, the last stderr line names the fetch and the inner code, nothing mentions the build', () => {
    const summary = summariseUpdate({ fetch: { ok: false, code: 'gmail.quota-exhausted', detail: '' }, build: null });
    expect(summary.status).toBe(1);
    const line = last(summary.stderr);
    expect(line.startsWith(`${STAGE_FAILED_PREFIX} fetch`)).toBe(true);
    expect(line).toContain('gmail.quota-exhausted');
    expect(summary.stdout.some((stdoutLine) => SUMMARY_LINE.test(stdoutLine))).toBe(false);
    expect(summary.stderr.join('\n')).not.toContain(KEEPS_THE_FETCH);
  });

  scenario('@error a fetch refusal that carries guidance keeps it in the line', () => {
    const summary = summariseUpdate({ fetch: { ok: false, code: 'gmail.reauth-required', detail: 'run `harvest auth` to authorise again' }, build: null });
    expect(last(summary.stderr)).toContain('gmail.reauth-required');
    expect(last(summary.stderr)).toContain('run `harvest auth` to authorise again');
  });

  scenario('@error a fetch failure with no inner code still gives one stage-failed line carrying the detail', () => {
    const summary = summariseUpdate({ fetch: { ok: false, code: null, detail: 'the cache is unreadable' }, build: null });
    expect(summary.status).toBe(1);
    expect(last(summary.stderr).startsWith(`${STAGE_FAILED_PREFIX} fetch`)).toBe(true);
    expect(last(summary.stderr)).toContain('the cache is unreadable');
  });

  scenario('@error a build that failed after a good fetch: status 1, the line names the build and the inner code, says the fetch is kept and to run update again', () => {
    const summary = summariseUpdate({ fetch: { ok: true, windowsCommitted: 1 }, build: { ok: false, code: 'sheets.request-rejected', detail: '' } });
    expect(summary.status).toBe(1);
    const line = last(summary.stderr);
    expect(line.startsWith(`${STAGE_FAILED_PREFIX} build`)).toBe(true);
    expect(line).toContain('sheets.request-rejected');
    expect(line).toContain(KEEPS_THE_FETCH);
    expect(line).toContain(RUN_AGAIN);
    expect(summary.stdout.some((stdoutLine) => SUMMARY_LINE.test(stdoutLine))).toBe(false);
  });

  scenario('@error a build failure that carries guidance keeps it in the line', () => {
    const summary = summariseUpdate({ fetch: { ok: true, windowsCommitted: 0 }, build: { ok: false, code: 'sheets.reauth-required', detail: 'run harvest auth --target sheets' } });
    expect(last(summary.stderr)).toContain('sheets.reauth-required');
    expect(last(summary.stderr)).toContain('run harvest auth --target sheets');
  });

  scenario('@error it never changes the outcome it is handed', () => {
    const outcome = deepFreeze({ fetch: { ok: true, windowsCommitted: 1 }, build: { ok: false, code: 'sheets.request-rejected', detail: 'x' } });
    const snapshot = JSON.stringify(outcome);
    summariseUpdate(outcome);
    expect(JSON.stringify(outcome)).toBe(snapshot);
  });
});

describe('@structural the pure core stays pure', () => {
  scenario('@structural update-plan.mjs imports only core modules, uses no node: builtin and declares no class', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../../../src/core/update-plan.mjs', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/^import .* from '([^']+)'/gm)].map((match) => match[1]);
    expect(imports.every((specifier) => specifier.startsWith('./'))).toBe(true);
    expect(source).not.toMatch(/node:/);
    expect(source).not.toMatch(/^\s*class\s/m);
    expect(source).not.toMatch(/Date\.now\(|new Date\(\)/);
  });

  scenario('@structural update accepts exactly --from and --dry-run: no --to, --source or --report', async () => {
    const { OPTION_TABLES } = await import('../../../src/core/cli-options.mjs');
    expect(Object.keys(OPTION_TABLES.update ?? {}).sort()).toEqual(['dry-run', 'from']);
  });
});
