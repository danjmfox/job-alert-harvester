// PURE. The plans and the report of install, uninstall and status.

import { UpdateRefusal, planUpdateRange } from './update-plan.mjs';
import { readLaunchdPrint } from './launchd-print.mjs';

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

/**
 * What uninstall would do to the one job: boot it out if launchd holds it, then remove the plist, then the wrapper, each only if it exists.
 * A plist without the generated marker is refused unless `--force`.
 * @param {{ uid: number, label: string, loaded: boolean, existing: { plist: string | null, wrapper: string | null }, paths: { plist: string, wrapper: string }, expectedPlist: string }} facts
 * @param {{ flags?: Set<string> }} options the parsed command line
 * @returns {{ refusal: string, detail: string } | { bootout: string | null, files: { action: 'remove', path: string }[] }} `bootout` is the command, or null when the job is not loaded
 */
export function planUninstall({ uid, label, loaded, existing, paths, expectedPlist }, options) {
  const foreign = existing.plist !== null && commentOf(existing.plist) !== commentOf(expectedPlist);
  if (foreign && !options.flags?.has('force')) return { refusal: InstallRefusal.FOREIGN_PLIST, detail: paths.plist };
  const files = [
    { path: paths.plist, text: existing.plist },
    { path: paths.wrapper, text: existing.wrapper },
  ]
    .filter(({ text }) => text !== null)
    .map(({ path }) => ({ action: 'remove', path }));
  return { bootout: loaded ? `launchctl bootout gui/${uid}/${label}` : null, files };
}

const STATUS_PREFIX = 'harvest status:';
const RAW_LINES_SHOWN = 20;
const UNKNOWN = 'unknown';
const NONE = 'none';

const HOUR_ENTRY = /<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/;
const MINUTE_ENTRY = /<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/;

/** @returns {{ hour: number, minute: number } | null} the schedule a plist carries, whoever wrote it */
export const scheduleOf = (plistText) => {
  const hour = HOUR_ENTRY.exec(plistText ?? '')?.[1];
  const minute = MINUTE_ENTRY.exec(plistText ?? '')?.[1];
  return hour === undefined || minute === undefined ? null : { hour: Number(hour), minute: Number(minute) };
};

const twoDigits = (number) => String(number).padStart(2, '0');
const scheduleText = (plistText) => {
  const schedule = scheduleOf(plistText);
  return schedule === null ? UNKNOWN : `${twoDigits(schedule.hour)}:${twoDigits(schedule.minute)}`;
};

const isForeign = (existing, expected) => commentOf(existing) !== commentOf(expected);

const installedText = ({ plist }, expected) => (plist === null ? 'no' : isForeign(plist, expected) ? 'yes (foreign plist: not written by harvest install)' : 'yes');

const driftText = ({ plist, wrapper }, texts) => {
  if (plist !== null && isForeign(plist, texts.plist)) return 'not compared (foreign plist)';
  const differing = [
    ...(plist !== null && plist !== texts.plist ? ['plist'] : []),
    ...(wrapper !== null && wrapper !== texts.wrapper ? ['wrapper'] : []),
  ];
  return differing.length === 0 ? NONE : `${differing.join(' and ')} differ from what install would write`;
};

const nodeText = ({ nodePath, nodePresent }) => (nodePresent ? 'ok' : `missing ${nodePath}`);

const lastLineOf = (text) => (text ?? '').split(/\r?\n/).filter((line) => line.trim() !== '').at(-1) ?? NONE;
const logTimeText = (log) => (log === null ? NONE : log.modified);

const launchdLines = (printed) => [
  field('state', printed.state),
  field('runs', printed.runs),
  field('last exit code', printed.lastExitCode),
  field('pid', printed.pid),
];

const field = (name, value) => `${STATUS_PREFIX} ${name}: ${value}`;

const NEEDED_FROM_LAUNCHD = ['state', 'runs', 'lastExitCode'];
const recognisedFields = (read) => Object.values(read).filter((value) => value !== UNKNOWN);
const missingFields = (read) => NEEDED_FROM_LAUNCHD.filter((name) => read[name] === UNKNOWN);

const FIELD_NAMES = { state: 'state', runs: 'runs', lastExitCode: 'last exit code' };

const unrecognised = ({ command, text }) => ({
  refusal: InstallRefusal.UNRECOGNISED_OUTPUT,
  detail: `${command} printed nothing this harvest understands`,
  raw: text.split(/\r?\n/).slice(0, RAW_LINES_SHOWN),
});

/**
 * The read-only report. `facts`: `existing` (plist and wrapper text or null), `texts` (what install would write at the plist's own schedule),
 * `nodePath`, `nodePresent`, `logs` (`{ modified, text }` or null for `out` and `err`). `printed`: `{ loaded, text, command }` from `launchctl print`.
 * Loaded is the exit status of print, never its text.
 * @returns {{ stdout: string[], stderr: string[] } | { refusal: string, detail: string, raw: string[] }} the report, or a loaded job whose text yields no known field
 */
export function reportStatus(facts, printed) {
  const read = readLaunchdPrint(printed.loaded ? printed.text : '');
  if (printed.loaded && recognisedFields(read).length === 0) return unrecognised(printed);
  const { existing, texts, logs } = facts;
  const stdout = [
    field('installed', installedText(existing, texts.plist)),
    field('schedule', scheduleText(existing.plist)),
    field('drift', driftText(existing, texts)),
    field('node', nodeText(facts)),
    field('wrapper', existing.wrapper === null ? 'missing' : 'ok'),
    field('loaded', printed.loaded ? 'yes' : 'no'),
    ...(printed.loaded ? launchdLines(read) : []),
    field('output log', logTimeText(logs.out)),
    field('error log', logTimeText(logs.err)),
    field('last output line', lastLineOf(logs.out?.text)),
  ];
  const missing = printed.loaded ? missingFields(read) : [];
  const stderr = missing.length === 0 ? [] : [`${STATUS_PREFIX} ${printed.command} did not show ${missing.map((name) => FIELD_NAMES[name]).join(', ')}; they are reported as ${UNKNOWN}`];
  return { stdout, stderr };
}
