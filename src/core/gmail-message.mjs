// PURE. The only place that knows Gmail's resource shape (anti-corruption layer).
// Everything downstream sees the cache record shape slim() already consumes.
export const __SCAFFOLD__ = true;

export const MessageRefusal = Object.freeze({
  MISSING_PLAINTEXT_BODY: 'gmail.missing-plaintext-body',
});

const scaffold = (name) => {
  throw new Error(`RED scaffold: ${name} is not implemented`);
};

/** users.messages.get?format=full -> { date, id, plaintextBody, sender, snippet, subject } */
export const toMessage = (_resource) => scaffold('toMessage');

/** users.messages.get?format=minimal -> { id, date } */
export const toListing = (_resource) => scaffold('toListing');

/** A From header value -> the bare lowercase address */
export const senderAddress = (_fromHeader) => scaffold('senderAddress');
