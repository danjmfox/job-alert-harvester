// Driven adapter: the one-shot loopback listener that receives the consent redirect.
// Bounded change universe: one 127.0.0.1 socket, closed on return.
export const __SCAFFOLD__ = true;

const scaffold = async (name) => {
  throw new Error(`RED scaffold: oauth-loopback ${name} is not implemented`);
};

/**
 * @param {{ timeoutMs: number }} options
 * @returns {{ listen: () => Promise<{ redirectUri: string, awaitCallback: () => Promise<string>, close: () => void }> }}
 */
export function createOAuthLoopback(_options) {
  return { listen: () => scaffold('listen') };
}
