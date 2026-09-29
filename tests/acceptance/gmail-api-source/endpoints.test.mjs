// @contract-shape:pure-function
// The base-URL override exists so a fake can stand in for Google. It must be
// loopback-only: any other host would turn it into a token-exfiltration switch.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { resolveEndpoints, EndpointRefusal } from '../../../src/core/endpoints.mjs';
import { ENDPOINT_OVERRIDE_ENV, refusalOf } from './support/gmail-domain-types.mjs';
import { holds } from './support/property.mjs';

const overriding = (baseUrl) => ({ [ENDPOINT_OVERRIDE_ENV]: baseUrl });

describe('where the Google endpoints are', () => {
  it('without an override the real Google endpoints are used', () => {
    expect(resolveEndpoints({})).toEqual({
      gmailBase: 'https://gmail.googleapis.com/gmail/v1',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      authUri: 'https://accounts.google.com/o/oauth2/v2/auth',
    });
  });

  it('@property a loopback base URL redirects every endpoint to it', () => {
    holds(
      fc.property(fc.constantFrom('127.0.0.1', 'localhost', '[::1]'), fc.integer({ min: 1024, max: 65535 }), (host, port) => {
        const base = `http://${host}:${port}`;
        expect(resolveEndpoints(overriding(base))).toEqual({
          gmailBase: `${base}/gmail/v1`,
          tokenEndpoint: `${base}/token`,
          authUri: `${base}/o/oauth2/v2/auth`,
        });
      }),
    );
  });

  it('a trailing slash on the override does not double up', () => {
    expect(resolveEndpoints(overriding('http://127.0.0.1:5000/')).tokenEndpoint).toBe('http://127.0.0.1:5000/token');
  });

  it('@error @property refuses any override that names a host other than loopback', () => {
    holds(
      fc.property(fc.domain(), fc.constantFrom('http', 'https'), (domain, scheme) => {
        fc.pre(domain !== 'localhost');
        expect(refusalOf(() => resolveEndpoints(overriding(`${scheme}://${domain}`)))).toBe(EndpointRefusal.NOT_LOOPBACK);
      }),
    );
  });

  const DISGUISED = [
    'http://127.0.0.1.evil.example',
    'http://127.0.0.1@evil.example',
    'http://localhost.evil.example',
    'http://0.0.0.0:8080',
    'http://10.0.0.5:8080',
    'http://[::ffff:8.8.8.8]',
    'file:///etc/passwd',
    'not a url',
  ];
  for (const baseUrl of DISGUISED) {
    it(`@error refuses the disguised or malformed override ${JSON.stringify(baseUrl)}`, () => {
      expect(refusalOf(() => resolveEndpoints(overriding(baseUrl)))).toBe(EndpointRefusal.NOT_LOOPBACK);
    });
  }
});
