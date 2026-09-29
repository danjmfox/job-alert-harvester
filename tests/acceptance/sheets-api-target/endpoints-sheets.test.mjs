// @contract-shape:pure-function
// SD-15: one HARVEST_API_BASE_URL covers the Sheets and Drive bases, loopback hosts only, so a redirected
// endpoint can never carry a bearer token off the machine. The refusal keeps its ratified name
// gmail.base-url-not-loopback even for a Sheets command (DESIGN Q8: renaming would break pinned tests).
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { resolveEndpoints } from '../../../src/core/endpoints.mjs';
import { ENDPOINT_OVERRIDE_ENV, EndpointRefusal, GOOGLE_ENDPOINTS, refusalOf } from './support/sheets-domain-types.mjs';
import { holds } from './support/property.mjs';
import { scenario } from './support/red-gate.mjs';

const under = (base) => resolveEndpoints({ [ENDPOINT_OVERRIDE_ENV]: base });

describe('the Sheets and Drive bases', () => {
  scenario('default to the Google hosts, with the Gmail and token bases unchanged', () => {
    expect(resolveEndpoints({})).toEqual(GOOGLE_ENDPOINTS);
  });

  scenario('an empty override is no override', () => {
    expect(resolveEndpoints({ [ENDPOINT_OVERRIDE_ENV]: '' })).toEqual(GOOGLE_ENDPOINTS);
  });

  scenario('a loopback override maps all three new bases, beside the two it already mapped', () => {
    const endpoints = under('http://127.0.0.1:45001');

    expect(endpoints).toMatchObject({
      sheetsBase: 'http://127.0.0.1:45001/sheets/v4',
      driveBase: 'http://127.0.0.1:45001/drive/v3',
      driveUploadBase: 'http://127.0.0.1:45001/upload/drive/v3',
      gmailBase: 'http://127.0.0.1:45001/gmail/v1',
      tokenEndpoint: 'http://127.0.0.1:45001/token',
    });
  });

  scenario('@property one loopback host and port covers every base, and a path on the override is not carried into them', () => {
    holds(
      fc.property(fc.constantFrom('127.0.0.1', 'localhost', '[::1]'), fc.integer({ min: 1024, max: 65535 }), fc.constantFrom('', '/', '/evil/path'), (host, port, path) => {
        const origin = `http://${host}:${port}`;
        const endpoints = under(`${origin}${path}`);
        for (const base of [endpoints.sheetsBase, endpoints.driveBase, endpoints.driveUploadBase, endpoints.gmailBase, endpoints.tokenEndpoint, endpoints.authUri]) {
          expect(String(base).startsWith(`${origin}/`)).toBe(true);
          expect(String(base)).not.toContain('evil');
        }
      }),
    );
  });
});

describe('the override is loopback only, for the new bases too', () => {
  const DISGUISED = [
    'https://sheets.googleapis.com',
    'http://127.0.0.1.evil.example',
    'http://evil.example@127.0.0.1:9',
    'http://user:secret@127.0.0.1:9',
    'http://0.0.0.0:80',
    'http://127.0.0.2:9',
    'ftp://127.0.0.1',
    'http://[::1]x',
    'not a url',
  ];
  for (const override of DISGUISED) {
    scenario(`@error refuses ${JSON.stringify(override)} with ${EndpointRefusal.NOT_LOOPBACK} and returns no partial table`, () => {
      expect(refusalOf(() => under(override))).toBe(EndpointRefusal.NOT_LOOPBACK);
    });
  }
});
