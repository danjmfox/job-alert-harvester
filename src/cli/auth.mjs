// Orchestration of the one-off consent: `harvest auth`.
export const __SCAFFOLD__ = true;

/**
 * @param {{ store: object, fetch: Function, loopback: object, endpoints: object,
 *           random: (bytes: number) => Uint8Array, sha256: (text: string) => Uint8Array,
 *           now: () => string, print: (line: string) => void }} collaborators
 * @returns {Promise<{ emailAddress: string }>}
 */
export async function runAuth(_collaborators) {
  throw new Error('RED scaffold: runAuth is not implemented');
}
