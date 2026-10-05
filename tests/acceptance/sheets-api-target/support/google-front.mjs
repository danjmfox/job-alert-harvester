// One origin in front of the two existing fakes (Driven external ports), for a CLI run that reaches Gmail and Sheets.
//
// HARVEST_API_BASE_URL redirects every Google endpoint to one origin, but gmail-fake.mjs and sheets-fake.mjs each answer
// `/token`. This front only routes; every answer, every request record and every fault still comes from the two fakes it
// composes. By path: `/gmail/v1/...` is Gmail, `/sheets/v4/...`, `/drive/v3/...` and `/upload/drive/v3/...` are Sheets.
// `/token` goes to the fake whose refresh token the form body carries. Limit: an authorization-code exchange carries no
// refresh token and goes to Gmail, so `auth --target sheets` cannot be driven through this front.
//
// It also keeps one ordered trace across both services, so a scenario can say "Sheets was never reached" or "Gmail was
// read before the Sheet was written".

import { json } from '../../gmail-api-source/support/gmail-fake.mjs';
import { SHEETS_SENTINEL } from './sheets-constants.mjs';

export { startLoopbackFake, withLoopbackFake } from './sheets-fake.mjs';

const SERVICE_PATHS = Object.freeze([
  ['gmail', /^\/gmail\/v1(\/|$)/],
  ['sheets', /^\/(sheets\/v4|drive\/v3|upload\/drive\/v3)(\/|$)/],
]);

const bodyText = (body) => (body === undefined || body === null ? '' : typeof body === 'string' ? body : Buffer.from(body).toString('utf8'));

/**
 * @param {object} options
 * @param {{ handle: Function, requests: object[] }} options.gmail  from createGmailFake
 * @param {{ handle: Function, requests: object[] }} options.sheets from createSheetsFake
 * @param {string[]} [options.sheetsRefreshTokens] the refresh tokens that belong to the Sheets credential
 */
export function createGoogleFront({ gmail, sheets, sheetsRefreshTokens = [SHEETS_SENTINEL.refreshToken, SHEETS_SENTINEL.refreshTokenRotated] }) {
  const services = { gmail, sheets };
  const trace = [];

  const serviceFor = (url, init) => {
    const { pathname } = new URL(String(url));
    if (pathname === '/token') {
      const form = Object.fromEntries(new URLSearchParams(bodyText(init?.body)));
      return sheetsRefreshTokens.includes(form.refresh_token) ? 'sheets' : 'gmail';
    }
    return SERVICE_PATHS.find(([, pattern]) => pattern.test(pathname))?.[0] ?? null;
  };

  const handle = async (url, init) => {
    const service = serviceFor(url, init);
    if (service === null) {
      trace.push({ service: 'none', route: 'unknown', method: (init?.method ?? 'GET').toUpperCase() });
      return json(404, { error: { code: 404, message: 'Not found', status: 'NOT_FOUND' } });
    }
    const target = services[service];
    const position = target.requests.length;
    try {
      return await target.handle(url, init);
    } finally {
      const recorded = target.requests[position];
      trace.push({ service, route: recorded?.route ?? 'unknown', method: recorded?.method ?? (init?.method ?? 'GET').toUpperCase() });
    }
  };

  return {
    handle,
    gmail,
    sheets,
    /** Every request either service saw, in arrival order: `{ service, route, method }`. */
    trace,
    /** The requests one service saw, token requests included. */
    requestsTo: (service) => trace.filter((entry) => entry.service === service),
  };
}
