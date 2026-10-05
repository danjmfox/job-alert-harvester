// The DESIGN's definition of search yield (Q2 metrics, Q3 window, Q4 output) restated as an oracle, kept apart from
// src/: it shares no code with the production summary. A sighting here is `{ search, id, title, at }` (search is a
// string, or null/'' when the message named none). Titles come from the pools in yield-vocabulary.mjs, whose family is
// known by construction, so the oracle never calls the production classifier. Assumption stated once: the sightings of
// one advert carry distinct `at` values (or the same title), as the DESIGN's order-invariance note requires.

import { ON_TARGET_TITLES, OTHER_TITLES } from './yield-vocabulary.mjs';

export const ORACLE_WINDOW_DAYS = 28;
export const ORACLE_NAMED_LIMIT = 20;
export const ORACLE_LABEL_WIDTH = 40;
export const ORACLE_UNPARSED_LABEL = '(no search term)';
export const ORACLE_TOTAL_LABEL = 'all searches';
export const ORACLE_NO_UNIQUE = '-';

const READABLE_DAY = /^\d{4}-\d{2}-\d{2}/;
export const dayOf = (at) => (typeof at === 'string' && READABLE_DAY.test(at) ? at.slice(0, 10) : null);
export const shiftDay = (day, delta) => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + delta)).toISOString().slice(0, 10);
};

const KNOWN_TITLES = new Set([...ON_TARGET_TITLES, ...OTHER_TITLES]);
const isOnTarget = (title) => {
  if (!KNOWN_TITLES.has(title)) throw new Error(`oracle does not know the family of ${JSON.stringify(title)}`);
  return ON_TARGET_TITLES.includes(title);
};

const byAscending = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const isNamed = (sighting) => typeof sighting.search === 'string' && sighting.search !== '';

/** `id -> title of the earliest sighting` over the whole cache: the family never depends on the scope counted. */
const firstTitles = (sightings) => {
  const titles = new Map();
  for (const sighting of [...sightings].sort((left, right) => byAscending(left.at, right.at))) if (!titles.has(sighting.id)) titles.set(sighting.id, sighting.title);
  return titles;
};

function blockOf(scopeSightings, titleById, extra) {
  const idsBySearch = new Map();
  for (const sighting of scopeSightings.filter(isNamed)) idsBySearch.set(sighting.search, (idsBySearch.get(sighting.search) ?? new Set()).add(sighting.id));
  const figures = (ids) => {
    const other = [...ids].filter((id) => !isOnTarget(titleById.get(id))).length;
    return { found: ids.size, other, onTarget: ids.size - other };
  };
  const foundByAnotherSearch = (search, id) => [...idsBySearch].some(([name, ids]) => name !== search && ids.has(id));
  const searches = [...idsBySearch]
    .map(([search, ids]) => ({ search, ...figures(ids), unique: [...ids].filter((id) => isOnTarget(titleById.get(id)) && !foundByAnotherSearch(search, id)).length }))
    .sort((left, right) => right.found - left.found || byAscending(left.search, right.search));
  if (searches.length < 2) return null;
  const unparsedIds = new Set(scopeSightings.filter((sighting) => !isNamed(sighting)).map((sighting) => sighting.id));
  return { ...extra, searches, unparsed: unparsedIds.size > 0 ? figures(unparsedIds) : null, total: figures(new Set(scopeSightings.map((sighting) => sighting.id))) };
}

/** The two blocks the DESIGN defines for these sightings; a block is null where the DESIGN omits it. */
export function expectedSearchYield(sightings) {
  const titleById = firstTitles(sightings);
  const days = sightings.map((sighting) => dayOf(sighting.at)).filter((day) => day !== null).sort(byAscending);
  const allTime = blockOf(sightings, titleById, { scope: 'all' });
  if (days.length === 0) return { allTime, recent: null };
  const endDate = days.at(-1);
  const startDate = shiftDay(endDate, -(ORACLE_WINDOW_DAYS - 1));
  if (days[0] >= startDate) return { allTime, recent: null };
  const inWindow = sightings.filter((sighting) => {
    const day = dayOf(sighting.at);
    return day !== null && day >= startDate && day <= endDate;
  });
  return { allTime, recent: blockOf(inWindow, titleById, { scope: 'recent', endDate }) };
}

// ------------------------------------------------------------------ the lines

/** Integer percentage, half up, by integer arithmetic. */
export const percentOf = (part, whole) => Math.floor((200 * part + whole) / (2 * whole));
export const labelOf = (search) => (search.length > ORACLE_LABEL_WIDTH ? `${search.slice(0, ORACLE_LABEL_WIDTH - 3)}...` : search);

const row = (label, found, other, onTarget, unique) =>
  `  ${label.padEnd(ORACLE_LABEL_WIDTH)}  ${String(found).padStart(5)}  ${`${other} (${percentOf(other, found)}%)`.padStart(9)}  ${String(onTarget).padStart(9)}  ${String(unique).padStart(6)}`;
export const COLUMN_HEADER_LINE = `  ${'search'.padEnd(ORACLE_LABEL_WIDTH)}  ${'found'.padStart(5)}  ${'other'.padStart(9)}  ${'on-target'.padStart(9)}  ${'unique'.padStart(6)}`;

const headingOf = (block) =>
  block.scope === 'all' ? 'harvest build: search yield, all cached alerts (distinct adverts per saved search)' : `harvest build: search yield, last ${ORACLE_WINDOW_DAYS} days to ${block.endDate}`;

function linesOfBlock(block) {
  const shown = block.searches.slice(0, ORACLE_NAMED_LIMIT);
  const hidden = block.searches.length - shown.length;
  return [
    headingOf(block),
    COLUMN_HEADER_LINE,
    ...shown.map(({ search, found, other, onTarget, unique }) => row(labelOf(search), found, other, onTarget, unique)),
    ...(hidden > 0 ? [`  ... and ${hidden} more search(es) not shown`] : []),
    ...(block.unparsed ? [row(ORACLE_UNPARSED_LABEL, block.unparsed.found, block.unparsed.other, block.unparsed.onTarget, ORACLE_NO_UNIQUE)] : []),
    row(ORACLE_TOTAL_LABEL, block.total.found, block.total.other, block.total.onTarget, ORACLE_NO_UNIQUE),
  ];
}

/** The stderr lines the DESIGN's Q4 rule gives for blocks (the shape `expectedSearchYield` returns). */
export const expectedLines = ({ allTime, recent }) => [allTime, recent].filter(Boolean).flatMap(linesOfBlock);

/** `expectedSearchYield` then `expectedLines`: what an operator sees for these sightings. */
export const expectedStderrFor = (sightings) => expectedLines(expectedSearchYield(sightings));
