// Driven adapter: the one-shot loopback listener that receives the consent redirect.
// Bounded change universe: one 127.0.0.1 socket, closed on return.
// Parsing and the state check live in core/oauth.mjs; this adapter only captures the callback URL.

import { createServer } from 'node:http';
import { AuthRefusal } from '../core/oauth.mjs';

const LOOPBACK_HOST = '127.0.0.1';
const CALLBACK_PATH = '/callback';
const CLOSE_TAB_PAGE = '<!doctype html><html><body><p>You can close this tab.</p></body></html>';

const consentTimeout = () =>
  Object.assign(new Error(AuthRefusal.CONSENT_TIMEOUT), { code: AuthRefusal.CONSENT_TIMEOUT });

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

const respond = (res, status, contentType, body, onDone = () => {}) => {
  res.writeHead(status, { 'content-type': contentType, connection: 'close' });
  res.end(body, onDone);
};

const listenOnRandomPort = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, LOOPBACK_HOST, () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });

/**
 * @param {{ timeoutMs: number }} options
 * @returns {{ listen: () => Promise<{ redirectUri: string, awaitCallback: () => Promise<string>, close: () => void }> }}
 */
export function createOAuthLoopback({ timeoutMs }) {
  return {
    listen: async () => {
      const callback = deferred();
      callback.promise.catch(() => {});
      let timer = null;

      const close = () => {
        clearTimeout(timer);
        server.close();
        server.closeAllConnections();
        callback.reject(consentTimeout());
      };

      const server = createServer((req, res) => {
        const url = new URL(req.url, `http://${LOOPBACK_HOST}`);
        if (url.pathname !== CALLBACK_PATH) return respond(res, 404, 'text/plain', 'Not found');
        callback.resolve(`http://${LOOPBACK_HOST}${req.url}`);
        clearTimeout(timer);
        return respond(res, 200, 'text/html; charset=utf-8', CLOSE_TAB_PAGE, () => server.close());
      });

      const port = await listenOnRandomPort(server);
      timer = setTimeout(close, timeoutMs);

      return {
        redirectUri: `http://${LOOPBACK_HOST}:${port}${CALLBACK_PATH}`,
        awaitCallback: () => callback.promise,
        close,
      };
    },
  };
}
