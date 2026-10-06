// PURE. Partly real: `planInstall` is real. The uninstall plan and the status
// report are still scaffold and throw, so an unskipped scenario classifies as RED, not BROKEN.
export const __SCAFFOLD__ = true;

import { UpdateRefusal, planUpdateRange } from './update-plan.mjs';

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

const COMMENT_LINE = /^<!--.*-->$/m;
const stringValueOf = (key) => new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`);
const LABEL_ENTRY = stringValueOf('Label');
const WORKING_DIRECTORY = stringValueOf('WorkingDirectory');

const commentOf = (plistText) => COMMENT_LINE.exec(plistText)?.[0] ?? null;
const workingDirectoryOf = (plistText) => WORKING_DIRECTORY.exec(plistText)?.[1] ?? null;
const labelOf = (plistText) => LABEL_ENTRY.exec(plistText)?.[1] ?? null;

const actionFor = (existingText, text) => {
  if (existingText === null) return 'create';
  return existingText === text ? 'unchanged' : 'replace';
};

const fileToWrite = (path, existingText, text, mode) => ({ action: actionFor(existingText, text), path, text, mode });

/** @returns {{ refusal: string, detail: string } | null} why the plist already in place may not be replaced without --force */
const refusalFor = (existingPlist, plistText, plistPath) => {
  if (existingPlist === null) return null;
  if (commentOf(existingPlist) !== commentOf(plistText)) return { refusal: InstallRefusal.FOREIGN_PLIST, detail: plistPath };
  const installedFrom = workingDirectoryOf(existingPlist);
  if (installedFrom !== workingDirectoryOf(plistText)) return { refusal: InstallRefusal.OTHER_CHECKOUT, detail: `${plistPath} runs ${installedFrom}` };
  return null;
};

const SUPPORTED_PLATFORM = 'darwin';

/** @returns {{ refusal: string, detail: string } | null} why this platform cannot host a launchd job */
export const platformRefusalFor = (platform) =>
  platform === SUPPORTED_PLATFORM ? null : { refusal: InstallRefusal.UNSUPPORTED_PLATFORM, detail: `${platform} (launchd is macOS only)` };

/** @returns {{ refusal: string, detail: string } | null} why this is not the checkout the running script belongs to; cwd is the root, so a subdirectory has no script of its own */
const identityRefusalFor = ({ root, identity }) =>
  identity.here === identity.running ? null : { refusal: InstallRefusal.WRONG_DIRECTORY, detail: `${root} is not the checkout this harvest runs from` };

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/** @returns {{ refusal: string, detail: string } | null} why an embedded path cannot be quoted: relative, or holding a control character or newline */
const unsafePathRefusalFor = ({ root, home, nodePath }) => {
  const unsafe = [root, home, nodePath].find((path) => !path.startsWith('/') || CONTROL_CHARACTER.test(path));
  return unsafe === undefined ? null : { refusal: InstallRefusal.UNSAFE_PATH, detail: JSON.stringify(unsafe) };
};

const MAIN_BRANCH = 'main';

/** @returns {{ refusal: string, detail: string } | null} why the checkout cannot be confirmed to be on main; absent or detached is never main */
const branchRefusalFor = (checkout) => {
  if (checkout === null) return { refusal: InstallRefusal.NOT_ON_MAIN, detail: 'not a git checkout (or git cannot be run)' };
  if (checkout.branch === null) return { refusal: InstallRefusal.NOT_ON_MAIN, detail: `detached at ${checkout.commit}` };
  if (checkout.branch !== MAIN_BRANCH) return { refusal: InstallRefusal.NOT_ON_MAIN, detail: checkout.branch };
  return null;
};

const PROTECTED_FOLDER = 'Documents';
const VERSIONED_SEGMENT = /\/v?\d+\.\d+(\.\d+)?\//;

const baselineWarning = ({ intervals, source, nowIso }) =>
  intervals !== null && planUpdateRange(intervals, source, nowIso, undefined).refusal === undefined
    ? []
    : [`${UpdateRefusal.NO_BASELINE}: the daily update would refuse until a fetch has covered some days; run harvest fetch --from <day>`];

const nodeWarning = (nodePath) =>
  VERSIONED_SEGMENT.test(nodePath) ? [`the pinned node ${nodePath} holds a version number; upgrading node would break the job, so run harvest install again afterwards`] : [];

const protectedFolderWarning = ({ root, home }) =>
  root.startsWith(`${home}/${PROTECTED_FOLDER}/`) ? [`the checkout ${root} is under ${PROTECTED_FOLDER}, which macOS may not let a launchd job read`] : [];

const warningsFor = (facts) => [...baselineWarning(facts.baseline), ...nodeWarning(facts.nodePath), ...protectedFolderWarning(facts)];

const reloadCommands = (files, uid, label) =>
  files.some(({ path, action }) => action === 'replace' && path.endsWith('.plist')) ? [`launchctl bootout gui/${uid}/${label}`] : [];

/**
 * Compares what exists with what install would write: a marked plist with the same text is `unchanged`, with other text `replace`;
 * a plist without the generated marker, or one that works in another checkout, is refused unless `--force`.
 * Before any of that, a directory that is not the running checkout or a path that cannot be embedded safely is refused, then a checkout not confirmed to be on `main` is refused unless `--allow-any-branch`.
 * `facts.paths` and `facts.texts` are what install would write, rendered by the shell: this module and
 * `launch-agent.mjs` import each other's refusal codes, so neither can import the other's functions.
 * @param {{ uid: number, baseline: { intervals: object[] | null, source: string, nowIso: string }, checkout: { commit: string, branch: string | null } | null, existing: { plist: string | null, wrapper: string | null }, paths: { plist: string, wrapper: string, outLog: string, errLog: string }, texts: { plist: string, wrapper: string } }} facts
 * @param {{ flags?: Set<string> }} options the parsed command line
 * @returns {{ refusal: string, detail: string } | { files: object[], directories: string[], reload: string[], next: string }}
 *          `checkout` is what the shell read; wrapper first, then plist; `reload` lists what stops the old job before `next`, the command that loads the new one
 */
export function planInstall(facts, options) {
  const { uid, checkout, existing, paths, texts } = facts;
  const placeRefusal = identityRefusalFor(facts) ?? unsafePathRefusalFor(facts);
  if (placeRefusal !== null) return placeRefusal;
  const branchRefusal = options.flags?.has('allow-any-branch') ? null : branchRefusalFor(checkout);
  if (branchRefusal !== null) return branchRefusal;
  const refusal = options.flags?.has('force') ? null : refusalFor(existing.plist, texts.plist, paths.plist);
  if (refusal !== null) return refusal;
  const files = [
    fileToWrite(paths.wrapper, existing.wrapper, texts.wrapper, MODE_WRAPPER),
    fileToWrite(paths.plist, existing.plist, texts.plist, MODE_PLIST),
  ];
  return {
    checkout,
    warnings: warningsFor(facts),
    files,
    directories: [parentOf(paths.wrapper), parentOf(paths.outLog), parentOf(paths.plist)],
    reload: reloadCommands(files, uid, labelOf(texts.plist)),
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
