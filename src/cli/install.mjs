// Orchestration of `harvest install`: plan, probe, write, say what was done. Capabilities arrive as arguments.
import { DEFAULT_AT, parseAt, renderPlist, renderWrapper } from '../core/launch-agent.mjs';
import { planInstall, platformRefusalFor } from '../core/install-plan.mjs';

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

const textsFor = ({ root, home, nodePath }, at) => {
  const { hour, minute, refusal } = parseAt(at ?? DEFAULT_AT);
  if (refusal !== undefined) refuse(refusal, String(at));
  const spec = { root, home, nodePath, hour, minute };
  return { plist: renderPlist(spec), wrapper: renderWrapper(spec) };
};

const describeCheckout = ({ checkout }, root) => {
  if (checkout === null) return `checkout ${root} (not a git checkout, or git cannot be run)`;
  return `checkout ${root} at ${checkout.commit} ${checkout.branch === null ? 'detached' : `on ${checkout.branch}`}`;
};

const checkoutLines = (plan, root, prefix) => [`${prefix} ${describeCheckout(plan, root)}`, `${prefix} the job runs whatever this checkout holds`];

const planLines = (plan, root, prefix) => [
  ...checkoutLines(plan, root, prefix),
  ...plan.files.map(({ action, path }) => `${prefix} ${action} ${path}`),
  ...plan.reload.map((command) => `${prefix} ${command}`),
  `${prefix} next: ${plan.next}`,
];

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
  const plan = planInstall({ ...facts, baseline, texts: textsFor(facts, options.at) }, options);
  if (plan.refusal !== undefined) refuse(plan.refusal, plan.detail);
  return plan;
};

const changesNothing = ({ files }) => files.every(({ action }) => action === 'unchanged');

/**
 * @param {{ facts: object, options: { at?: string }, writer: { probe: (directories: string[]) => void, makeDirectory: (path: string) => void,
 *           write: (path: string, text: string, mode: number) => void }, print: (line: string) => void }} capabilities
 *        `readLedger` throws when the ledger cannot be read, which counts as no baseline; `warn` writes a stderr line;
 *        no launchctl capability is handed in, so a plain install cannot call it
 */
export function runInstall({ facts, options, readLedger, source, now, writer, print, warn }) {
  const plan = planFor({ facts, options, readLedger, source, now });
  warningLines(plan, PREFIX).forEach(warn);
  if (!changesNothing(plan)) {
    writer.probe(plan.directories);
    plan.directories.forEach(writer.makeDirectory);
    plan.files.filter(({ action }) => action !== 'unchanged').forEach(({ path, text, mode }) => writer.write(path, text, mode));
  }
  planLines(plan, facts.root, PREFIX).forEach(print);
}

/**
 * The preview of `harvest install --dry-run`: handed facts the file reader already gathered, no writer and no launchctl, so it
 * cannot write or call. It prints the plan, then the exact text a real install writes.
 * @param {{ facts: object, options: { at?: string }, print: (line: string) => void }} capabilities
 */
export function runInstallPreview({ facts, options, readLedger, source, now, print, warn }) {
  const plan = planFor({ facts, options, readLedger, source, now });
  warningLines(plan, PREVIEW_PREFIX).forEach(warn);
  [...planLines(plan, facts.root, PREVIEW_PREFIX), ...textLines(plan, PREVIEW_PREFIX)].forEach(print);
}
