// PURE. RED scaffold (created by DISTILL for install-subcommand): signature only.
// Reading the recognised fields out of `launchctl print` text is DELIVER's. The function throws, so an unskipped scenario
// classifies as RED, not BROKEN. `harvest.mjs` does not import this module yet.
export const __SCAFFOLD__ = true;

const notImplemented = (name) => {
  throw new Error(`RED scaffold: ${name} is not implemented`);
};

/**
 * @param {string} text what `launchctl print gui/<uid>/<label>` printed; any text at all
 * @returns {{ state: string, runs: string, lastExitCode: string, pid: string }} each field as printed after its `=`, or `'unknown'` when absent; never throws
 */
export function readLaunchdPrint(text) {
  return notImplemented('readLaunchdPrint');
}
