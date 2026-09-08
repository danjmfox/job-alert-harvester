// PURE. Connector raw payload -> cached record shape, and the place connector
// schema drift is detected (DR-0003, DESIGN Q5).
//
// A digest body that is suspiciously short, or that carries no advert link at
// all, is quarantined rather than cached: a truncated-but-parsable payload would
// otherwise be cached with fewer jobs than the message actually advertised, and
// nothing downstream could tell.
//
/** A LinkedIn digest body below this many characters is treated as truncated. */
export const MINIMUM_DIGEST_BODY_LENGTH = 1024;

export const QuarantineReason = Object.freeze({
  BODY_TOO_SHORT: 'slim.body-too-short',
  NO_ADVERT_LINK: 'slim.no-advert-link',
});

const ADVERT_LINK_MARKER = '/jobs/view/';

/** The keys that survive slimming — deliberately identical to the fixture/cache record shape. */
const RECORD_KEYS = ['date', 'id', 'plaintextBody', 'sender', 'snippet', 'subject'];

const isTooShort = (plaintextBody) => plaintextBody.length < MINIMUM_DIGEST_BODY_LENGTH;

const hasNoAdvertLink = (plaintextBody) => !plaintextBody.includes(ADVERT_LINK_MARKER);

/** Detect schema drift in a digest body. Returns a QuarantineReason, or null if the body is trustworthy. */
function detectDrift(plaintextBody) {
  if (isTooShort(plaintextBody)) return QuarantineReason.BODY_TOO_SHORT;
  if (hasNoAdvertLink(plaintextBody)) return QuarantineReason.NO_ADVERT_LINK;
  return null;
}

/** Drop everything but the cache/fixture-shape keys (discards htmlBody and any other raw connector fields). */
function toRecord(message) {
  return Object.fromEntries(RECORD_KEYS.map((key) => [key, message[key]]));
}

const toQuarantine = (message, reason) => ({ id: message.id, reason });

/**
 * @returns {{ record: object|null, quarantine: { id: string, reason: string }|null }}
 */
export function slim(rawPayload) {
  const message = rawPayload.result;
  const driftReason = detectDrift(message.plaintextBody);

  return driftReason === null
    ? { record: toRecord(message), quarantine: null }
    : { record: null, quarantine: toQuarantine(message, driftReason) };
}
