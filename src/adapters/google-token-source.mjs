// Driven adapter: the Google token endpoint. Refreshes the access token once per
// process and persists a rotated refresh token only through the injected store.
export const __SCAFFOLD__ = true;

const scaffold = async (name) => {
  throw new Error(`RED scaffold: google-token-source ${name} is not implemented`);
};

/**
 * @param {{ store: object, fetch: Function, endpoints: object, nowMs: () => number, sleep: Function, jitter: () => number }} options
 * @returns {{ accessToken: Function, exchangeCode: Function, probe: Function }}
 */
export function createGoogleTokenSource(_options) {
  return {
    accessToken: (_options) => scaffold('accessToken'),
    exchangeCode: (_grant) => scaffold('exchangeCode'),
    probe: () => scaffold('probe'),
  };
}
