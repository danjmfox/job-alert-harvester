// Orchestration of `harvest install`: plan, probe, write, say what was done. Capabilities arrive as arguments.
import { DEFAULT_AT, parseAt, pathsFor } from '../core/launch-agent.mjs';
import { InstallRefusal, planInstall, planUninstall, platformRefusalFor, reportStatus } from '../core/install-plan.mjs';

const PREFIX = 'harvest install:';
const PREVIEW_PREFIX = 'harvest install --dry-run:';

const refuse = (code, detail) => {
  throw Object.assign(new Error(`${code}: ${detail}`), { code });
};

/** Platform first, then the time: both are settled from the command line alone, before any fact is read. */
export function refuseBeforeReading({ platform, options }) {
  const unsupported = platformRefusalFor(platform);
  if (unsupported !== null) refuse(unsupported.refusal, unsupported.detail);
  const { refusal } = parseAt(options.at ?? DEFAULT_AT);
  if (refusal !== undefined) refuse(refusal, String(options.at));
}

const describeCheckout = ({ checkout }, root) => {
  if (checkout === null) return `checkout ${root} (not a git checkout, or git cannot be run)`;
  return `checkout ${root} at ${checkout.commit} ${checkout.branch === null ? 'detached' : `on ${checkout.branch}`}`;
};

const checkoutLines = (plan, root, prefix) => [`${prefix} ${describeCheckout(plan, root)}`, `${prefix} the job runs whatever this checkout holds`];

const planLines = (plan, root, prefix) => [
  ...checkoutLines(plan, root, prefix),
  ...plan.files.map(({ action, path }) => `${prefix} ${action} ${path}`),
  ...plan.reload.map((command) => `${prefix} ${command}`),
];

const nextLine = (plan, prefix) => `${prefix} next: ${plan.next}`;

const warningLines = (plan, prefix) => plan.warnings.map((warning) => `${prefix} warning: ${warning}`);

const textLines = (plan, prefix) => plan.files.flatMap(({ path, text }) => [`${prefix} ${path} would hold:`, text]);

const intervalsOrNull = (readLedger) => {
  try {
    return readLedger();
  } catch {
    return null;
  }
};

const planFor = ({ facts, options, readLedger, source, now }) => {
  const baseline = { intervals: intervalsOrNull(readLedger), source, nowIso: now() };
  const plan = planInstall({ ...facts, baseline }, options);
  if (plan.refusal !== undefined) refuse(plan.refusal, plan.detail);
  return plan;
};

const changesNothing = ({ files }) => files.every(({ action }) => action === 'unchanged');

const succeeded = (result) => {
  if (!result.ok) refuse(InstallRefusal.LAUNCHCTL_FAILED, `${result.command} ${result.detail}`);
};

/** The fixed call order: the session, then the job; a loaded job is booted out before it is bootstrapped; then the job is asked about again. */
const loadJob = ({ domain, job, reader, controller }, print) => {
  succeeded(controller.probeSession());
  if (reader.jobIsLoaded()) succeeded(controller.bootout());
  succeeded(controller.bootstrap());
  if (!reader.jobIsLoaded()) refuse(InstallRefusal.LAUNCHCTL_FAILED, `${job} is not loaded after bootstrap in ${domain}`);
  print(`${PREFIX} loaded ${job}`);
};

/**
 * @param {{ facts: object, options: { at?: string }, writer: { probe: (directories: string[]) => void, makeDirectory: (path: string) => void,
 *           write: (path: string, text: string, mode: number) => void }, print: (line: string) => void }} capabilities
 *        `readLedger` throws when the ledger cannot be read, which counts as no baseline; `warn` writes a stderr line;
 *        `launchctl` is handed in only for `--load`, so a plain install cannot call it; it is used after the files are written
 */
export function runInstall({ facts, options, readLedger, source, now, writer, print, warn, launchctl }) {
  const plan = planFor({ facts, options, readLedger, source, now });
  warningLines(plan, PREFIX).forEach(warn);
  if (!changesNothing(plan)) {
    writer.probe(plan.directories);
    plan.directories.forEach(writer.makeDirectory);
    plan.files.filter(({ action }) => action !== 'unchanged').forEach(({ path, text, mode }) => writer.write(path, text, mode));
  }
  planLines(plan, facts.root, PREFIX).forEach(print);
  print(nextLine(plan, PREFIX));
  if (launchctl !== undefined) loadJob(launchctl, print);
}

