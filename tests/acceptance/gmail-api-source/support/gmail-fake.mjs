// The Gmail API and the Google token endpoint as one fake (Driven external ports).
//
// It models what Google actually does, including its lies: an absent `messages`
// key on an empty window, a `resultSizeEstimate` that need not match reality,
// 429 with Retry-After, 403 with a rate reason versus an authorisation reason,
// invalid_grant, a token response with no refresh token. The same handler is
// served two ways: called directly as an injected `fetch`, and behind a
// loopback-only node:http server for the one CLI-level seam.

import { createServer } from 'node:http';

import { GMAIL_READONLY_SCOPE, MAILBOX, SENTINEL } from './gmail-domain-types.mjs';

export const json = (status, body, headers = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

export const rateLimited = ({ retryAfter } = {}) =>
  json(
    429,
    { error: { code: 429, message: 'Rate Limit Exceeded', status: 'RESOURCE_EXHAUSTED', errors: [{ reason: 'rateLimitExceeded' }] } },
    retryAfter === undefined ? {} : { 'retry-after': String(retryAfter) },
  );

export const forbiddenFor = (reason) =>
  json(403, { error: { code: 403, message: reason, status: 'PERMISSION_DENIED', errors: [{ reason }] } });

export const serverError = (status = 503) => json(status, { error: { code: status, message: 'Backend Error', status: 'UNAVAILABLE' } });

const unauthenticated = () => json(401, { error: { code: 401, message: 'Invalid Credentials', status: 'UNAUTHENTICATED' } });

const bareSender = (resource) => {
  const from = resource.payload.headers.find((header) => header.name === 'From').value;
  return (from.match(/<([^>]+)>/)?.[1] ?? from).toLowerCase();
};

const MINIMAL_KEYS = ['id', 'threadId', 'labelIds', 'snippet', 'sizeEstimate', 'historyId', 'internalDate'];

const classify = (url, init) => {
  const parsed = new URL(String(url));
  const method = (init?.method ?? 'GET').toUpperCase();
  const path = parsed.pathname;
  const headers = new Headers(init?.headers ?? {});
  const form = init?.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : null;
  const message = path.match(/\/users\/me\/messages\/([^/]+)$/);
  const route = path.endsWith('/token')
    ? 'token'
    : path.endsWith('/users/me/profile')
      ? 'profile'
      : path.endsWith('/users/me/messages')
        ? 'list'
        : message
          ? 'get'
          : 'unknown';
  return {
    route,
    method,
    path,
    query: Object.fromEntries(parsed.searchParams),
    id: message?.[1] ?? null,
    format: parsed.searchParams.get('format'),
    authorization: headers.get('authorization'),
    form,
  };
};

const parseQuery = (q = '') => ({
  sender: q.match(/from:(\S+)/)?.[1] ?? null,
  after: Number(q.match(/after:(\d+)/)?.[1] ?? Number.NEGATIVE_INFINITY),
  before: Number(q.match(/before:(\d+)/)?.[1] ?? Number.POSITIVE_INFINITY),
});

/**
 * @param {object} options
 * @param {object[]} [options.messages] format=full resources held in the mailbox
 * @param {string[]} [options.accessTokens] the access tokens issued in turn by the token endpoint
 */
export function createGmailFake({
  mailbox = MAILBOX,
  messages = [],
  accessTokens = [SENTINEL.accessToken, SENTINEL.accessTokenRefreshed],
  refreshToken = SENTINEL.refreshToken,
  issuedRefreshToken = SENTINEL.refreshToken,
  rotateRefreshTo = null,
  clientSecret = SENTINEL.clientSecret,
  authCode = SENTINEL.authCode,
  grantedScope = GMAIL_READONLY_SCOPE,
  omitRefreshToken = false,
  pageSize = 500,
  honourQuery = true,
  estimate = null,
} = {}) {
  const requests = [];
  const overrides = [];
  const state = { issued: 0, validRefreshToken: refreshToken, accessTokenValid: true };

  const currentAccessToken = () => (state.issued === 0 ? null : accessTokens[Math.min(state.issued, accessTokens.length) - 1]);

  const issueAccessToken = () => {
    state.issued += 1;
    state.accessTokenValid = true;
    return currentAccessToken();
  };

  const tokenEndpoint = (request) => {
    const { form } = request;
    if (form.client_secret !== clientSecret) return json(401, { error: 'invalid_client', error_description: 'Unauthorized' });
    if (form.grant_type === 'refresh_token') {
      if (form.refresh_token !== state.validRefreshToken) {
        return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      }
      const body = { access_token: issueAccessToken(), expires_in: 3599, scope: grantedScope, token_type: 'Bearer' };
      if (rotateRefreshTo) {
        state.validRefreshToken = rotateRefreshTo;
        body.refresh_token = rotateRefreshTo;
      }
      return json(200, body);
    }
    if (form.grant_type === 'authorization_code') {
      if (form.code !== authCode || !form.code_verifier) return json(400, { error: 'invalid_grant', error_description: 'Bad Request' });
      const body = { access_token: issueAccessToken(), expires_in: 3599, scope: grantedScope, token_type: 'Bearer' };
      if (!omitRefreshToken) {
        state.validRefreshToken = issuedRefreshToken;
        body.refresh_token = issuedRefreshToken;
      }
      return json(200, body);
    }
    return json(400, { error: 'unsupported_grant_type' });
  };

  const listing = (request) => {
    const { sender, after, before } = parseQuery(request.query.q);
    const matching = messages
      .filter((message) => sender === null || bareSender(message) === sender)
      .filter((message) => !honourQuery || (Number(message.internalDate) / 1000 >= after && Number(message.internalDate) / 1000 < before))
      .sort((a, b) => Number(b.internalDate) - Number(a.internalDate));
    const size = Math.min(Number(request.query.maxResults ?? pageSize), pageSize);
    const offset = request.query.pageToken ? Number(request.query.pageToken.replace('page-', '')) : 0;
    const page = matching.slice(offset, offset + size);
    const body = { resultSizeEstimate: estimate ?? matching.length };
    if (page.length > 0) body.messages = page.map(({ id, threadId }) => ({ id, threadId }));
    if (offset + size < matching.length) body.nextPageToken = `page-${offset + size}`;
    return json(200, body);
  };

  const oneMessage = (request) => {
    const message = messages.find((candidate) => candidate.id === request.id);
    if (!message) return json(404, { error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' } });
    if (request.format === 'minimal') return json(200, Object.fromEntries(MINIMAL_KEYS.map((key) => [key, message[key]])));
    return json(200, message);
  };

  const handle = async (url, init) => {
    const request = classify(url, init);
    requests.push(request);
    const override = overrides.find((o) => o.route === request.route && o.remaining > 0 && o.when(request));
    if (override) {
      override.remaining -= 1;
      override.calls += 1;
      return override.respond(request, override.calls);
    }
    if (request.route === 'token') return request.method === 'POST' ? tokenEndpoint(request) : json(405, {});
    const authorised = state.accessTokenValid && request.authorization === `Bearer ${currentAccessToken()}`;
    if (!authorised) return unauthenticated();
    if (request.route === 'profile') return json(200, { emailAddress: mailbox, messagesTotal: messages.length, threadsTotal: messages.length, historyId: '3362946' });
    if (request.route === 'list') return listing(request);
    if (request.route === 'get') return oneMessage(request);
    return json(404, {});
  };

  return {
    handle,
    requests,
    /** Answer `route` with `respond(request, callNumber)` for the next `times` matching calls. */
    override: (route, respond, { times = Number.POSITIVE_INFINITY, when = () => true } = {}) => {
      overrides.push({ route, respond, remaining: times, when, calls: 0 });
    },
    revokeRefreshToken: () => {
      state.validRefreshToken = null;
    },
    invalidateAccessToken: () => {
      state.accessTokenValid = false;
    },
    accessToken: currentAccessToken,
    requestsTo: (route) => requests.filter((request) => request.route === route),
    gmailRequests: () => requests.filter((request) => request.route !== 'token'),
  };
}

/** The fake behind a real socket bound to 127.0.0.1 only. */
export async function startLoopbackFake(fake) {
  const server = createServer((incoming, outgoing) => {
    const chunks = [];
    incoming.on('data', (chunk) => chunks.push(chunk));
    incoming.on('end', async () => {
      const port = server.address().port;
      const response = await fake.handle(`http://127.0.0.1:${port}${incoming.url}`, {
        method: incoming.method,
        headers: incoming.headers,
        body: Buffer.concat(chunks).toString('utf8') || undefined,
      });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function withLoopbackFake(fake, action) {
  const server = await startLoopbackFake(fake);
  try {
    return await action(server.baseUrl);
  } finally {
    await server.close();
  }
}

// ------------------------------------------------------------------ the browser

const CONSENT_URL = /(https?:\/\/\S*code_challenge\S*)/;

/** Reads the consent URL out of a printed line; null when the line is not one. */
export const consentUrlIn = (line) => {
  const match = line.match(CONSENT_URL);
  return match ? new URL(match[1]) : null;
};

/** The redirect a browser would deliver after the operator answers the consent screen. */
export function consentRedirect(consentUrl, answer = 'approve') {
  const redirect = new URL(consentUrl.searchParams.get('redirect_uri'));
  const state = consentUrl.searchParams.get('state');
  if (answer === 'approve') redirect.search = new URLSearchParams({ code: SENTINEL.authCode, state }).toString();
  if (answer === 'wrong-state') redirect.search = new URLSearchParams({ code: SENTINEL.authCode, state: 'forged-state' }).toString();
  if (answer === 'deny') redirect.search = new URLSearchParams({ error: 'access_denied', state }).toString();
  if (answer === 'no-code') redirect.search = new URLSearchParams({ state }).toString();
  return redirect.toString();
}

/** An in-process browser and loopback listener for the auth orchestration's injected seam. */
export function aFakeBrowser({ answer = 'approve', failWith = null } = {}) {
  const lines = [];
  const seen = { consentUrl: null, listenCalls: 0, closed: false };
  let deliver;
  const callback = new Promise((resolve, reject) => {
    deliver = { resolve, reject };
  });
  callback.catch(() => {});
  const redirectUri = 'http://127.0.0.1:45871/callback';

  return {
    lines,
    seen,
    print: (line) => {
      lines.push(line);
      const consentUrl = consentUrlIn(line);
      if (!consentUrl) return;
      seen.consentUrl = consentUrl;
      if (failWith) deliver.reject(Object.assign(new Error(failWith), { code: failWith }));
      else deliver.resolve(consentRedirect(consentUrl, answer));
    },
    loopback: {
      listen: async () => {
        seen.listenCalls += 1;
        return { redirectUri, awaitCallback: () => callback, close: () => (seen.closed = true) };
      },
    },
  };
}
