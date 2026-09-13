// PURE. Maps a message to its source descriptor (DR-0006).
// There is no source shape: a single-job source is simply a source whose
// extractor returns an array of length one. Messages matching no descriptor are
// captured in an Unmatched bucket — never dropped.

import { linkedin } from './linkedin.mjs';

/** First match wins. */
export const REGISTRY = Object.freeze([linkedin]);

/** @returns {object|null} the first descriptor whose predicate matches. */
export function selectSource(message, registry = REGISTRY) {
  return registry.find((descriptor) => descriptor.matches(message)) ?? null;
}

/**
 * @returns {{ rows: object[], unmatched: { id: string, sender: string }[] }}
 */
export function extractAll(messages, registry = REGISTRY) {
  const rows = [];
  const unmatched = [];

  for (const message of messages) {
    const source = selectSource(message, registry);
    if (source) rows.push(...source.extract(message));
    else unmatched.push({ id: message.id, sender: message.sender });
  }

  return { rows, unmatched };
}
