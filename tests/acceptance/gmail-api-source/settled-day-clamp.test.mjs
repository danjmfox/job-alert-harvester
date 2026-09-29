// @contract-shape:pure-function
// OQ-4: a day that has not ended is never covered. `--to` is clamped to yesterday
// UTC, because a message that arrives later today would otherwise be lost silently
// behind a committed "covered" interval (DR-0002).
import { describe, expect } from 'vitest';
import fc from 'fast-check';
import { clampToSettledDays } from '../../../src/core/coverage.mjs';
import { scenario } from './support/red-gate.mjs';
import { holds } from './support/property.mjs';

const DAY_MS = 86_400_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const START = Date.UTC(2026, 0, 1);
const aDay = fc.integer({ min: 0, max: 900 }).map((offset) => isoDay(START + offset * DAY_MS));
const aRange = fc.tuple(aDay, aDay).map(([a, b]) => (a <= b ? { from: a, to: b } : { from: b, to: a }));
const anInstant = fc.integer({ min: START, max: START + 1000 * DAY_MS }).map((ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'));
const yesterdayOf = (nowIso) => isoDay(Date.parse(nowIso) - DAY_MS);

describe('the settled-day clamp (OQ-4)', () => {
  scenario('@property never covers a day that has not ended, and never widens the range', () => {
    holds(
      fc.property(aRange, anInstant, (range, nowIso) => {
        const clamped = clampToSettledDays(range, nowIso);
        fc.pre(clamped !== null);
        expect(clamped.to <= yesterdayOf(nowIso)).toBe(true);
        expect(clamped.to <= range.to).toBe(true);
        expect(clamped.from).toBe(range.from);
      }),
    );
  });

  scenario('@property nothing settled is reported as null exactly when the range starts today or later', () => {
    holds(
      fc.property(aRange, anInstant, (range, nowIso) => {
        expect(clampToSettledDays(range, nowIso) === null).toBe(range.from > yesterdayOf(nowIso));
      }),
    );
  });

  scenario('@property a range that has fully ended is left exactly as asked', () => {
    holds(
      fc.property(aRange, anInstant, (range, nowIso) => {
        fc.pre(range.to <= yesterdayOf(nowIso));
        expect(clampToSettledDays(range, nowIso)).toEqual(range);
      }),
    );
  });

  scenario('@property clamping twice changes nothing', () => {
    holds(
      fc.property(aRange, anInstant, (range, nowIso) => {
        const once = clampToSettledDays(range, nowIso);
        fc.pre(once !== null);
        expect(clampToSettledDays(once, nowIso)).toEqual(once);
      }),
    );
  });

  scenario('a range asking for today stops at yesterday', () => {
    expect(clampToSettledDays({ from: '2026-09-27', to: '2026-09-29' }, '2026-09-29T10:00:00Z')).toEqual({ from: '2026-09-27', to: '2026-09-28' });
  });

  scenario('the last second of a day still counts as that day, and the first second of the next settles it', () => {
    const range = { from: '2026-09-28', to: '2026-09-29' };
    expect(clampToSettledDays(range, '2026-09-29T23:59:59Z')).toEqual({ from: '2026-09-28', to: '2026-09-28' });
    expect(clampToSettledDays(range, '2026-09-30T00:00:00Z')).toEqual({ from: '2026-09-28', to: '2026-09-29' });
  });

  scenario('@error a range that lies wholly in today or the future has nothing settled to fetch', () => {
    expect(clampToSettledDays({ from: '2026-09-29', to: '2026-09-29' }, '2026-09-29T10:00:00Z')).toBeNull();
    expect(clampToSettledDays({ from: '2026-10-05', to: '2026-10-07' }, '2026-09-29T10:00:00Z')).toBeNull();
  });
});
