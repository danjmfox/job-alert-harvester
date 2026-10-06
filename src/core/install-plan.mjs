// PURE. Partly real: `planInstall` plans the create path only. Replace, unchanged and refuse, the uninstall plan and the status
// report are still scaffold and throw, so an unskipped scenario classifies as RED, not BROKEN.
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

const MODE_PLIST = 0o644;
const MODE_WRAPPER = 0o755;

const parentOf = (path) => path.slice(0, path.lastIndexOf('/'));

const fileToCreate = (path, text, mode) => ({ action: 'create', path, text, mode });

/**
 * The create path. `facts.paths` and `facts.texts` are what install would write, rendered by the shell: this module and
 * `launch-agent.mjs` import each other's refusal codes, so neither can import the other's functions.
 * @param {{ uid: number, existing: { plist: string | null, wrapper: string | null }, paths: { plist: string, wrapper: string, outLog: string, errLog: string }, texts: { plist: string, wrapper: string } }} facts
 * @param {object} options the parsed command line
 * @returns {{ files: object[], directories: string[], next: string }} wrapper first, then plist; `next` is the command that loads the job
 */
export function planInstall(facts, options) {
  const { uid, existing, paths, texts } = facts;
  if (existing.plist !== null || existing.wrapper !== null) return notImplemented('planInstall over existing files');
  return {
    files: [fileToCreate(paths.wrapper, texts.wrapper, MODE_WRAPPER), fileToCreate(paths.plist, texts.plist, MODE_PLIST)],
    directories: [parentOf(paths.wrapper), parentOf(paths.outLog), parentOf(paths.plist)],
    next: `launchctl bootstrap gui/${uid} ${paths.plist}`,
  };
}

/** @param {object} facts @param {object} options @returns {object} an uninstall plan value or `{ refusal }` */
export function planUninstall(facts, options) {
  return notImplemented('planUninstall');
}

/** @param {object} facts @param {object} printed what `readLaunchdPrint` returned @returns {{ stdout: string[], stderr: string[] }} the status report */
export function reportStatus(facts, printed) {
  return notImplemented('reportStatus');
}
