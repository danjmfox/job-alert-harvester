// Driven adapter: MessageSource over the Gmail REST API (DR-0011, DR-0003 successor).
// Receives a GET-only capability, so a write is unrepresentable.
export const __SCAFFOLD__ = true;

export const SourceRefusal = Object.freeze({
  LIST_MALFORMED: 'gmail.list-malformed',
  LIST_INCOMPLETE: 'gmail.list-incomplete',
  ID_MISMATCH: 'gmail.id-mismatch',
  OUTSIDE_WINDOW: 'gmail.outside-window',
  SENDER_MATCHES_NOTHING: 'gmail.sender-matches-nothing',
  WRONG_MAILBOX: 'gmail.wrong-mailbox',
});

const scaffold = async (name) => {
  throw new Error(`RED scaffold: gmail-api-source ${name} is not implemented`);
};

/**
 * @param {{ store: object, tokenSource: object, get: (url: string, init?: object) => Promise<Response>,
 *           endpoints: object, sender: string, sleep: Function, jitter: () => number }} options
 * @returns {{ list: Function, read: Function, probe: Function }}
 */
export function createGmailApiSource(_options) {
  return {
    list: (_window) => scaffold('list'),
    read: (_id) => scaffold('read'),
    probe: () => scaffold('probe'),
  };
}
