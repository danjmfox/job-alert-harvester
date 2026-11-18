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

const isBodyPartOf = (mimeType) => (part) => part.mimeType === mimeType && !part.filename && typeof part.body?.data === 'string';

const findPart = (isWanted) => {
  const find = (part) => (isWanted(part) ? part : (part.parts ?? []).reduce((found, child) => found ?? find(child), undefined));
  return find;
};

const findPlaintextPart = findPart(isBodyPartOf('text/plain'));
const findHtmlPart = findPart(isBodyPartOf('text/html'));

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

const nonEmpty = (body, resource) => (body === '' ? refuse(MessageRefusal.MISSING_PLAINTEXT_BODY, resource.id) : body);

// A plain-text part wins, even when empty; the HTML is read only when there is no plain-text part (DR-0019).
const bodyOf = (resource) => {
  const plaintext = findPlaintextPart(resource.payload);
  if (plaintext) return { plaintextBody: nonEmpty(decodeBase64Url(plaintext.body.data), resource) };
  const html = findHtmlPart(resource.payload);
  return { htmlBody: nonEmpty(html ? decodeBase64Url(html.body.data) : '', resource) };
};

/** users.messages.get?format=full -> { date, id, plaintextBody | htmlBody, sender, snippet, subject } */
export const toMessage = (resource) => ({
  date: secondPrecisionUtc(resource.internalDate),
  id: resource.id,
  ...bodyOf(resource),
  sender: senderAddress(headerValue(resource.payload, 'from')),
  snippet: resource.snippet,
  subject: headerValue(resource.payload, 'subject'),
});

/** users.messages.get?format=minimal -> { id, date } */
export const toListing = (resource) => ({ id: resource.id, date: secondPrecisionUtc(resource.internalDate) });
