// fast-check generators for the pure layer (layers 1 and 2): sightings of adverts by saved searches over a spread of days,
// and alert plans for the in-memory harvest. Every title is drawn from the vocabulary pools, so the oracle knows each
// advert's family. Shapes are chosen to reach the cases that matter: two or more named searches, overlap between them,
// a spread of dates wider than the 28-day window, unparsed sightings, labels at and beyond 40 characters, more than 20 searches.

import fc from 'fast-check';
import { dayOf, shiftDay } from './yield-oracle.mjs';
import { BLANK_SEARCH, FORTY_CHARACTER_SEARCH, FORTY_ONE_CHARACTER_SEARCH, LONG_SEARCH, NO_SEARCH, Role, Search, numberedSearch } from './yield-vocabulary.mjs';

export const ANCHOR_DAY = '2026-07-01';
export const FIRST_ID = 4700000000;
/** Alternating families, so half the adverts are on-target. */
const TITLE_CYCLE = Object.freeze([Role.COACH, Role.ANALYST, Role.SCRUM, Role.DEVELOPER, Role.DELIVERY, Role.OPERATIVE, Role.OWNER, Role.ANALYST]);
export const titleOfAdvert = (index) => TITLE_CYCLE[index % TITLE_CYCLE.length];
export const idOfAdvert = (index) => String(FIRST_ID + index);
export const dayAfterAnchor = (offset) => shiftDay(ANCHOR_DAY, offset);

const NAMED = Object.freeze([Search.BROAD, Search.REGIONAL, Search.NOISY, Search.REDUNDANT, Search.NEWCOMER, LONG_SEARCH, FORTY_CHARACTER_SEARCH, FORTY_ONE_CHARACTER_SEARCH]);

/** Mostly named searches, sometimes no term at all, sometimes an empty one. */
export const searchTermArb = fc.oneof({ weight: 8, arbitrary: fc.constantFrom(...NAMED) }, { weight: 1, arbitrary: fc.constant(null) }, { weight: 1, arbitrary: fc.constant('') });

const ADVERT_COUNT = 14;
const SPREAD_DAYS = 70;

const sightingFrom = ({ search, advert, day, minute }) => ({ search, id: idOfAdvert(advert), title: titleOfAdvert(advert), at: `${dayAfterAnchor(day)}T09:${String(minute).padStart(2, '0')}:00Z` });

/** Oracle-style sightings (`{ search, id, title, at }`): each advert always carries its own fixed title. */
export const sightingsArb = fc
  .array(fc.record({ search: searchTermArb, advert: fc.integer({ min: 0, max: ADVERT_COUNT - 1 }), day: fc.integer({ min: 0, max: SPREAD_DAYS }), minute: fc.integer({ min: 0, max: 59 }) }), { maxLength: 40 })
  .map((records) => records.map(sightingFrom));

/** As above but squeezed into twelve days, so the recent block is usually absent and the all-time block is the whole story. */
export const compactSightingsArb = fc
  .array(fc.record({ search: searchTermArb, advert: fc.integer({ min: 0, max: ADVERT_COUNT - 1 }), day: fc.integer({ min: 0, max: 12 }), minute: fc.integer({ min: 0, max: 59 }) }), { maxLength: 30 })
  .map((records) => records.map(sightingFrom));

/** Up to 26 distinct numbered searches over a handful of adverts: reaches the cap of 20 named searches. */
export const crowdedSightingsArb = fc
  .array(fc.record({ search: fc.integer({ min: 1, max: 26 }).map(numberedSearch), advert: fc.integer({ min: 0, max: 6 }), day: fc.integer({ min: 0, max: SPREAD_DAYS }), minute: fc.constant(0) }), { minLength: 20, maxLength: 80 })
  .map((records) => records.map(sightingFrom));

/** Every sighting moved `days` days later (the same time of day). */
export const shiftedBy = (sightings, days) => sightings.map((sighting) => ({ ...sighting, at: `${shiftDay(dayOf(sighting.at), days)}${sighting.at.slice(10)}` }));

// ------------------------------------------------------------- plans for the in-memory harvest

const planTermArb = fc.oneof({ weight: 8, arbitrary: fc.constantFrom(...NAMED) }, { weight: 1, arbitrary: fc.constant(NO_SEARCH) }, { weight: 1, arbitrary: fc.constant(BLANK_SEARCH) });
const cardArb = fc.record({ advert: fc.integer({ min: 0, max: ADVERT_COUNT - 1 }), titleChoice: fc.integer({ min: 0, max: TITLE_CYCLE.length - 1 }) });

/**
 * Alerts as the cache holds them: an advert may be retitled between alerts (each card draws its own title), and messagesOf
 * gives every alert a distinct arrival time, so the first sighting of an advert is never a tie: the DESIGN's generator constraint.
 */
export const alertPlanArb = fc.array(
  fc.record({ search: planTermArb, day: fc.integer({ min: 0, max: SPREAD_DAYS }), cards: fc.uniqueArray(cardArb, { selector: (card) => card.advert, minLength: 1, maxLength: 5 }) }),
  { maxLength: 24 },
).map((records) =>
  records.map(({ search, day, cards }) => ({
    search,
    on: dayAfterAnchor(day),
    adverts: cards.map(({ advert, titleChoice }) => ({ id: idOfAdvert(advert), title: TITLE_CYCLE[titleChoice], company: 'Example Co' })),
  })),
);
