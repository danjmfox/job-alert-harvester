// PURE. The only place that knows Gmail's resource shape (anti-corruption layer).
// Everything downstream sees the cache record shape slim() already consumes.

export const MessageRefusal = Object.freeze({
  MISSING_PLAINTEXT_BODY: 'gmail.missing-plaintext-body',
});

// Refusal messages name the refusal and the message id only, never body content.
const refuse = (code, id) => {
  throw Object.assign(new Error(`${code}: message ${id}`), { code });
};

const decodeBase64Url = (data) => {
  const padded = data.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(data.length / 4) * 4, '=');
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)));
};

const isPlaintextBodyPart = (part) => part.mimeType === 'text/plain' && !part.filename && typeof part.body?.data === 'string';

const findPlaintextPart = (part) =>
  isPlaintextBodyPart(part) ? part : (part.parts ?? []).reduce((found, child) => found ?? findPlaintextPart(child), undefined);

const headerValue = (payload, name) =>
  (payload.headers ?? []).find((header) => header.name.toLowerCase() === name)?.value ?? '';

const BRACKETED_ADDRESS = /<([^<>]*)>\s*$/;

/** A From header value -> the bare lowercase address */
export const senderAddress = (fromHeader) => {
  const bracketed = BRACKETED_ADDRESS.exec(fromHeader);
  return (bracketed ? bracketed[1] : fromHeader).trim().toLowerCase();
};

const secondPrecisionUtc = (internalDateMs) =>
  new Date(Math.floor(Number(internalDateMs) / 1000) * 1000).toISOString().replace('.000Z', 'Z');

const plaintextBodyOf = (resource) => {
  const part = findPlaintextPart(resource.payload);
  const body = part ? decodeBase64Url(part.body.data) : '';
  return body === '' ? refuse(MessageRefusal.MISSING_PLAINTEXT_BODY, resource.id) : body;
};

/** users.messages.get?format=full -> { date, id, plaintextBody, sender, snippet, subject } */
export const toMessage = (resource) => ({
  date: secondPrecisionUtc(resource.internalDate),
  id: resource.id,
  plaintextBody: plaintextBodyOf(resource),
  sender: senderAddress(headerValue(resource.payload, 'from')),
  snippet: resource.snippet,
  subject: headerValue(resource.payload, 'subject'),
});

/** users.messages.get?format=minimal -> { id, date } */
export const toListing = (resource) => ({ id: resource.id, date: secondPrecisionUtc(resource.internalDate) });
