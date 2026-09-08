// PURE. The LinkedIn source descriptor (DR-0006). Plain data: a match predicate,
// an extractor that always returns an array, and a dedup key strategy.
// Wraps parse-linkedin.mjs with no change to its logic.
//
// RED scaffold — created by DISTILL.

export const __SCAFFOLD__ = true;

const notImplemented = (name) => {
  throw new Error(`${name}: Not yet implemented — RED scaffold`);
};

export const linkedin = Object.freeze({
  id: 'linkedin',
  label: 'LinkedIn',
  matches: (_message) => notImplemented('linkedin.matches'),
  extract: (_message) => notImplemented('linkedin.extract'),
  dedupKey: (_rawJob) => notImplemented('linkedin.dedupKey'),
});
