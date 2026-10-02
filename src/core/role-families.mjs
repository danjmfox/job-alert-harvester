// PURE. Role Family classifier (DR-0014); still carries the DISTILL scaffold marker until step 03-02.
// The ordered family table, the title normaliser and the classifier are implemented; the tuning summary is still DELIVER's (step 02-01).
export const __SCAFFOLD__ = true;

/** The family of a title no pattern matches. Always last; not a descriptor. */
export const OTHER_FAMILY = 'other';

const freezeDescriptor = (family, patterns) => Object.freeze({ family, patterns: Object.freeze(patterns) });

/** Ordered descriptors `{ family, patterns }`; order is priority. Patterns are phrases already in normalised form. */
export const ROLE_FAMILIES = Object.freeze([
  freezeDescriptor('agile coach', ['agile coach', 'enterprise agile coach', 'business agility', 'agile transformation coach']),
  freezeDescriptor('scrum master', ['scrum master']),
  freezeDescriptor('AI transformation', ['ai transformation', 'artificial intelligence transformation']),
  freezeDescriptor('transformation/change', ['transformation', 'change manager', 'change lead', 'business change']),
  freezeDescriptor('engineering/delivery manager', ['delivery manager', 'delivery lead', 'head of delivery', 'engineering manager', 'programme manager', 'project manager']),
  freezeDescriptor('product/product ops', ['product owner', 'product manager', 'product operations', 'product ops']),
]);

const COMBINING_MARKS = /[\u0300-\u036f]/g;
const NON_ALPHANUMERIC_RUNS = /[^a-z0-9]+/g;

/** @param {unknown} title @returns {string} lower-case, accents folded, non-alphanumeric runs collapsed to one space, trimmed */
export function normaliseTitle(title) {
  return typeof title === 'string'
    ? title.normalize('NFKD').replace(COMBINING_MARKS, '').toLowerCase().replace(NON_ALPHANUMERIC_RUNS, ' ').trim()
    : '';
}

const containsWholeWords = (normalisedTitle, pattern) => ` ${normalisedTitle} `.includes(` ${pattern} `);

const matchesTitle = (normalisedTitle) => (descriptor) => descriptor.patterns.some((pattern) => containsWholeWords(normalisedTitle, pattern));

/** @param {unknown} title @returns {string} one family of the closed set; total, never throws */
export function classifyRoleFamily(title) {
  const normalisedTitle = normaliseTitle(title);
  return ROLE_FAMILIES.find(matchesTitle(normalisedTitle))?.family ?? OTHER_FAMILY;
}

export const TUNING_LIMIT = 15;

const countBy = (keys) => keys.reduce((counts, key) => ({ ...counts, [key]: (counts[key] ?? 0) + 1 }), {});

const byCountThenTitle = (first, second) => second.count - first.count || (first.title < second.title ? -1 : first.title > second.title ? 1 : 0);

const otherTitleCounts = (rows) =>
  Object.entries(countBy(rows.filter((row) => row['Role Family'] === OTHER_FAMILY).map((row) => normaliseTitle(row.Job))))
    .map(([title, count]) => ({ title, count }))
    .sort(byCountThenTitle);

/**
 * @param {{ [column: string]: unknown }[]} rows Jobs rows carrying `Job` and `Role Family`
 * @param {{ limit?: number }} [options]
 * @returns {{ total: number, byFamily: Record<string, number>, otherTitles: { title: string, count: number }[] }}
 */
export function summariseRoleFamilies(rows, { limit = TUNING_LIMIT } = {}) {
  return {
    total: rows.length,
    byFamily: countBy(rows.map((row) => row['Role Family'])),
    otherTitles: otherTitleCounts(rows).slice(0, Math.max(0, limit)),
  };
}

/** @param {ReturnType<typeof summariseRoleFamilies>} summary @returns {string[]} stderr lines; empty when no advert is `other` */
export function formatTuningView(summary) {
  const otherCount = summary.byFamily[OTHER_FAMILY] ?? 0;
  if (otherCount === 0) return [];
  const familyCounts = Object.entries(summary.byFamily).map(([family, count]) => `${family} ${count}`).join(', ');
  return [
    `harvest build: role families: ${familyCounts}`,
    `harvest build: ${otherCount} of ${summary.total} advert(s) classified ${OTHER_FAMILY}; most frequent:`,
    ...summary.otherTitles.map(({ title, count }) => `  ${count}  ${title}`),
  ];
}