/**
 * The preview of `harvest install --dry-run`: handed facts the file reader already gathered, no writer and no launchctl, so it
 * cannot write or call. It prints the plan, then the exact text a real install writes.
 * @param {{ facts: object, options: { at?: string }, print: (line: string) => void }} capabilities
 */
export function runInstallPreview({ facts, options, readLedger, source, now, print, warn }) {
  const plan = planFor({ facts, options, readLedger, source, now });
  warningLines(plan, PREVIEW_PREFIX).forEach(warn);
  [...planLines(plan, facts.root, PREVIEW_PREFIX), nextLine(plan, PREVIEW_PREFIX), ...textLines(plan, PREVIEW_PREFIX)].forEach(print);
}

const logOf = (reader, path) => {
  const text = reader.readText(path);
  return text === null ? null : { text, modified: reader.modifiedTime(path) };
};

const statusFactsOf = ({ root, home, nodePath }, reader) => {
  const paths = pathsFor(root, home);
  return {
    root,
    home,
    existing: { plist: reader.readText(paths.plist), wrapper: reader.readText(paths.wrapper) },
    nodePath,
    nodePresent: reader.isExecutable(nodePath),
    logs: { out: logOf(reader, paths.outLog), err: logOf(reader, paths.errLog) },
  };
};

/**
 * `harvest status`: handed facts, the file reader and the launchctl reader only, with no writer and no controller, so it cannot write or control.
 * @param {{ facts: object, reader: { readText, modifiedTime, isExecutable }, launchctl: { reader: { printJob: () => object } }, print: (line: string) => void, warn: (line: string) => void }} capabilities
 */
export function runStatus({ facts, reader, launchctl, print, warn }) {
  const report = reportStatus(statusFactsOf(facts, reader), launchctl.reader.printJob());
  if (report.refusal !== undefined) {
    report.raw.forEach(warn);
    refuse(report.refusal, report.detail);
  }
  report.stderr.forEach(warn);
  report.stdout.forEach(print);
}

const UNINSTALL_PREFIX = 'harvest uninstall:';
const UNINSTALL_PREVIEW_PREFIX = 'harvest uninstall --dry-run:';

const uninstallPlanFor = (facts, options, loaded) => {
  const plan = planUninstall({ ...facts, loaded }, options);
  if (plan.refusal !== undefined) refuse(plan.refusal, plan.detail);
  return plan;
};

const nothingToRemove = ({ bootout, files }) => bootout === null && files.length === 0;

const removeLine = (prefix, path) => `${prefix} remove ${path}`;

const removeFile = (writer, path) => {
  try {
    writer.remove(path);
  } catch (error) {
    refuse(InstallRefusal.NOT_WRITABLE, `${path} (${error.code ?? error.message})`);
  }
};

/**
 * `harvest uninstall`: boots the job out while both files still exist, then removes the plist, then the wrapper. A failed bootout leaves both files.
 * @param {{ facts: object, options: { flags?: Set<string> }, writer: { remove: (path: string) => void },
 *           launchctl: { reader: { jobIsLoaded: () => boolean }, controller: { bootout: () => object } }, print: (line: string) => void }} capabilities
 */
export function runUninstall({ facts, options, writer, launchctl, print }) {
  const plan = uninstallPlanFor(facts, options, launchctl.reader.jobIsLoaded());
  if (nothingToRemove(plan)) return print(`${UNINSTALL_PREFIX} nothing to remove`);
  if (plan.bootout !== null) {
    succeeded(launchctl.controller.bootout());
    print(`${UNINSTALL_PREFIX} ${plan.bootout}`);
  }
  plan.files.forEach(({ path }) => {
    removeFile(writer, path);
    print(removeLine(UNINSTALL_PREFIX, path));
  });
}

/**
 * The preview of `harvest uninstall --dry-run`: handed facts and the launchctl reader only, so it can neither remove nor control.
 * @param {{ facts: object, options: { flags?: Set<string> }, launchctl: { reader: { jobIsLoaded: () => boolean } }, print: (line: string) => void }} capabilities
 */
export function runUninstallPreview({ facts, options, launchctl, print }) {
  const plan = uninstallPlanFor(facts, options, launchctl.reader.jobIsLoaded());
  if (nothingToRemove(plan)) return print(`${UNINSTALL_PREVIEW_PREFIX} nothing to remove`);
  if (plan.bootout !== null) print(`${UNINSTALL_PREVIEW_PREFIX} ${plan.bootout}`);
  plan.files.forEach(({ path }) => print(removeLine(UNINSTALL_PREVIEW_PREFIX, path)));
}
