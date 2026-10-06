// PURE. RED scaffold (created by DISTILL for install-subcommand): signatures and constants only.
// The text of the LaunchAgent plist and of its wrapper script, the `HH:MM` reading, the escaping and the node-path choice are
// DELIVER's. Each behavioural function throws, so an unskipped scenario classifies as RED, not BROKEN. `harvest.mjs` does not
// import this module yet.
import { InstallRefusal } from './install-plan.mjs';

export const __SCAFFOLD__ = true;

/** The one job label (Q-label, recommended A): no personal data in it. */
export const LABEL = 'local.job-alert-harvester.update';
/** The quiet hour chosen against DR-0012 (Sheets write window risk). */
export const DEFAULT_AT = '05:30';

const AT_TEXT = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

const notImplemented = (name) => {
  throw new Error(`RED scaffold: ${name} is not implemented`);
};

/**
 * @param {string} text the value of `--at`
 * @returns {{ hour: number, minute: number } | { refusal: 'install.invalid-time' }} two digits `00`-`23`, a colon, two digits `00`-`59`; anything else is the refusal
 */
export function parseAt(text) {
  const match = AT_TEXT.exec(text);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : { refusal: InstallRefusal.INVALID_TIME };
}

/**
 * @param {{ root: string, home: string, nodePath: string, hour: number, minute: number }} spec absolute paths; `root` is the checkout
 * @returns {string} the plist text, marked as generated, every string XML-escaped
 */
export function renderPlist(spec) {
  return notImplemented('renderPlist');
}

/**
 * @param {{ root: string, home: string, nodePath: string, hour: number, minute: number }} spec as renderPlist
 * @returns {string} the wrapper script text, every embedded path single-quoted
 */
export function renderWrapper(spec) {
  return notImplemented('renderWrapper');
}

/** @param {string} text @returns {string} `text` as one `sh` word that reads back as exactly `text` */
export function shellQuote(text) {
  return notImplemented('shellQuote');
}

/** @param {string} text @returns {string} `text` safe inside an XML text node */
export function xmlEscape(text) {
  return notImplemented('xmlEscape');
}

/**
 * @param {string} root the checkout
 * @param {string} home the home directory
 * @returns {{ plist: string, wrapper: string, outLog: string, errLog: string }} absolute paths
 */
export function pathsFor(root, home) {
  return notImplemented('pathsFor');
}

/**
 * @param {{ path: string, realPath: string }[]} candidates the `PATH` entries that hold a `node`, in `PATH` order, with their real paths
 * @param {string} execPath the running binary
 * @returns {string} the first candidate's `path` whose `realPath` equals `execPath`, else `execPath`
 */
export function chooseNodePath(candidates, execPath) {
  return notImplemented('chooseNodePath');
}
