// PURE. Connector raw payload -> cached record shape, and the place connector
// schema drift is detected (DR-0003, DESIGN Q5).
//
// What counts as drift belongs to each source's descriptor: its `screen(record)` returns a
// reason to set the record aside, or null to keep it (DR-0022 rule 3).
//
import { MINIMUM_DIGEST_BODY_LENGTH, QuarantineReason, screenLinkedInDigest } from './sources/linkedin-screen.mjs';

export { MINIMUM_DIGEST_BODY_LENGTH, QuarantineReason };

/** The keys that survive slimming — deliberately identical to the fixture/cache record shape. */
const RECORD_KEYS = ['date', 'id', 'plaintextBody', 'sender', 'snippet', 'subject'];

/** Drop everything but the cache/fixture-shape keys (discards htmlBody and any other raw connector fields). */
function toRecord(message) {
  return Object.fromEntries(RECORD_KEYS.map((key) => [key, message[key]]));
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
