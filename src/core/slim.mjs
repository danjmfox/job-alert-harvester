// PURE. Connector raw payload -> cached record shape, and the place connector
// schema drift is detected (DR-0003, DESIGN Q5).
//
// A digest body that is suspiciously short, or that carries no advert link at
// all, is quarantined rather than cached: a truncated-but-parsable payload would
// otherwise be cached with fewer jobs than the message actually advertised, and
// nothing downstream could tell.
//
// RED scaffold — created by DISTILL.

export const __SCAFFOLD__ = true;

const notImplemented = (name) => {
  throw new Error(`${name}: Not yet implemented — RED scaffold`);
};

/** A LinkedIn digest body below this many characters is treated as truncated. */
export const MINIMUM_DIGEST_BODY_LENGTH = 1024;

export const QuarantineReason = Object.freeze({
  BODY_TOO_SHORT: 'slim.body-too-short',
  NO_ADVERT_LINK: 'slim.no-advert-link',
});

/**
 * @returns {{ record: object|null, quarantine: { id: string, reason: string }|null }}
 */
export function slim(_rawPayload) {
  return notImplemented('slim');
}
