// Orchestration of `harvest install`: plan, probe, write, say what was done. Capabilities arrive as arguments.
import { DEFAULT_AT, parseAt, renderPlist, renderWrapper } from '../core/launch-agent.mjs';
import { planInstall } from '../core/install-plan.mjs';

const PREFIX = 'harvest install:';
const PREVIEW_PREFIX = 'harvest install --dry-run:';

const refuse = (code, detail) => {
  throw Object.assign(new Error(`${code}: ${detail}`), { code });
};

const textsFor = ({ root, home, nodePath }, at) => {
  const { hour, minute, refusal } = parseAt(at ?? DEFAULT_AT);
  if (refusal !== undefined) refuse(refusal, String(at));
  const spec = { root, home, nodePath, hour, minute };
  return { plist: renderPlist(spec), wrapper: renderWrapper(spec) };
};

const planLines = (plan, prefix) => [
  ...plan.files.map(({ action, path }) => `${prefix} ${action} ${path}`),
  `${prefix} next: ${plan.next}`,
];

const textLines = (plan, prefix) => plan.files.flatMap(({ path, text }) => [`${prefix} ${path} would hold:`, text]);

const planFor = (facts, options) => planInstall({ ...facts, texts: textsFor(facts, options.at) }, options);

/**
 * @param {{ facts: object, options: { at?: string }, writer: { probe: (directories: string[]) => void, makeDirectory: (path: string) => void,
 *           write: (path: string, text: string, mode: number) => void }, print: (line: string) => void }} capabilities
 *        no launchctl capability is handed in, so a plain install cannot call it
 */
export function runInstall({ facts, options, writer, print }) {
  const plan = planFor(facts, options);
  writer.probe(plan.directories);
  plan.directories.forEach(writer.makeDirectory);
  plan.files.forEach(({ path, text, mode }) => writer.write(path, text, mode));
  planLines(plan, PREFIX).forEach(print);
}

/**
 * The preview of `harvest install --dry-run`: handed facts the file reader already gathered, no writer and no launchctl, so it
 * cannot write or call. It prints the plan, then the exact text a real install writes.
 * @param {{ facts: object, options: { at?: string }, print: (line: string) => void }} capabilities
 */
export function runInstallPreview({ facts, options, print }) {
  const plan = planFor(facts, options);
  [...planLines(plan, PREVIEW_PREFIX), ...textLines(plan, PREVIEW_PREFIX)].forEach(print);
}
