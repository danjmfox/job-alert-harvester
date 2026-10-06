// fast-check generators for the pure layer (layers 1 and 2): ledgers, clocks, overrides and stage outcomes. Days span 2020
// to 2035 (leap days, month and year ends included); a clock is any instant in a day, millisecond precision as
// `new Date().toISOString()` gives it. Intervals are valid (`from <= to`) and belong to linkedin or another source.

import fc from 'fast-check';
import { epochDayOf, isoDay } from './update-oracle.mjs';

const FIRST_DAY = epochDayOf('2020-01-01T00:00:00Z');
const LAST_DAY = epochDayOf('2035-12-31T00:00:00Z');
export const SOURCES = Object.freeze(['linkedin', 'glassdoor', 'indeed']);

export const dayArb = fc.integer({ min: FIRST_DAY, max: LAST_DAY }).map(isoDay);
const dayIndexArb = fc.integer({ min: FIRST_DAY, max: LAST_DAY });
/** An instant on some day: whole UTC days plus any millisecond of the day, with the edges of the day weighted in. */
export const instantArb = fc
  .tuple(dayIndexArb, fc.oneof({ weight: 6, arbitrary: fc.integer({ min: 0, max: 86_399_999 }) }, { weight: 1, arbitrary: fc.constant(0) }, { weight: 1, arbitrary: fc.constant(86_399_999) }))
  .map(([day, ms]) => new Date(day * 86_400_000 + ms).toISOString());

export const intervalArb = fc
  .tuple(dayIndexArb, fc.integer({ min: 0, max: 60 }), fc.constantFrom(...SOURCES), fc.integer({ min: 0, max: 500 }))
  .map(([start, length, source, messageCount]) => ({ source, from: isoDay(start), to: isoDay(Math.min(start + length, LAST_DAY)), completedAt: '2026-09-01T00:00:00.000Z', messageCount }));
export const ledgerArb = fc.array(intervalArb, { maxLength: 8 });
/** A ledger that surely holds linkedin coverage. */
export const ledgerWithBaselineArb = fc.tuple(intervalArb.map((interval) => ({ ...interval, source: 'linkedin' })), ledgerArb).map(([own, others]) => [...others, own]);
export const overrideArb = fc.oneof({ weight: 1, arbitrary: fc.constant(undefined) }, { weight: 2, arbitrary: dayArb });

const codeArb = fc.oneof(fc.constantFrom('gmail.quota-exhausted', 'gmail.reauth-required', 'gmail.unauthorized', 'sheets.request-rejected', 'sheets.reauth-required', 'sheets.not-imported'), fc.constant(null));
const detailArb = fc.oneof(fc.constant(''), fc.constantFrom('run `harvest auth` to authorise again', 'run harvest auth --target sheets'), fc.string({ maxLength: 40 }));

export const successfulFetchArb = fc.integer({ min: 0, max: 400 }).map((windowsCommitted) => ({ ok: true, windowsCommitted }));
export const failedFetchArb = fc.tuple(codeArb, detailArb, fc.option(fc.integer({ min: 0, max: 400 }), { nil: undefined })).map(([code, detail, windowsCommitted]) => ({ ok: false, code, detail, ...(windowsCommitted === undefined ? {} : { windowsCommitted }) }));
export const fetchResultArb = fc.oneof(successfulFetchArb, failedFetchArb);
export const buildResultArb = fc.oneof(fc.constant({ ok: true }), fc.tuple(codeArb, detailArb).map(([code, detail]) => ({ ok: false, code, detail })));

/** Every outcome the shell can hand over: a failed fetch has no build; a good fetch has a build result. */
export const outcomeArb = fc.oneof(failedFetchArb.map((fetch) => ({ fetch, build: null })), fc.tuple(successfulFetchArb, buildResultArb).map(([fetch, build]) => ({ fetch, build })));
