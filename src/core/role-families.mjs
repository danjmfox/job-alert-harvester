// PURE. RED scaffold (created by DISTILL for role-family-column, DR-0014): signatures only.
// The ordered family table, the title normaliser, the classifier and the tuning summary are DELIVER's.
// Every behavioural function throws, so an unskipped scenario classifies as RED, not BROKEN.
export const __SCAFFOLD__ = true;

/** The family of a title no pattern matches. Always last; not a descriptor. */
export const OTHER_FAMILY = 'other';

/** Ordered descriptors `{ family, patterns }`; order is priority. Empty until DELIVER fills the table. */
export const ROLE_FAMILIES = Object.freeze([]);

const notImplemented = (name) => {
  throw new Error(`RED scaffold: ${name} is not implemented`);
};

/** @param {unknown} title @returns {string} lower-case, accents folded, non-alphanumeric runs collapsed to one space, trimmed */
export function normaliseTitle(title) {
  return notImplemented('normaliseTitle');
}

/** @param {unknown} title @returns {string} one family of the closed set; total, never throws */
export function classifyRoleFamily(title) {
  return notImplemented('classifyRoleFamily');
}

/**
 * @param {{ [column: string]: unknown }[]} rows Jobs rows carrying `Job` and `Role Family`
 * @param {{ limit?: number }} [options]
 * @returns {{ total: number, byFamily: Record<string, number>, otherTitles: { title: string, count: number }[] }}
 */
export function summariseRoleFamilies(rows, options) {
  return notImplemented('summariseRoleFamilies');
}
