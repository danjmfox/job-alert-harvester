// PURE. Reads the recognised fields out of `launchctl print` text; whether the job is loaded is launchctl's exit status, not read here.
const UNKNOWN = 'unknown';

const FIELD_LABELS = Object.freeze([
  ['state', 'state'],
  ['runs', 'runs'],
  ['lastExitCode', 'last exit code'],
  ['pid', 'pid'],
]);

const printedValue = (lines, label) => {
  const prefix = `${label} =`;
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  const value = line === undefined ? '' : line.slice(prefix.length).trim();
  return value === '' ? UNKNOWN : value;
};

/**
 * @param {string} text what `launchctl print gui/<uid>/<label>` printed; any text at all
 * @returns {{ state: string, runs: string, lastExitCode: string, pid: string }} each field as printed after its `=`, or `'unknown'` when absent; never throws
 */
export function readLaunchdPrint(text) {
  const lines = typeof text === 'string' ? text.split(/\r?\n/).map((line) => line.trimStart()) : [];
  return Object.fromEntries(FIELD_LABELS.map(([field, label]) => [field, printedValue(lines, label)]));
}
