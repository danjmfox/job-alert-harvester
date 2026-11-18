// PURE. Connector raw payload -> cached record shape, and the place connector
// schema drift is detected (DR-0003, DESIGN Q5).
//
// What counts as drift belongs to each source's descriptor: its `screen(record)` returns a
// reason to set the record aside, or null to keep it (DR-0022 rule 3).
//
import { MINIMUM_DIGEST_BODY_LENGTH, QuarantineReason, screenLinkedInDigest } from './sources/linkedin-screen.mjs';

export { MINIMUM_DIGEST_BODY_LENGTH, QuarantineReason };

/** The keys that survive slimming — deliberately identical to the fixture/cache record shape. */
const TEXT_RECORD_KEYS = ['date', 'id', 'plaintextBody', 'sender', 'snippet', 'subject'];

/** A message with no plain-text part keeps its HTML instead (DR-0019 rule 2). */
const HTML_RECORD_KEYS = ['date', 'htmlBody', 'id', 'sender', 'snippet', 'subject'];

const hasPlaintextPart = (message) => typeof message.plaintextBody === 'string';

/** Drop everything but the cache/fixture-shape keys: the HTML survives only when there is no plain-text part. */
function toRecord(message) {
  const keys = hasPlaintextPart(message) ? TEXT_RECORD_KEYS : HTML_RECORD_KEYS;
  return Object.fromEntries(keys.map((key) => [key, message[key]]));
}

const toQuarantine = (message, reason) => ({ id: message.id, reason });

/**
 * @param {object} rawPayload
 * @param {(message: object) => string|null} [screen] a source descriptor's screen; the LinkedIn screen when absent
 * @returns {{ record: object|null, quarantine: { id: string, reason: string }|null }}
 */
export function slim(rawPayload, screen = screenLinkedInDigest) {
  const message = rawPayload;
  const reason = screen(message);

  return reason === null
    ? { record: toRecord(message), quarantine: null }
    : { record: null, quarantine: toQuarantine(message, reason) };
}
