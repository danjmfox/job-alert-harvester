import { isCalendarDay } from './coverage.mjs';

// PURE. Every subcommand (and the rebuild form) declares its options here; a command line that strays from the table is refused.

export const CliRefusal = Object.freeze({
  UNKNOWN_OPTION: 'cli.unknown-option',
  UNEXPECTED_ARGUMENT: 'cli.unexpected-argument',
  DUPLICATE_OPTION: 'cli.duplicate-option',
  MISSING_VALUE: 'cli.missing-value',
  INVALID_DATE: 'cli.invalid-date',
});

const VALUE = 'value';
const FLAG = 'flag';

export const OPTION_TABLES = Object.freeze({
  rebuild: Object.freeze({ in: VALUE, out: VALUE }),
  'plan-fetch': Object.freeze({ source: VALUE, from: VALUE, to: VALUE, batch: VALUE }),
  ingest: Object.freeze({ raw: VALUE, window: VALUE, expect: VALUE, complete: FLAG }),
  build: Object.freeze({ out: VALUE, merge: VALUE, report: VALUE, target: VALUE, 'dry-run': FLAG }),
  fetch: Object.freeze({ source: VALUE, from: VALUE, to: VALUE }),
  auth: Object.freeze({ target: VALUE }),
  import: Object.freeze({ from: VALUE }),
  update: Object.freeze({ from: VALUE, 'dry-run': FLAG }),
  install: Object.freeze({ at: VALUE, 'dry-run': FLAG, load: FLAG, force: FLAG, 'allow-any-branch': FLAG }),
  uninstall: Object.freeze({ 'dry-run': FLAG, force: FLAG }),
  status: Object.freeze({}),
});

const RANGE_SEPARATOR = '..';
const asOneDay = (text) => [text];
// Without the separator the command's own shape refusal applies; empty ends are left to it too.
const asRangeEnds = (text) => (text.includes(RANGE_SEPARATOR) ? text.split(RANGE_SEPARATOR).filter((end) => end !== '') : []);

/** Options whose value is a day, or a range of days, and how to read the days out of the value. */
export const DATE_OPTIONS = Object.freeze({
  'plan-fetch': Object.freeze({ from: asOneDay, to: asOneDay }),
  fetch: Object.freeze({ from: asOneDay, to: asOneDay }),
  update: Object.freeze({ from: asOneDay }),
  ingest: Object.freeze({ window: asRangeEnds }),
});

const OPTION_PREFIX = '--';
const HINT_DISTANCE = 2;

const refusal = (code, detail) => Object.assign(new Error(`${code}: ${detail}`), { code });

const commandLabel = (command) => (command === 'rebuild' ? 'the rebuild form' : command);

const spell = (name) => `${OPTION_PREFIX}${name}`;

function editDistance(left, right) {
  const rows = Array.from({ length: left.length + 1 }, (_, i) => Array.from({ length: right.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const substitution = rows[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1);
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, substitution);
    }
  }
  return rows[left.length][right.length];
}

function closestOption(table, attempted) {
  const [best] = Object.keys(table)
    .map((name) => ({ name, distance: editDistance(name, attempted) }))
    .sort((a, b) => a.distance - b.distance);
  return best && best.distance <= HINT_DISTANCE ? best.name : null;
}

function unknownOption(command, table, token) {
  const attempted = token.startsWith(OPTION_PREFIX) ? token.slice(OPTION_PREFIX.length) : token;
  const [baseName] = attempted.split('=');
  const valid = Object.keys(table).map(spell).join(', ');
  const spelledWithEquals = attempted.includes('=') && Object.hasOwn(table, baseName);
  const hint = spelledWithEquals
    ? `; write ${table[baseName] === VALUE ? `${spell(baseName)} <value>` : spell(baseName)}`
    : closestOption(table, attempted) === null
      ? ''
      : `; did you mean ${spell(closestOption(table, attempted))}?`;
  return refusal(CliRefusal.UNKNOWN_OPTION, `${token} is not an option of ${commandLabel(command)}; valid: ${valid}${hint}`);
}

const isOptionToken = (token) => token.startsWith(OPTION_PREFIX);
const isDashedToken = (token) => token.startsWith('-') && token.length > 1;

function readOption(command, table, seen, token, following) {
  if (!isOptionToken(token)) {
    throw isDashedToken(token) ? unknownOption(command, table, token) : refusal(CliRefusal.UNEXPECTED_ARGUMENT, `${token} is not expected here; ${commandLabel(command)} takes options only`);
  }
  const name = token.slice(OPTION_PREFIX.length);
  if (!Object.hasOwn(table, name)) throw unknownOption(command, table, token);
  if (seen.has(name)) throw refusal(CliRefusal.DUPLICATE_OPTION, `${token} is given more than once`);
  if (table[name] === FLAG) return { name, value: null, consumed: 1 };
  if (following === undefined || isOptionToken(following)) throw refusal(CliRefusal.MISSING_VALUE, `${token} needs a value`);
  return { name, value: following, consumed: 2 };
}

function parseTokens(command, table, tokens, parsed) {
  if (tokens.length === 0) return parsed;
  const { name, value, consumed } = readOption(command, table, parsed.seen, tokens[0], tokens[1]);
  const seen = new Set([...parsed.seen, name]);
  const next = value === null ? { ...parsed, seen, flags: [...parsed.flags, name] } : { ...parsed, seen, values: { ...parsed.values, [name]: value } };
  return parseTokens(command, table, tokens.slice(consumed), next);
}

function firstInvalidDate(command, values) {
  const invalidDays = Object.entries(DATE_OPTIONS[command] ?? {})
    .filter(([name]) => Object.hasOwn(values, name))
    .flatMap(([name, daysOf]) => daysOf(values[name]).filter((day) => !isCalendarDay(day)).map((day) => ({ name, day })));
  return invalidDays[0] ?? null;
}

function refuseInvalidDate(command, values) {
  const invalid = firstInvalidDate(command, values);
  if (invalid !== null) {
    throw refusal(CliRefusal.INVALID_DATE, `${spell(invalid.name)} has "${invalid.day}", which is not a real calendar day; write YYYY-MM-DD`);
  }
}

/** `{ flags: Set, ...values }`, or a thrown Error carrying a `cli.*` code; nothing is read or written. */
export function parseCommandLine(command, argv) {
  const { flags, values } = parseTokens(command, OPTION_TABLES[command], argv, { seen: new Set(), flags: [], values: {} });
  refuseInvalidDate(command, values);
  return { ...values, flags: new Set(flags) };
}
