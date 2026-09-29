// PURE. Where the Google endpoints are. The only override is a loopback base URL,
// so a redirected endpoint can never carry a token off the machine.
export const __SCAFFOLD__ = true;

export const ENDPOINT_OVERRIDE_ENV = 'HARVEST_API_BASE_URL';

export const EndpointRefusal = Object.freeze({
  NOT_LOOPBACK: 'gmail.base-url-not-loopback',
});

/** @param {Record<string, string|undefined>} env @returns {{ gmailBase: string, tokenEndpoint: string, authUri: string }} */
export function resolveEndpoints(_env) {
  throw new Error('RED scaffold: resolveEndpoints is not implemented');
}
