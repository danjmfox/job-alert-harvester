// Orchestration of `harvest install`: plan, probe, write, say what was done. Capabilities arrive as arguments.
import { DEFAULT_AT, parseAt, renderPlist, renderWrapper } from '../core/launch-agent.mjs';
import { planInstall } from '../core/install-plan.mjs';

const PREFIX = 'harvest install:';

const refuse = (code, detail) => {
  throw Object.assign(new Error(`${code}: ${detail}`), { code });
};

const textsFor = ({ root, home, nodePath }, at) => {
  const { hour, minute, refusal } = parseAt(at ?? DEFAULT_AT);
  if (refusal !== undefined) refuse(refusal, String(at));
  const spec = { root, home, nodePath, hour, minute };
  return { plist: renderPlist(spec), wrapper: renderWrapper(spec) };
};

const reportLine = ({ action, path }) => `${PREFIX} ${action} ${path}`;

/**
 * @param {{ facts: object, options: { at?: string }, writer: { probe: (directories: string[]) => void, makeDirectory: (path: string) => void,
 *           write: (path: string, text: string, mode: number) => void }, print: (line: string) => void }} capabilities
 *        no launchctl capability is handed in, so a plain install cannot call it
 */
export function runInstall({ facts, options, writer, print }) {
  const plan = planInstall({ ...facts, texts: textsFor(facts, options.at) }, options);
  writer.probe(plan.directories);
  plan.directories.forEach(writer.makeDirectory);
  plan.files.forEach(({ path, text, mode }) => writer.write(path, text, mode));
  plan.files.map(reportLine).forEach(print);
  print(`${PREFIX} next: ${plan.next}`);
}
