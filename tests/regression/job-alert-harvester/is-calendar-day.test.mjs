// @contract-shape:pure-function
// `isCalendarDay` is the one definition of "a real YYYY-MM-DD day" shared by the command-line parser and the ledger.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { isCalendarDay } from '../../../src/core/coverage.mjs';
import { holds } from '../../acceptance/gmail-api-source/support/property.mjs';

const MILLISECONDS_PER_DAY = 86_400_000;
const FIRST_EPOCH_DAY_OF_YEAR_1000 = -354_285;
const LAST_EPOCH_DAY_OF_YEAR_2999 = 376_199;

const pad = (number, width) => String(number).padStart(width, '0');
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const isoDayOf = (epochDay) => new Date(epochDay * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);

const yearIn1000s = fc.integer({ min: 1000, max: 2999 });
const monthNumber = fc.integer({ min: 1, max: 12 });

describe('isCalendarDay', () => {
  it('accepts every real day over a range of epoch days', () => {
    holds(
      fc.property(fc.integer({ min: FIRST_EPOCH_DAY_OF_YEAR_1000, max: LAST_EPOCH_DAY_OF_YEAR_2999 }), (epochDay) => {
        expect(isCalendarDay(isoDayOf(epochDay))).toBe(true);
      }),
    );
  });

  it('refuses a month outside 01..12', () => {
    const impossibleMonth = fc.oneof(fc.constant(0), fc.integer({ min: 13, max: 99 }));
    holds(
      fc.property(yearIn1000s, impossibleMonth, fc.integer({ min: 1, max: 28 }), (year, month, day) => {
        expect(isCalendarDay(`${year}-${pad(month, 2)}-${pad(day, 2)}`)).toBe(false);
      }),
    );
  });

  it('refuses a day the month does not have', () => {
    holds(
      fc.property(yearIn1000s, monthNumber, fc.integer({ min: 0, max: 68 }), (year, month, overflow) => {
        const impossibleDay = daysInMonth(year, month) + 1 + overflow;
        expect(isCalendarDay(`${year}-${pad(month, 2)}-${pad(impossibleDay, 2)}`)).toBe(false);
        expect(isCalendarDay(`${year}-${pad(month, 2)}-00`)).toBe(false);
      }),
    );
  });

  it('refuses a real day written without its zero padding', () => {
    const paddingDropped = fc
      .tuple(yearIn1000s, monthNumber, fc.integer({ min: 1, max: 28 }))
      .filter(([, month, day]) => month < 10 || day < 10);
    holds(
      fc.property(paddingDropped, ([year, month, day]) => {
        expect(isCalendarDay(`${year}-${month}-${day}`)).toBe(false);
        expect(isCalendarDay(`${year}-${pad(month, 3)}-${pad(day, 2)}`)).toBe(false);
      }),
    );
  });

  it('accepts a leap day only in a leap year', () => {
    expect(isCalendarDay('2028-02-29')).toBe(true);
    expect(isCalendarDay('2000-02-29')).toBe(true);
    expect(isCalendarDay('2026-02-29')).toBe(false);
    expect(isCalendarDay('2100-02-29')).toBe(false);
  });

  it('has no year-range limit', () => {
    expect(isCalendarDay('0001-01-01')).toBe(true);
    expect(isCalendarDay('0099-12-31')).toBe(true);
    expect(isCalendarDay('9999-12-31')).toBe(true);
  });

  it.each([
    ['banana'],
    [''],
    ['2026-05'],
    ['2026-05-01T00:00:00Z'],
    [' 2026-05-01'],
    ['2026/05/01'],
    ['+2026-05-01'],
    ['2026-05-01\n'],
    ['٢٠٢٦-٠٥-٠١'],
  ])('refuses %j, which is not written as YYYY-MM-DD', (text) => {
    expect(isCalendarDay(text)).toBe(false);
  });
});
