// @contract-shape:unbounded-preservation
// The command lines of install, uninstall and status as the option tables (DESIGN, "Proposed option table entries") refuse
// them: `cli.unknown-option`, `cli.duplicate-option`, `cli.missing-value`, `cli.unexpected-argument`, each naming the
// subcommand's own table. Every refusal reaches no launchctl and changes nothing. Also the conventions the three commands share:
// warnings on stderr and never on stdout, exit 0 for a report and 1 for a refusal and never 2, the usage line naming the new
// subcommands, and `update` and the rebuild form behaving as they did. Subprocess layer: example-only (Mandate 11).
import { describe, expect, it } from 'vitest';
import {
  CliRefusal,
  InstallRefusal,
  anInstallation,
  includesLine,
  lastLineOf,
  operatorRuns,
  useWorkspaceCleanup,
  warningsIn,
} from './support/install-domain-types.mjs';
import { expectARefusalThatChangesNothing } from './support/install-expectations.mjs';

useWorkspaceCleanup();

const SLOW = 30_000;

/** [command, arguments, the refusal code, a phrase the refusal line carries]. */
const REFUSED_COMMAND_LINES = [
  ['install', ['--wat'], CliRefusal.UNKNOWN_OPTION, 'is not an option of install'],
  ['install', ['--help'], CliRefusal.UNKNOWN_OPTION, 'is not an option of install'],
  ['install', ['--dry-run', '--lode'], CliRefusal.UNKNOWN_OPTION, 'did you mean --load'],
  ['install', ['--at=06:00'], CliRefusal.UNKNOWN_OPTION, 'write --at <value>'],
  ['install', ['--at'], CliRefusal.MISSING_VALUE, '--at needs a value'],
  ['install', ['--at', '--dry-run'], CliRefusal.MISSING_VALUE, '--at needs a value'],
  ['install', ['--at', '06:00', '--at', '07:00'], CliRefusal.DUPLICATE_OPTION, '--at is given more than once'],
  ['install', ['--dry-run', '--dry-run'], CliRefusal.DUPLICATE_OPTION, '--dry-run is given more than once'],
  ['install', ['--load', '--load'], CliRefusal.DUPLICATE_OPTION, '--load is given more than once'],
  ['install', ['--force', '--force'], CliRefusal.DUPLICATE_OPTION, '--force is given more than once'],
  ['install', ['--allow-any-branch', '--allow-any-branch'], CliRefusal.DUPLICATE_OPTION, '--allow-any-branch is given more than once'],
  ['install', ['now'], CliRefusal.UNEXPECTED_ARGUMENT, 'install takes options only'],
  ['uninstall', ['--at', '06:00'], CliRefusal.UNKNOWN_OPTION, 'is not an option of uninstall'],
  ['uninstall', ['--load'], CliRefusal.UNKNOWN_OPTION, 'is not an option of uninstall'],
  ['uninstall', ['--allow-any-branch'], CliRefusal.UNKNOWN_OPTION, 'is not an option of uninstall'],
  ['uninstall', ['--dry-run', '--dry-run'], CliRefusal.DUPLICATE_OPTION, '--dry-run is given more than once'],
  ['uninstall', ['--force', '--force'], CliRefusal.DUPLICATE_OPTION, '--force is given more than once'],
  ['uninstall', ['now'], CliRefusal.UNEXPECTED_ARGUMENT, 'uninstall takes options only'],
  ['status', ['--dry-run'], CliRefusal.UNKNOWN_OPTION, 'is not an option of status'],
  ['status', ['--force'], CliRefusal.UNKNOWN_OPTION, 'is not an option of status'],
  ['status', ['--at', '05:30'], CliRefusal.UNKNOWN_OPTION, 'is not an option of status'],
  ['status', ['--wat'], CliRefusal.UNKNOWN_OPTION, 'is not an option of status'],
  ['status', ['now'], CliRefusal.UNEXPECTED_ARGUMENT, 'status takes options only'],
];

