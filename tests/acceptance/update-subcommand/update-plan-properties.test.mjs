// @contract-shape:pure-function
// DR-0016 as properties of the pure core (layers 1 and 2 only: fast-check never reaches a subprocess). The DESIGN's four
// properties (a range or a refusal and never a throw; `to` never later than the last settled day once clamped; build for
// every successful fetch and stop for every failure; status 0 only for a fully successful outcome) are stated first, then
// the plan is pinned against an oracle of calendar arithmetic that shares no code with src/ (support/update-oracle.mjs),
// and two metamorphic properties: the ledger's order and other sources never change the plan, and moving every day by the
// same number of days moves the plan by that number. Each property first calls the module, so the scaffold fails as RED.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { clampToSettledDays } from '../../../src/core/coverage.mjs';
import { Next, UpdateRefusal, decideAfterFetch, planUpdateRange, summariseUpdate } from '../../../src/core/update-plan.mjs';
import { scenario } from './support/red-gate.mjs';
import { holds } from './support/property.mjs';
import { dayOf, daysBetween, lastSettledDay, shiftDay } from './support/update-oracle.mjs';
import { failedFetchArb, fetchResultArb, instantArb, ledgerArb, ledgerWithBaselineArb, outcomeArb, overrideArb, successfulFetchArb } from './support/update-generators.mjs';
import { STAGE_FAILED_PREFIX, SUMMARY_LINE } from './support/update-domain-types.mjs';

const isRefusal = (plan) => Object.hasOwn(plan, 'refusal');
const last = (lines) => lines[lines.length - 1];
const earliestOf = (ledger, source) => ledger.filter((interval) => interval.source === source).map((interval) => interval.from).sort()[0];
const shiftInstant = (iso, days) => new Date(Date.parse(iso) + days * 86_400_000).toISOString();

