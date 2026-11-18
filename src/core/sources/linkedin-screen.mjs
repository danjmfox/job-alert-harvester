// PURE. The LinkedIn digest screen (DR-0022 rule 3): null keeps a record, a reason string sets it aside.
// A digest body that is suspiciously short, or carries no advert link, is set aside rather than cached: a
// truncated-but-parsable payload would otherwise be cached with fewer jobs than the message advertised.

/** A LinkedIn digest body below this many characters is treated as truncated. */
export const MINIMUM_DIGEST_BODY_LENGTH = 1024;

export const QuarantineReason = Object.freeze({
  BODY_TOO_SHORT: 'slim.body-too-short',
  NO_ADVERT_LINK: 'slim.no-advert-link',
  NO_PLAINTEXT_BODY: 'slim.no-plaintext-body',
});

const ADVERT_LINK_MARKER = '/jobs/view/';

const hasNoPlaintextBody = (message) => typeof message.plaintextBody !== 'string';

const isTooShort = (plaintextBody) => plaintextBody.length < MINIMUM_DIGEST_BODY_LENGTH;

const hasNoAdvertLink = (plaintextBody) => !plaintextBody.includes(ADVERT_LINK_MARKER);

/** @returns {string|null} a QuarantineReason, or null when the message is trustworthy. */
export function screenLinkedInDigest(message) {
  if (hasNoPlaintextBody(message)) return QuarantineReason.NO_PLAINTEXT_BODY;
  if (isTooShort(message.plaintextBody)) return QuarantineReason.BODY_TOO_SHORT;
  if (hasNoAdvertLink(message.plaintextBody)) return QuarantineReason.NO_ADVERT_LINK;
  return null;
}
