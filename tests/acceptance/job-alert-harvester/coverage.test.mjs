// @contract-shape:pure-function
// DR-0002 — coverage intervals are the record of what was *searched*, never
// derived from what the cache happens to hold. Pure interval algebra: unit
// layer, table-driven examples plus @property checks over the interval algebra.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  mergeIntervals,
  subtractCoverage,
  nextUncoveredWindow,
  validateInterval,
  CoverageRefusal,
} from '../../../src/core/coverage.mjs';
import { anInterval, refusalOf } from './support/domain-types.mjs';

describe('coverage interval algebra (DR-0002)', () => {
  describe('validateInterval refuses an interval whose bounds are backwards', () => {
    it('@error refuses when `to` precedes `from`', () => {
      // Given an interval where the end date is before the start date
      const interval = anInterval({ from: '2026-02-01', to: '2026-01-01' });
      // When it is validated
      // Then the operator sees a refusal naming the inverted-interval reason
      expect(refusalOf(() => validateInterval(interval))).toBe(CoverageRefusal.INVERTED_INTERVAL);
    });

    it('accepts an interval whose bounds are in order', () => {
      // Given a well-formed interval
      const interval = anInterval({ from: '2026-01-01', to: '2026-01-31' });
      // When it is validated
      // Then no refusal is raised
      expect(() => validateInterval(interval)).not.toThrow();
    });

    it('accepts a single-day interval where `from` equals `to`', () => {
      const interval = anInterval({ from: '2026-01-15', to: '2026-01-15' });
      expect(() => validateInterval(interval)).not.toThrow();
    });
  });

  describe('mergeIntervals collapses overlapping and day-adjacent windows on commit', () => {
    it('returns an empty coverage record for an empty ledger', () => {
      expect(mergeIntervals([])).toEqual([]);
    });

    it.each([
      {
        name: 'overlapping intervals merge into one',
        input: [anInterval({ from: '2026-01-01', to: '2026-01-15' }), anInterval({ from: '2026-01-10', to: '2026-01-20' })],
        expected: [anInterval({ from: '2026-01-01', to: '2026-01-20' })],
      },
      {
        name: 'day-adjacent intervals merge into one',
        input: [anInterval({ from: '2026-01-01', to: '2026-01-10' }), anInterval({ from: '2026-01-11', to: '2026-01-20' })],
        expected: [anInterval({ from: '2026-01-01', to: '2026-01-20' })],
      },
      {
        name: 'non-adjacent intervals stay separate — non-contiguous backfill is expressible',
        input: [anInterval({ from: '2025-01-01', to: '2025-01-31' }), anInterval({ from: '2026-01-01', to: '2026-01-31' })],
        expected: [anInterval({ from: '2025-01-01', to: '2025-01-31' }), anInterval({ from: '2026-01-01', to: '2026-01-31' })],
      },
      {
        name: 'intervals given out of order are merged and returned sorted',
        input: [anInterval({ from: '2026-03-01', to: '2026-03-31' }), anInterval({ from: '2026-01-01', to: '2026-01-31' })],
        expected: [anInterval({ from: '2026-01-01', to: '2026-01-31' }), anInterval({ from: '2026-03-01', to: '2026-03-31' })],
      },
    ])('$name', ({ input, expected }) => {
      expect(mergeIntervals(input).map(({ source, from, to }) => ({ source, from, to }))).toEqual(
        expected.map(({ source, from, to }) => ({ source, from, to })),
      );
    });

    it('an empty window (messageCount: 0) still merges and is retained as covered', () => {
      const empty = anInterval({ from: '2026-04-01', to: '2026-04-07', messageCount: 0 });
      const merged = mergeIntervals([empty]);
      expect(merged).toHaveLength(1);
      expect(merged[0].messageCount).toBe(0);
    });

    it('merging adjacent intervals sums their message counts', () => {
      // Given a live two-day harvest: 09-10 committed 5 messages, 09-11 committed 6
      const day1 = anInterval({ from: '2026-09-10', to: '2026-09-10', messageCount: 5 });
      const day2 = anInterval({ from: '2026-09-11', to: '2026-09-11', messageCount: 6 });
      // When the day-adjacent intervals merge
      const merged = mergeIntervals([day1, day2]);
      // Then the merged interval reports the sum of both days, not either alone
      expect(merged).toHaveLength(1);
      expect(merged[0].messageCount).toBe(11);

      // And an overlapping merge sums too
      const overlapping = mergeIntervals([
        anInterval({ from: '2026-01-01', to: '2026-01-15', messageCount: 3 }),
        anInterval({ from: '2026-01-10', to: '2026-01-20', messageCount: 4 }),
      ]);
      expect(overlapping[0].messageCount).toBe(7);

      // And a zero-count interval contributes zero without erasing the other side's count
      // (DR-0002 relies on a messageCount: 0 interval still marking a day covered)
      const withEmptyDay = mergeIntervals([
        anInterval({ from: '2026-04-01', to: '2026-04-07', messageCount: 9 }),
        anInterval({ from: '2026-04-08', to: '2026-04-08', messageCount: 0 }),
      ]);
      expect(withEmptyDay[0].messageCount).toBe(9);
    });
  });

  describe('subtractCoverage finds the parts of a window nothing has covered', () => {
    it('a window fully covered by a committed interval subtracts to nothing', () => {
      const window = { from: '2026-01-01', to: '2026-01-31' };
      const covered = [anInterval({ from: '2026-01-01', to: '2026-01-31' })];
      expect(subtractCoverage(window, covered)).toEqual([]);
    });

    it('@error a window with no committed intervals is entirely uncovered', () => {
      const window = { from: '2026-01-01', to: '2026-01-31' };
      expect(subtractCoverage(window, [])).toEqual([{ from: '2026-01-01', to: '2026-01-31' }]);
    });

    it('a partially covered window subtracts to the remaining gap only', () => {
      const window = { from: '2026-01-01', to: '2026-01-31' };
      const covered = [anInterval({ from: '2026-01-01', to: '2026-01-15' })];
      expect(subtractCoverage(window, covered)).toEqual([{ from: '2026-01-16', to: '2026-01-31' }]);
    });

    it('non-contiguous backfill leaves the untouched middle as a gap, in ascending order', () => {
      const window = { from: '2025-12-01', to: '2026-02-28' };
      const covered = [anInterval({ from: '2025-12-01', to: '2025-12-31' }), anInterval({ from: '2026-02-01', to: '2026-02-28' })];
      expect(subtractCoverage(window, covered)).toEqual([{ from: '2026-01-01', to: '2026-01-31' }]);
    });
  });

  describe('nextUncoveredWindow finds the next window to fetch', () => {
    it('returns the first uncovered sub-window when several gaps exist', () => {
      const request = { from: '2026-01-01', to: '2026-06-30' };
      const covered = [anInterval({ from: '2026-03-01', to: '2026-03-31' })];
      const next = nextUncoveredWindow(request, covered);
      expect(next).toEqual({ from: '2026-01-01', to: '2026-02-28' });
    });

    it('returns null when the request is fully covered', () => {
      const request = { from: '2026-01-01', to: '2026-01-31' };
      const covered = [anInterval({ from: '2026-01-01', to: '2026-01-31' })];
      expect(nextUncoveredWindow(request, covered)).toBeNull();
    });

    it('@error an empty window (messageCount: 0) counts as covered and is never re-offered', () => {
      const request = { from: '2026-04-01', to: '2026-04-07' };
      const covered = [anInterval({ from: '2026-04-01', to: '2026-04-07', messageCount: 0 })];
      expect(nextUncoveredWindow(request, covered)).toBeNull();
    });
  });

  describe('@property interval algebra holds for any set of intervals', () => {
    const DAY_MS = 86_400_000;
    const BASE = Date.UTC(2026, 0, 1);
    const iso = (day) => new Date(BASE + day * DAY_MS).toISOString().slice(0, 10);
    const daysOf = ({ from, to }) => {
      const start = (Date.parse(from) - BASE) / DAY_MS;
      const end = (Date.parse(to) - BASE) / DAY_MS;
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    };
    const span = fc
      .tuple(fc.integer({ min: 0, max: 60 }), fc.integer({ min: 0, max: 20 }), fc.nat(50))
      .map(([start, length, messageCount]) => ({ from: iso(start), to: iso(start + length), messageCount }));
    const spans = fc.array(span, { maxLength: 12 });
    const windowArb = fc
      .tuple(fc.integer({ min: 0, max: 60 }), fc.integer({ min: 0, max: 30 }))
      .map(([start, length]) => ({ from: iso(start), to: iso(start + length) }));

    it('merge is idempotent', () => {
      fc.assert(
        fc.property(spans, (intervals) => {
          const once = mergeIntervals(intervals);
          expect(mergeIntervals(once)).toEqual(once);
        }),
      );
    });

    it('merge preserves covered days and message counts, and leaves ordered, non-touching intervals', () => {
      fc.assert(
        fc.property(spans, (intervals) => {
          const merged = mergeIntervals(intervals);
          const daysBefore = new Set(intervals.flatMap(daysOf));
          const daysAfter = new Set(merged.flatMap(daysOf));
          expect(daysAfter).toEqual(daysBefore);
          expect(merged.reduce((sum, i) => sum + i.messageCount, 0)).toBe(
            intervals.reduce((sum, i) => sum + i.messageCount, 0),
          );
          merged.slice(1).forEach((next, i) => {
            const gapDays = (Date.parse(next.from) - Date.parse(merged[i].to)) / DAY_MS;
            expect(gapDays).toBeGreaterThan(1);
          });
        }),
      );
    });

    it('subtract returns exactly the uncovered days of the window, as ordered non-overlapping gaps', () => {
      fc.assert(
        fc.property(windowArb, spans, (window, intervals) => {
          const gaps = subtractCoverage(window, intervals);
          const gapDays = gaps.flatMap(daysOf);
          expect(new Set(gapDays).size).toBe(gapDays.length);
          expect([...gapDays]).toEqual([...gapDays].sort((a, b) => a - b));
          const covered = new Set(intervals.flatMap(daysOf));
          const expected = daysOf(window).filter((day) => !covered.has(day));
          expect(gapDays).toEqual(expected);
        }),
      );
    });
  });
});
