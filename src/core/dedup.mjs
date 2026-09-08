// PURE. Dedup key strategies (DR-0006). Keys are namespaced by source id so two
// sources can never collide — the same role advertised by an agency and by the
// employer is genuinely two adverts.
//
// RED scaffold — created by DISTILL.

export const __SCAFFOLD__ = true;

const notImplemented = (name) => {
  throw new Error(`${name}: Not yet implemented — RED scaffold`);
};

/** Canonical key for sources exposing a stable id, e.g. linkedin:4441092711. */
export function canonicalKey(_sourceId, _id) {
  return notImplemented('canonicalKey');
}

/** Fallback for sources with no canonical id: normalised case, collapsed whitespace, stripped punctuation. */
export function fuzzyKey(_sourceId, _company, _title, _location) {
  return notImplemented('fuzzyKey');
}
