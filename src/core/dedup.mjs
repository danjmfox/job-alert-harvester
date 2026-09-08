// PURE. Dedup key strategies (DR-0006). Keys are namespaced by source id so two
// sources can never collide — the same role advertised by an agency and by the
// employer is genuinely two adverts.

const PUNCTUATION = /[^\p{L}\p{N}\s]/gu;
const WHITESPACE_RUN = /\s+/g;

function normalise(value) {
  return (value ?? '')
    .toLowerCase()
    .replace(PUNCTUATION, '')
    .trim()
    .replace(WHITESPACE_RUN, ' ');
}

/** Canonical key for sources exposing a stable id, e.g. linkedin:4441092711. */
export function canonicalKey(sourceId, id) {
  return `${sourceId}:${id}`;
}

/** Fallback for sources with no canonical id: normalised case, collapsed whitespace, stripped punctuation. */
export function fuzzyKey(sourceId, company, title, location) {
  const fingerprint = [company, title, location].map(normalise).join('|');
  return `${sourceId}:${fingerprint}`;
}