describe('@property the plan is a range or a refusal, never anything else', () => {
  it('@property for any ledger, clock and override the plan is a range with from <= to or the no-baseline refusal, and never throws', () => {
    holds(
      fc.property(ledgerArb, instantArb, overrideArb, (ledger, now, override) => {
        const plan = planUpdateRange(ledger, 'linkedin', now, override);
        if (isRefusal(plan)) {
          expect(plan).toEqual({ refusal: UpdateRefusal.NO_BASELINE });
        } else {
          expect(Object.keys(plan).sort()).toEqual(['from', 'to']);
          expect(daysBetween(plan.from, plan.to)).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  it('@property @error the plan is the refusal exactly when there is no override and the ledger holds nothing for the source', () => {
    holds(
      fc.property(ledgerArb, instantArb, overrideArb, (ledger, now, override) => {
        const noBaseline = override === undefined && earliestOf(ledger, 'linkedin') === undefined;
        expect(isRefusal(planUpdateRange(ledger, 'linkedin', now, override))).toBe(noBaseline);
      }),
    );
  });

  it('@property the start is the override when there is one, otherwise the earliest day the ledger covers for the source', () => {
    holds(
      fc.property(ledgerWithBaselineArb, instantArb, overrideArb, (ledger, now, override) => {
        const plan = planUpdateRange(ledger, 'linkedin', now, override);
        expect(plan.from).toBe(override ?? earliestOf(ledger, 'linkedin'));
      }),
    );
  });

  it('@property the end is the UTC day of the clock, and never earlier than the start', () => {
    holds(
      fc.property(ledgerWithBaselineArb, instantArb, overrideArb, (ledger, now, override) => {
        const plan = planUpdateRange(ledger, 'linkedin', now, override);
        const today = dayOf(now);
        expect(plan.to).toBe(plan.from > today ? plan.from : today);
      }),
    );
  });

  it('@property the plan clamped to settled days ends no later than the last settled day, or is empty', () => {
    holds(
      fc.property(ledgerWithBaselineArb, instantArb, overrideArb, (ledger, now, override) => {
        const plan = planUpdateRange(ledger, 'linkedin', now, override);
        const clamped = clampToSettledDays(plan, now);
        if (clamped !== null) {
          expect(clamped.to <= lastSettledDay(now)).toBe(true);
          expect(clamped.from).toBe(plan.from);
        } else {
          expect(plan.from > lastSettledDay(now)).toBe(true);
        }
      }),
    );
  });
});

describe('@property the plan depends on the ledger\'s content, not its shape or its other sources', () => {
  it('@property @error the order of the intervals never changes the plan', () => {
    holds(
      fc.property(
        ledgerWithBaselineArb.chain((ledger) => fc.tuple(fc.constant(ledger), fc.shuffledSubarray(ledger, { minLength: ledger.length, maxLength: ledger.length }))),
        instantArb,
        overrideArb,
        ([ledger, shuffled], now, override) => {
          expect(planUpdateRange(shuffled, 'linkedin', now, override)).toEqual(planUpdateRange(ledger, 'linkedin', now, override));
        },
      ),
    );
  });

  it('@property @error intervals of other sources never change the plan', () => {
    holds(
      fc.property(ledgerWithBaselineArb, ledgerArb, instantArb, overrideArb, (ledger, extra, now, override) => {
        const others = extra.map((interval) => ({ ...interval, source: 'glassdoor' }));
        expect(planUpdateRange([...ledger, ...others], 'linkedin', now, override)).toEqual(planUpdateRange(ledger, 'linkedin', now, override));
      }),
    );
  });

  it('@property @error moving the ledger, the clock and the override by the same number of days moves the plan by that number', () => {
    holds(
      fc.property(ledgerWithBaselineArb, instantArb, overrideArb, fc.integer({ min: -400, max: 400 }), (ledger, now, override, days) => {
        const moved = ledger.map((interval) => ({ ...interval, from: shiftDay(interval.from, days), to: shiftDay(interval.to, days) }));
        const original = planUpdateRange(ledger, 'linkedin', now, override);
        const shifted = planUpdateRange(moved, 'linkedin', shiftInstant(now, days), override === undefined ? undefined : shiftDay(override, days));
        expect(shifted).toEqual({ from: shiftDay(original.from, days), to: shiftDay(original.to, days) });
      }),
    );
  });

  it('@property it never changes the ledger it is handed', () => {
    holds(
      fc.property(ledgerArb, instantArb, overrideArb, (ledger, now, override) => {
        const snapshot = JSON.stringify(ledger);
        planUpdateRange(ledger, 'linkedin', now, override);
        expect(JSON.stringify(ledger)).toBe(snapshot);
      }),
    );
  });
});

describe('@property the decision after the fetch', () => {
  it('@property the decision is build for every successful fetch, including one that covered no window', () => {
    holds(
      fc.property(successfulFetchArb, (result) => {
        expect(decideAfterFetch(result)).toBe(Next.BUILD);
      }),
    );
  });

  it('@property @error the decision is stop for every failed fetch, whatever it committed before failing', () => {
    holds(
      fc.property(failedFetchArb, (result) => {
        expect(decideAfterFetch(result)).toBe(Next.STOP);
      }),
    );
  });

  it('@property the decision is build exactly when the fetch succeeded', () => {
    holds(
      fc.property(fetchResultArb, (result) => {
        expect(decideAfterFetch(result) === Next.BUILD).toBe(result.ok);
      }),
    );
  });
});

describe('@property the exit status and the closing lines', () => {
  it('@property the status is 0 only for an outcome whose fetch and build both succeeded, and 1 for every other', () => {
    holds(
      fc.property(outcomeArb, (outcome) => {
        const succeeded = outcome.fetch.ok && outcome.build !== null && outcome.build.ok;
        expect(summariseUpdate(outcome).status).toBe(succeeded ? 0 : 1);
      }),
    );
  });

  it('@property @error every failed outcome ends its stderr with one stage-failed line naming the stage that failed, and carries the inner code when there is one', () => {
    holds(
      fc.property(outcomeArb, (outcome) => {
        const failedStage = !outcome.fetch.ok ? 'fetch' : outcome.build !== null && !outcome.build.ok ? 'build' : null;
        fc.pre(failedStage !== null);
        const summary = summariseUpdate(outcome);
        const line = last(summary.stderr);
        expect(line.startsWith(`${STAGE_FAILED_PREFIX} ${failedStage}`)).toBe(true);
        const code = failedStage === 'fetch' ? outcome.fetch.code : outcome.build.code;
        if (code !== null) expect(line).toContain(code);
        expect(summary.stderr.filter((stderrLine) => stderrLine.startsWith(STAGE_FAILED_PREFIX))).toHaveLength(1);
      }),
    );
  });

  it('@property a successful outcome has an empty stderr and ends its stdout with exactly one closing line counting the days fetched', () => {
    holds(
      fc.property(outcomeArb, (outcome) => {
        fc.pre(outcome.fetch.ok && outcome.build !== null && outcome.build.ok);
        const summary = summariseUpdate(outcome);
        expect(summary.stderr).toEqual([]);
        expect(summary.stdout.filter((line) => SUMMARY_LINE.test(line))).toHaveLength(1);
        expect(SUMMARY_LINE.exec(last(summary.stdout))[1]).toBe(String(outcome.fetch.windowsCommitted));
      }),
    );
  });

  it('@property @error a failed outcome never prints a closing line on stdout', () => {
    holds(
      fc.property(outcomeArb, (outcome) => {
        fc.pre(!outcome.fetch.ok || (outcome.build !== null && !outcome.build.ok));
        expect(summariseUpdate(outcome).stdout.some((line) => SUMMARY_LINE.test(line))).toBe(false);
      }),
    );
  });

  it('@property it never throws and always gives a status of 0 or 1 with lines of text', () => {
    holds(
      fc.property(outcomeArb, (outcome) => {
        const summary = summariseUpdate(outcome);
        expect([0, 1]).toContain(summary.status);
        expect([...summary.stdout, ...summary.stderr].every((line) => typeof line === 'string' && !line.includes('\n'))).toBe(true);
      }),
    );
  });
});