describe('the option tables of install, uninstall and status refuse what they do not list', () => {
  for (const [command, args, code, phrase] of REFUSED_COMMAND_LINES) {
    it(`@error ${command} ${args.join(' ')} is refused as ${code}, naming "${phrase}", and nothing is read, written or called`, async () => {
      // Given a fresh installation
      const site = anInstallation();
      // When the operator runs the command line
      // Then it is refused by the command's own table and the machine is as it was
      const result = await expectARefusalThatChangesNothing(site, args, code, { command });
      expect(lastLineOf(result.stderr)).toContain(phrase);
    }, SLOW);
  }

  it('@error the option table is read before the platform: off macOS an unknown option is still cli.unknown-option', async () => {
    // Given a machine that is not macOS
    const site = anInstallation({ platform: 'linux' });
    // When the operator runs install --wat
    // Then the option is what is refused
    const result = await expectARefusalThatChangesNothing(site, ['--wat'], CliRefusal.UNKNOWN_OPTION);
    expect(lastLineOf(result.stderr)).toContain('is not an option of install');
  }, SLOW);
});

describe('exit codes and streams', () => {
  const SWEEP = [
    [['install', '--dry-run'], 0],
    [['uninstall'], 0],
    [['uninstall', '--dry-run'], 0],
    [['status'], 0],
    [['install', '--at', '99:99'], 1],
    [['install', '--dry-run', '--dry-run'], 1],
    [['uninstall', '--wat'], 1],
    [['status', '--wat'], 1],
  ];
  it('every command line ends with exit 0 when it produced a plan or report and exit 1 when it was refused: never 2, never anything else', async () => {
    // Given eight command lines, four that succeed and four that are refused
    const statuses = [];
    // When the operator runs each, on its own fresh installation
    for (const [args] of SWEEP) statuses.push((await operatorRuns(anInstallation(), args)).status);
    // Then each ended as expected
    expect(statuses).toEqual(SWEEP.map(([, status]) => status));
  }, 4 * SLOW);

  it('@error warnings go to stderr and never to stdout', async () => {
    // Given a ledger with no interval, which install warns about
    const site = anInstallation({ ledger: 'empty' });
    // When the operator runs install
    const result = await operatorRuns(site, ['install']);
    // Then the warning is on stderr and none is on stdout
    expect(result.status, result.stderr).toBe(0);
    expect(warningsIn(result.stderr).length).toBeGreaterThan(0);
    expect(warningsIn(result.stdout)).toEqual([]);
  }, SLOW);

  it('@error a refusal never leaves anything on stdout, and its code leads the last stderr line', async () => {
    // Given a checkout off main
    const site = anInstallation({ branch: 'feature/x' });
    // When the operator runs install
    const result = await operatorRuns(site, ['install']);
    // Then stdout is empty and the last stderr line leads with the code
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(lastLineOf(result.stderr).startsWith(`${InstallRefusal.NOT_ON_MAIN}:`)).toBe(true);
  }, SLOW);
});

describe('the rest of the command line is as it was', () => {
  it('the usage line names install, uninstall and status beside the other subcommands', async () => {
    // Given any installation
    const site = anInstallation();
    // When the operator runs harvest with nothing after it
    const result = await operatorRuns(site, []);
    // Then it prints the usage on stderr and exits 2, as it always has, and the line lists the three new subcommands
    expect(result.status).toBe(2);
    for (const name of ['install', 'uninstall', 'status', 'update', 'fetch', 'build']) expect(result.stderr, name).toMatch(new RegExp(`\\b${name}\\b`));
  }, SLOW);

  it('@error update still refuses an option it does not list, by its own table', async () => {
    // Given any installation
    const site = anInstallation();
    // When the operator runs update --wat
    const result = await operatorRuns(site, ['update', '--wat']);
    // Then it is refused as an unknown option of update, as before
    expect(result.status).toBe(1);
    expect(lastLineOf(result.stderr).startsWith(`${CliRefusal.UNKNOWN_OPTION}:`)).toBe(true);
    expect(lastLineOf(result.stderr)).toContain('is not an option of update');
  }, SLOW);

  it('@error a first word that merely starts like a subcommand is still the rebuild form, refused as an unexpected argument', async () => {
    // Given any installation
    const site = anInstallation();
    // When the operator runs harvest installx
    const result = await operatorRuns(site, ['installx']);
    // Then the rebuild form refuses it, as it refuses any bare word
    expect(result.status).toBe(1);
    expect(lastLineOf(result.stderr).startsWith(`${CliRefusal.UNEXPECTED_ARGUMENT}:`)).toBe(true);
    expect(includesLine(result.stderr, /the rebuild form/)).toBe(true);
  }, SLOW);
});
