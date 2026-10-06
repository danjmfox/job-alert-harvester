// PURE. RED scaffold (created by DISTILL for install-subcommand): signatures and constants only.
// Deciding create, replace, unchanged or refuse, the uninstall plan and the status report are DELIVER's. Each behavioural
// function throws, so an unskipped scenario classifies as RED, not BROKEN. `harvest.mjs` does not import this module yet.
export const __SCAFFOLD__ = true;

/** The refusal codes install, uninstall and status name (DESIGN, "Refusal codes"). */
export const InstallRefusal = Object.freeze({
  UNSUPPORTED_PLATFORM: 'install.unsupported-platform',
  INVALID_TIME: 'install.invalid-time',
  WRONG_DIRECTORY: 'install.wrong-directory',
  NOT_ON_MAIN: 'install.not-on-main',
  FOREIGN_PLIST: 'install.foreign-plist',
  OTHER_CHECKOUT: 'install.other-checkout',
  UNSAFE_PATH: 'install.unsafe-path',
  NOT_WRITABLE: 'install.not-writable',
  LAUNCHCTL_FAILED: 'install.launchctl-failed',
  UNRECOGNISED_OUTPUT: 'install.unrecognised-output',
});

const notImplemented = (name) => {
  throw new Error(`RED scaffold: ${name} is not implemented`);
};

/** @param {object} facts the host facts the composition root gathers @param {object} options the parsed command line @returns {object} an install plan value or `{ refusal }` */
export function planInstall(facts, options) {
  return notImplemented('planInstall');
}

/** @param {object} facts @param {object} options @returns {object} an uninstall plan value or `{ refusal }` */
export function planUninstall(facts, options) {
  return notImplemented('planUninstall');
}

/** @param {object} facts @param {object} printed what `readLaunchdPrint` returned @returns {{ stdout: string[], stderr: string[] }} the status report */
export function reportStatus(facts, printed) {
  return notImplemented('reportStatus');
}
