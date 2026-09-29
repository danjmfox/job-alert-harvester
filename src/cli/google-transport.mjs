// RED scaffold (DISTILL): the authorised transport. Bearer header, one refresh on 401, decideRetry, and the
// read/write capability split. The read capability retries; the write capability never replays a write.
export const __SCAFFOLD__ = true;

const scaffold = (name) => {
  throw new Error(`RED scaffold: ${name} is not implemented`);
};

/**
 * @param {{ tokenSource: { accessToken: Function }, fetch: Function, sleep: Function, jitter: () => number, namespace: 'sheets'|'drive' }} options
 * @returns {{ read: { request: Function }, write: { request: Function } }}
 *   request(url, { method?, headers?, body? }) resolves { status, headers, body } (body parsed JSON or null).
 */
export function createGoogleTransport({ tokenSource, fetch, sleep, jitter, namespace }) {
  return {
    read: { request: () => scaffold('transport.read.request') },
    write: { request: () => scaffold('transport.write.request') },
  };
}
