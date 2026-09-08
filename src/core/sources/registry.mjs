// PURE. Maps a message to its source descriptor (DR-0006).
// There is no source shape: a single-job source is simply a source whose
// extractor returns an array of length one. Messages matching no descriptor are
// captured in an Unmatched bucket — never dropped.
//
// RED scaffold — created by DISTILL.

import { linkedin } from './linkedin.mjs';

export const __SCAFFOLD__ = true;

const notImplemented = (name) => {
  throw new Error(`${name}: Not yet implemented — RED scaffold`);
};

/** First match wins. */
export const REGISTRY = Object.freeze([linkedin]);

/** @returns {object|null} the first descriptor whose predicate matches. */
export function selectSource(_message, _registry = REGISTRY) {
  return notImplemented('selectSource');
}

/**
 * @returns {{ rows: object[], unmatched: { id: string, sender: string }[] }}
 */
export function extractAll(_messages, _registry = REGISTRY) {
  return notImplemented('extractAll');
}
