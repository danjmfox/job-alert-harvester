// Driven adapter: MessageSource over the Gmail REST API (DR-0011, DR-0003 successor).
// Receives a GET-only capability, so a write is unrepresentable.
import { RATE_LIMIT_REASONS, decideRetry } from '../core/retry-policy.mjs';
import { TokenRefusal } from '../core/oauth.mjs';
import { toListing, toMessage } from '../core/gmail-message.mjs';
import { gmailWindowQuery } from '../core/gmail-query.mjs';

export const SourceRefusal = Object.freeze({
  LIST_MALFORMED: 'gmail.list-malformed',
  LIST_INCOMPLETE: 'gmail.list-incomplete',
  ID_MISMATCH: 'gmail.id-mismatch',
  OUTSIDE_WINDOW: 'gmail.outside-window',
  SENDER_MATCHES_NOTHING: 'gmail.sender-matches-nothing',
  WRONG_MAILBOX: 'gmail.wrong-mailbox',
});

const REAUTH_INSTRUCTION = 'run `harvest auth` to authorise again';

const LIST_PAGE_SIZE = '500';

// Messages carry the refusal code only: no credential value may reach an error.
const refuse = (code) => {
  throw Object.assign(new Error(code), { code });
};

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const readJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const rateLimitReasonOf = (body) =>
  (body?.error?.errors ?? []).map((entry) => entry?.reason).find((reason) => RATE_LIMIT_REASONS.includes(reason)) ?? null;

const retryAfterSecondsOf = (response) => {
  const seconds = Number(response.headers.get('retry-after'));
  return response.headers.has('retry-after') && Number.isFinite(seconds) ? seconds : null;
};

const hasListEnvelope = (body) =>
  isPlainObject(body) && typeof body.resultSizeEstimate === 'number' && (body.messages === undefined || Array.isArray(body.messages));

const isWithinWindow = (isoDate, window) => {
  const day = isoDate.slice(0, 10);
  return day >= window.from && day <= window.to;
};

const uniqueInOrder = (values) => [...new Set(values)];

/**
 * @param {{ store: object, tokenSource: { accessToken: Function }, get: (url: string, init?: object) => Promise<Response>,
 *           endpoints: { gmailBase: string }, sender: string, sleep: Function, jitter: () => number }} options
 * @returns {{ list: Function, read: Function, probe: Function }}
 */
export function createGmailApiSource({ store, tokenSource, get, endpoints, sender, sleep, jitter }) {
  const messagesUrl = (query) => `${endpoints.gmailBase}/users/me/messages?${new URLSearchParams(query)}`;
  const messageUrl = (id, format) => `${endpoints.gmailBase}/users/me/messages/${encodeURIComponent(id)}?${new URLSearchParams({ format })}`;
  const profileUrl = `${endpoints.gmailBase}/users/me/profile`;

  const send = async (url, { attempt, token, refreshed, accept }) => {
    const response = await get(url, { headers: { authorization: `Bearer ${token}` } });
    if (response.ok || accept.includes(response.status)) return response;
    if (response.status === 401 && !refreshed) {
      const renewed = await tokenSource.accessToken({ staleToken: token });
      return send(url, { attempt, token: renewed, refreshed: true, accept });
    }
    const decision = decideRetry({
      attempt,
      status: response.status,
      reason: rateLimitReasonOf(await readJson(response)),
      retryAfterSeconds: retryAfterSecondsOf(response),
      jitter: jitter(),
    });
    if (!decision.retry) return refuse(decision.refusal);
    await sleep(decision.delayMs);
    return send(url, { attempt: attempt + 1, token, refreshed, accept });
  };

  const getResponse = async (url, accept = []) =>
    send(url, { attempt: 1, token: await tokenSource.accessToken(), refreshed: false, accept });

  const getListPage = async (query) => {
    const body = await readJson(await getResponse(messagesUrl(query)));
    return hasListEnvelope(body) ? body : refuse(SourceRefusal.LIST_MALFORMED);
  };

  const getFollowingPage = async (query) => {
    try {
      return await getListPage(query);
    } catch {
      return refuse(SourceRefusal.LIST_INCOMPLETE);
    }
  };

  const listIds = async (window) => {
    const baseQuery = { q: gmailWindowQuery(window, { sender }), maxResults: LIST_PAGE_SIZE };
    const ids = [];
    const seenTokens = new Set();
    let page = await getListPage(baseQuery);
    for (;;) {
      ids.push(...(page.messages ?? []).map((entry) => entry.id));
      const next = page.nextPageToken;
      if (next === undefined) return uniqueInOrder(ids);
      if (seenTokens.has(next)) return refuse(SourceRefusal.LIST_INCOMPLETE);
      seenTokens.add(next);
      page = await getFollowingPage({ ...baseQuery, pageToken: next });
    }
  };

  const getResource = async (id, format, { accept = [] } = {}) => {
    const response = await getResponse(messageUrl(id, format), accept);
    if (response.status === 404) return null;
    const resource = await readJson(response);
    return isPlainObject(resource) && resource.id === id ? resource : refuse(SourceRefusal.ID_MISMATCH);
  };

  const listEntry = async (id, window) => {
    const resource = await getResource(id, 'minimal', { accept: [404] });
    if (resource === null) return refuse(SourceRefusal.LIST_INCOMPLETE);
    const entry = toListing(resource);
    return isWithinWindow(entry.date, window) ? entry : refuse(SourceRefusal.OUTSIDE_WINDOW);
  };

  const list = async (window) => {
    const entries = [];
    for (const id of await listIds(window)) entries.push(await listEntry(id, window));
    return entries;
  };

  const read = async (id) => {
    const resource = await getResource(id, 'full', { accept: [404] });
    return resource === null ? null : toMessage(resource);
  };

  const assertRecordedMailbox = async (recordedAddress) => {
    const profile = await readJson(await getResponse(profileUrl));
    const address = typeof profile?.emailAddress === 'string' ? profile.emailAddress.toLowerCase() : null;
    return address === recordedAddress.toLowerCase() ? undefined : refuse(SourceRefusal.WRONG_MAILBOX);
  };

  const assertSenderHasMail = async () => {
    const page = await getListPage({ q: `from:${sender}`, maxResults: '1' });
    return (page.messages ?? []).length > 0 ? undefined : refuse(SourceRefusal.SENDER_MATCHES_NOTHING);
  };

  const refreshAccessToken = async () => {
    try {
      await tokenSource.accessToken();
    } catch (error) {
      if (error.code !== TokenRefusal.REAUTH_REQUIRED) throw error;
      throw Object.assign(new Error(`${error.code}: ${REAUTH_INSTRUCTION}`), { code: error.code });
    }
  };

  const probe = async () => {
    store.probe();
    store.readClient();
    const { emailAddress } = store.readToken();
    await refreshAccessToken();
    await assertRecordedMailbox(emailAddress);
    await assertSenderHasMail();
  };

  return { list, read, probe };
}
