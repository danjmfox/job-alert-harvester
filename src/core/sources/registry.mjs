// PURE. Maps a message to its source descriptor (DR-0006).
// There is no source shape: a single-job source is simply a source whose
// extractor returns an array of length one. Messages matching no descriptor are
// captured in an Unmatched bucket — never dropped. A message a source claimed but
// could not read (a coded refusal, DDD-10) goes to the Unparsed bucket; any other error propagates.

import { linkedin } from './linkedin.mjs';
import { wttj } from './wttj.mjs';
import { isUnreadableMessage } from './refusal.mjs';

/** First match wins. */
export const REGISTRY = Object.freeze([linkedin, wttj]);

/** @returns {object|null} the first descriptor whose predicate matches. */
export function selectSource(message, registry = REGISTRY) {
  return registry.find((descriptor) => descriptor.matches(message)) ?? null;
}

const taggedRows = (source, message) => source.extract(message).map((row) => ({ ...row, sourceId: source.id, sourceLabel: source.label }));

function readClaimed(source, message) {
  try {
    return { rows: taggedRows(source, message), unparsed: [] };
  } catch (error) {
    if (!isUnreadableMessage(error)) throw error;
    return { rows: [], unparsed: [{ id: message.id, sender: message.sender, source: source.id, reason: error.message }] };
  }
}

/**
 * @returns {{ rows: object[], unmatched: { id: string, sender: string }[], unparsed: { id: string, sender: string, source: string, reason: string }[] }}
 */
export function extractAll(messages, registry = REGISTRY) {
  const rows = [];
  const unmatched = [];
  const unparsed = [];

  for (const message of messages) {
    const source = selectSource(message, registry);
    if (!source) {
      unmatched.push({ id: message.id, sender: message.sender });
      continue;
    }
    const read = readClaimed(source, message);
    rows.push(...read.rows);
    unparsed.push(...read.unparsed);
  }

  return { rows, unmatched, unparsed };
}
