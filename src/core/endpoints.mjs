// PURE. Where the Google endpoints are. The only override is a loopback base URL,
// so a redirected endpoint can never carry a token off the machine.
export const ENDPOINT_OVERRIDE_ENV = 'HARVEST_API_BASE_URL';

export const EndpointRefusal = Object.freeze({
  NOT_LOOPBACK: 'gmail.base-url-not-loopback',
});

const GOOGLE_ENDPOINTS = Object.freeze({
  gmailBase: 'https://gmail.googleapis.com/gmail/v1',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  authUri: 'https://accounts.google.com/o/oauth2/v2/auth',
});

const LOOPBACK_HOSTNAMES = Object.freeze(['127.0.0.1', 'localhost', '[::1]']);
const LOOPBACK_PROTOCOLS = Object.freeze(['http:', 'https:']);

const parseUrl = (text) => {
  try {
    return new URL(text);
  } catch {
    return null;
  }
};

const isLoopbackOrigin = (url) =>
  url !== null &&
  LOOPBACK_PROTOCOLS.includes(url.protocol) &&
  LOOPBACK_HOSTNAMES.includes(url.hostname) &&
  url.username === '' &&
  url.password === '';

const refuseNotLoopback = () => {
  throw Object.assign(new Error(`${ENDPOINT_OVERRIDE_ENV} must name a loopback host`), {
    code: EndpointRefusal.NOT_LOOPBACK,
  });
};

const endpointsUnder = (base) => ({
  gmailBase: `${base}/gmail/v1`,
  tokenEndpoint: `${base}/token`,
  authUri: `${base}/o/oauth2/v2/auth`,
});

/** @param {Record<string, string|undefined>} env @returns {{ gmailBase: string, tokenEndpoint: string, authUri: string }} */
export function resolveEndpoints(env) {
  const override = env[ENDPOINT_OVERRIDE_ENV];
  if (override === undefined || override === '') return GOOGLE_ENDPOINTS;
  const url = parseUrl(override);
  return isLoopbackOrigin(url) ? endpointsUnder(url.origin) : refuseNotLoopback();
}
