// @contract-shape:pure-function
// DR-0002 — coverage intervals are the record of what was *searched*, never
// derived from what the cache happens to hold. Pure interval algebra: unit
// layer, table-driven examples (no fast-check installed — see the skipped
// @property placeholder at the bottom).
import { describe, it, expect } from 'vitest';
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

  // PBT-worthy: subtractCoverage(window, mergeIntervals(intervals)) should never
  // produce overlapping gaps, and merge should be idempotent. fast-check is not
  // installed in this project (task constraint) — left as a named, skipped
  // placeholder rather than silently omitted.
  it.skip('@property merge is idempotent and subtract never returns overlapping gaps — needs fast-check', () => {
    expect(true).toBe(false);
  });
});
