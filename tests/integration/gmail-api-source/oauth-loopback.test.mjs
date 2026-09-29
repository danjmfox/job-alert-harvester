// @contract-shape:bounded-change
// Adapter-level integration test (a real socket on this machine) for the consent
// redirect listener (DR-0011). Bounded change: one 127.0.0.1 socket, closed on return.
// The listener serves one static "you can close this tab" page and never reflects the
// code or the state it receives.
import { describe, expect, it } from 'vitest';
import { createConnection } from 'node:net';
import { createOAuthLoopback } from '../../../src/adapters/oauth-loopback.mjs';
import { AuthRefusal } from '../../../src/core/oauth.mjs';
import { refusalOfAsync, SENTINEL } from '../../acceptance/gmail-api-source/support/gmail-domain-types.mjs';

const portOf = (redirectUri) => Number(new URL(redirectUri).port);
const canConnect = (port) =>
  new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
  });

describe('one-shot loopback listener for the consent redirect', () => {
  it('listens on 127.0.0.1 with a random port and names that address in the redirect URI', async () => {
    const listener = await createOAuthLoopback({ timeoutMs: 5000 }).listen();
    try {
      const uri = new URL(listener.redirectUri);
      expect(uri.hostname).toBe('127.0.0.1');
      expect(Number(uri.port)).toBeGreaterThan(0);
      expect(await canConnect(portOf(listener.redirectUri))).toBe(true);
    } finally {
      listener.close();
    }
  });

  it('hands the callback URL to the waiting flow, answers with a static page that echoes nothing, and closes', async () => {
    const listener = await createOAuthLoopback({ timeoutMs: 5000 }).listen();
    const waiting = listener.awaitCallback();

    const page = await fetch(`${listener.redirectUri}?code=${SENTINEL.authCode}&state=abc`);
    const callback = await waiting;

    expect(callback).toContain('code=');
    expect(callback).toContain('state=abc');
    expect(page.status).toBe(200);
    const body = await page.text();
    expect(body).toMatch(/close this tab/i);
    expect(body).not.toContain(SENTINEL.authCode);
    expect(await canConnect(portOf(listener.redirectUri))).toBe(false);
  });

  it('a request for some other path does not complete the flow; the real callback still does', async () => {
    const listener = await createOAuthLoopback({ timeoutMs: 5000 }).listen();
    const waiting = listener.awaitCallback();

    const stray = await fetch(`http://127.0.0.1:${portOf(listener.redirectUri)}/favicon.ico`);
    await fetch(`${listener.redirectUri}?code=real&state=abc`);

    expect(stray.status).toBe(404);
    expect(await waiting).toContain('code=real');
  });

  it('@error times out with a named refusal when nobody answers, and releases the port', async () => {
    const listener = await createOAuthLoopback({ timeoutMs: 100 }).listen();
    const port = portOf(listener.redirectUri);

    const refusal = await refusalOfAsync(() => listener.awaitCallback());

    expect(refusal.code).toBe(AuthRefusal.CONSENT_TIMEOUT);
    expect(await canConnect(port)).toBe(false);
  });

  it('@error a callback is single-use: once answered, a second one finds nobody listening', async () => {
    const listener = await createOAuthLoopback({ timeoutMs: 5000 }).listen();
    const waiting = listener.awaitCallback();
    await fetch(`${listener.redirectUri}?code=first&state=abc`);
    await waiting;

    await expect(fetch(`${listener.redirectUri}?code=second&state=abc`)).rejects.toThrow();
  });

  it('closing the listener without a callback releases the port', async () => {
    const listener = await createOAuthLoopback({ timeoutMs: 5000 }).listen();
    const port = portOf(listener.redirectUri);
    listener.awaitCallback().catch(() => {});

    listener.close();

    expect(await canConnect(port)).toBe(false);
  });
});
