// @contract-shape:bounded-change
// `harvest install` as an operator runs it: a spawned subprocess through the production composition root, in a temp checkout that
// is a real `git init` on main, an empty temp HOME, a PATH whose first entry is the shim directory, the clock and the platform
// fixed by `node --import` preloads. Covers DESIGN slices 1 and 2: the walking skeleton (two files written, the exact next
// command printed, no launchctl call), what the files contain, `--dry-run` as a zero change, idempotence, replacing the
// job's own files atomically, and refusing a hand-made plist or another checkout's job unless `--force`. Subprocess layer:
// example-only (Mandate 11). The refusals of the command line, the platform, the directory and the paths are in
// install-refusals.test.mjs; the branch guard in install-branch-guard.test.mjs.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, linkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertStateDelta } from '../../common/state-delta.mjs';
import {
  FRESH_CHECKOUT_ENTRIES,
  FRESH_HOME_ENTRIES,
  InstallRefusal,
  LABEL,
  MACHINE_UNIVERSE,
  actionLine,
  agedLongAgo,
  aHandMadePlist,
  anInstallation,
  anInstallationThatHasBeenDone,
  bootoutCommand,
  bootstrapCommand,
  includesLine,
  linesOf,
  modeOf,
  modifiedTimesOf,
  namesTheCommand,
  nextLine,
  observeMachine,
  operatorRunsInstall,
  readPlistText,
  readWrapperText,
  refusesWith,
  thePlist,
  treeChangedBy,
  useWorkspaceCleanup,
  withNodeAt,
} from './support/install-domain-types.mjs';
import { allUnchanged } from './support/install-expectations.mjs';
import { parsePlist } from './support/plist-oracle.mjs';

useWorkspaceCleanup();

const SLOW = 30_000;
const PLIST_KEYS = ['Label', 'ProgramArguments', 'WorkingDirectory', 'StartCalendarInterval', 'StandardOutPath', 'StandardErrorPath'];
const HOME_PLIST = `Library/LaunchAgents/${LABEL}.plist`;
const plutilAvailable = process.platform === 'darwin' && existsSync('/usr/bin/plutil');

describe('@driving_adapter harvest install writes the daily update job for this checkout', () => {
  it('@walking_skeleton @driving_adapter @real-io Operator runs install and gets the daily update job written for this checkout, with the exact command that loads it, and no launchctl call made', async () => {
    // Given a macOS operator on a checkout on main whose ledger covers three days, with an empty HOME and nothing scheduled
    const site = anInstallation();
    const before = observeMachine(site);
    // When the operator runs install
    const result = await operatorRunsInstall(site);
    // Then it succeeds, says both files were created, and prints the one command that loads the job
    expect(result.status, result.stderr).toBe(0);
    expect(includesLine(result.stdout, actionLine('create', site.wrapper))).toBe(true);
    expect(includesLine(result.stdout, actionLine('create', site.plist))).toBe(true);
    expect(includesLine(result.stdout, nextLine(bootstrapCommand(site)))).toBe(true);
    // And the plist sits in the LaunchAgents folder, the wrapper and the log folder under the checkout, and nothing else on the machine moved, launchctl included
    assertStateDelta(before, observeMachine(site), {
      universe: MACHINE_UNIVERSE,
      expected: {
        ...allUnchanged(),
        'home.tree': treeChangedBy({ created: FRESH_HOME_ENTRIES }),
        'workspace.tree': treeChangedBy({ created: FRESH_CHECKOUT_ENTRIES }),
      },
    });
  }, SLOW);

  it('the load command names the operator\'s own user id, not a fixed one', async () => {
    // Given an operator whose user id is 502
    const site = anInstallation({ uid: 502 });
    // When the operator runs install
    const result = await operatorRunsInstall(site);
    // Then the printed command boots the job into that user's session
    expect(result.status, result.stderr).toBe(0);
    expect(includesLine(result.stdout, nextLine(`launchctl bootstrap gui/502 ${site.plist}`))).toBe(true);
  }, SLOW);

  it('a clean install says nothing on stderr and prints nothing that is a refusal', async () => {
    // Given a checkout on main with a covered ledger, a node path with no version in it, and a folder that macOS does not protect
    const site = anInstallation();
    // When the operator runs install
    const result = await operatorRunsInstall(site);
    // Then stdout holds the plan and stderr is empty
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(linesOf(result.stdout).length).toBeGreaterThan(0);
  }, SLOW);

  it('the plist carries the label, the shell and wrapper, the checkout as working directory, 05:30 and both log files, in the how-to\'s order', async () => {
    // Given a fresh installation
    const site = anInstallation();
    // When the operator runs install without --at
    await anInstallationThatHasBeenDone(site);
    // Then the plist holds the six keys of the how-to in its order, with those values
    const plist = thePlist(site);
    expect(Object.keys(plist).filter((key) => PLIST_KEYS.includes(key))).toEqual(PLIST_KEYS);
    expect(plist).toMatchObject({
      Label: LABEL,
      ProgramArguments: ['/bin/sh', site.wrapper],
      WorkingDirectory: site.workspace,
      StartCalendarInterval: { Hour: 5, Minute: 30 },
      StandardOutPath: site.outLog,
      StandardErrorPath: site.errLog,
    });
    expect(site.outLog).toBe(join(site.workspace, '.cache/logs/update.out.log'));
    expect(site.errLog).toBe(join(site.workspace, '.cache/logs/update.err.log'));
  }, SLOW);

  it('the plist carries one constant generated marker as an XML comment, and a hand-made plist has none', async () => {
    // Given two checkouts of different operators installing at different times
    const first = anInstallation();
    const second = anInstallation();
    // When each runs install, one at the default hour and one at 07:15
    await anInstallationThatHasBeenDone(first);
    await anInstallationThatHasBeenDone(second, '--at', '07:15');
    // Then each plist has exactly one comment and the two comments are the same text
    const markerOf = (site) => parsePlist(readPlistText(site)).comments;
    expect(markerOf(first)).toHaveLength(1);
    expect(markerOf(second)).toEqual(markerOf(first));
    // And the plist the how-to has the operator write by hand carries no comment at all
    const handMade = anInstallation();
    aHandMadePlist(handMade);
    expect(parsePlist(readPlistText(handMade)).comments).toEqual([]);
  }, SLOW);

  (plutilAvailable ? it : it.skip)('@real-io the plist passes plutil -lint', async () => {
    // Given an install has written the plist
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    // When plutil checks it
    const lint = spawnSync('/usr/bin/plutil', ['-lint', site.plist], { encoding: 'utf8' });
    // Then the plist is well formed
    expect(lint.status, lint.stdout + lint.stderr).toBe(0);
  }, SLOW);

  it('the wrapper is executable, the plist is not, and the wrapper is valid shell', async () => {
    // Given an install has written both files
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    // When the modes are read and the wrapper is parsed by sh without running
    const syntax = spawnSync('/bin/sh', ['-n', site.wrapper], { encoding: 'utf8' });
    // Then the wrapper is 0755, the plist 0644, and sh finds no syntax error
    expect(modeOf(site.wrapper)).toBe(0o755);
    expect(modeOf(site.plist)).toBe(0o644);
    expect(syntax.status, syntax.stderr).toBe(0);
  }, SLOW);

  it('the wrapper pins the node path and the checkout, single-quoted, and sets no PATH of its own', async () => {
    // Given an install on a machine whose node binary is at a plain path
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    // When the wrapper text is read
    const text = readWrapperText(site);
    // Then both absolute paths appear single-quoted, and no PATH is assigned (so a test can put a fake osascript first)
    expect(text).toContain(`'${site.execPath}'`);
    expect(text).toContain(`'${site.workspace}'`);
    expect(text).not.toMatch(/\bPATH=/);
  }, SLOW);

  it('@error --dry-run writes nothing and calls nothing: the machine is exactly as it was, and each file is named as one that would be created', async () => {
    // Given a fresh installation
    const site = anInstallation();
    const before = observeMachine(site);
    // When the operator runs install --dry-run
    const result = await operatorRunsInstall(site, '--dry-run');
    // Then it succeeds and names both files as created under the preview heading
    expect(result.status, result.stderr).toBe(0);
    expect(includesLine(result.stdout, actionLine('create', site.wrapper, { dryRun: true }))).toBe(true);
    expect(includesLine(result.stdout, actionLine('create', site.plist, { dryRun: true }))).toBe(true);
    // And not a file, folder, launchctl call or notification changed
    assertStateDelta(before, observeMachine(site), { universe: MACHINE_UNIVERSE, expected: allUnchanged() });
  }, SLOW);

  it('@error --dry-run prints the full text of both files, and it is the text a real install then writes', async () => {
    // Given a fresh installation previewed once
    const site = anInstallation();
    const preview = await operatorRunsInstall(site, '--dry-run');
    expect(preview.status, preview.stderr).toBe(0);
    // When the operator then runs install for real
    await anInstallationThatHasBeenDone(site);
    // Then the preview held both files' text, verbatim
    expect(preview.stdout).toContain(readPlistText(site));
    expect(preview.stdout).toContain(readWrapperText(site));
  }, SLOW);

  it('@error --dry-run with --load prints the load command and runs no launchctl', async () => {
    // Given a fresh installation
    const site = anInstallation();
    const before = observeMachine(site);
    // When the operator previews install with --load
    const result = await operatorRunsInstall(site, '--dry-run', '--load');
    // Then the command it would run is named, and the machine and launchctl are untouched
    expect(result.status, result.stderr).toBe(0);
    expect(namesTheCommand(result.stdout, bootstrapCommand(site))).toBe(true);
    assertStateDelta(before, observeMachine(site), { universe: MACHINE_UNIVERSE, expected: allUnchanged() });
  }, SLOW);

  it('@error --dry-run refuses a hand-made plist as a real run would, and changes nothing', async () => {
    // Given the operator wrote the plist by hand following the how-to
    const site = anInstallation();
    aHandMadePlist(site);
    const before = observeMachine(site);
    // When the operator previews install
    const result = await operatorRunsInstall(site, '--dry-run');
    // Then it is refused as a foreign plist
    expect(refusesWith(result, InstallRefusal.FOREIGN_PLIST), result.stderr).toBe(true);
    assertStateDelta(before, observeMachine(site), { universe: MACHINE_UNIVERSE, expected: allUnchanged() });
  }, SLOW);

  it('@error a second install straight after a good one changes nothing: both files unchanged, not rewritten, no launchctl', async () => {
    // Given an install has been done and its files dated long ago
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    const dates = agedLongAgo(site);
    const before = observeMachine(site);
    // When the operator runs install again
    const result = await operatorRunsInstall(site);
    // Then both files are reported unchanged
    expect(result.status, result.stderr).toBe(0);
    expect(includesLine(result.stdout, actionLine('unchanged', site.wrapper))).toBe(true);
    expect(includesLine(result.stdout, actionLine('unchanged', site.plist))).toBe(true);
    // And nothing on the machine changed, and neither file was touched (its modification time is the old one)
    assertStateDelta(before, observeMachine(site), { universe: MACHINE_UNIVERSE, expected: allUnchanged() });
    expect(modifiedTimesOf([site.plist, site.wrapper])).toEqual(dates);
  }, SLOW);

  it('@error a changed --at replaces the job\'s own plist and leaves the wrapper alone; the reload commands are printed, bootout first', async () => {
    // Given an install at the default hour
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    const [, wrapperDate] = agedLongAgo(site);
    const before = observeMachine(site);
    // When the operator runs install --at 06:45
    const result = await operatorRunsInstall(site, '--at', '06:45');
    // Then the plist is replaced, the wrapper unchanged
    expect(result.status, result.stderr).toBe(0);
    expect(includesLine(result.stdout, actionLine('replace', site.plist))).toBe(true);
    expect(includesLine(result.stdout, actionLine('unchanged', site.wrapper))).toBe(true);
    expect(modifiedTimesOf([site.wrapper])).toEqual([wrapperDate]);
    // And the new hour is in the plist, the old job is told to stop before the new one starts, and launchctl was not called
    expect(thePlist(site).StartCalendarInterval).toEqual({ Hour: 6, Minute: 45 });
    const bootout = linesOf(result.stdout).findIndex((line) => line.endsWith(bootoutCommand(site)));
    const bootstrap = linesOf(result.stdout).findIndex((line) => line.endsWith(bootstrapCommand(site)));
    expect(bootout).toBeGreaterThanOrEqual(0);
    expect(bootout).toBeLessThan(bootstrap);
    assertStateDelta(before, observeMachine(site), { universe: MACHINE_UNIVERSE, expected: { ...allUnchanged(), 'home.tree': treeChangedBy({ replaced: [HOME_PLIST] }) } });
  }, SLOW);

  it('@error the plist is replaced atomically: a second name for the old file still holds the old text, and no temporary file is left', async () => {
    // Given an install, with a second name linked to the plist's file
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    const oldText = readPlistText(site);
    const secondName = join(site.sandbox.root, 'second-name-for-the-old-plist');
    linkSync(site.plist, secondName);
    // When the operator runs install --at 06:45
    const result = await operatorRunsInstall(site, '--at', '06:45');
    // Then the plist has new text, the old file was not written into, and the LaunchAgents folder holds the plist alone
    expect(result.status, result.stderr).toBe(0);
    expect(readPlistText(site)).not.toBe(oldText);
    expect(readFileSync(secondName, 'utf8')).toBe(oldText);
    expect(Object.keys(observeMachine(site)['home.tree']).filter((path) => path.startsWith('Library/LaunchAgents/'))).toEqual([`Library/LaunchAgents/${LABEL}.plist`]);
  }, SLOW);

  it('@error a node binary that moved replaces the wrapper and leaves the plist alone', async () => {
    // Given an install, and then the operator upgraded node so the running binary is elsewhere
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    const upgraded = withNodeAt(site, join(site.sandbox.nodes, 'opt', 'node-next', 'bin', 'node'));
    const before = observeMachine(site);
    // When the operator runs install again
    const result = await operatorRunsInstall(upgraded);
    // Then the wrapper is replaced and names the new node, and the plist is unchanged
    expect(result.status, result.stderr).toBe(0);
    expect(includesLine(result.stdout, actionLine('replace', site.wrapper))).toBe(true);
    expect(includesLine(result.stdout, actionLine('unchanged', site.plist))).toBe(true);
    expect(readWrapperText(site)).toContain(`'${upgraded.execPath}'`);
    assertStateDelta(before, observeMachine(site), { universe: MACHINE_UNIVERSE, expected: { ...allUnchanged(), 'workspace.tree': treeChangedBy({ replaced: ['.cache/launchd/update.sh'] }) } });
  }, SLOW);

  it('@error a hand-made plist is refused without --force: exit 1, install.foreign-plist, stdout empty, the plist byte for byte as it was, and no wrapper written', async () => {
    // Given the operator wrote the plist by hand following the how-to
    const site = anInstallation();
    const handMade = aHandMadePlist(site);
    const before = observeMachine(site);
    // When the operator runs install
    const result = await operatorRunsInstall(site);
    // Then it is refused as a foreign plist and nothing was written
    expect(refusesWith(result, InstallRefusal.FOREIGN_PLIST), result.stderr).toBe(true);
    expect(readPlistText(site)).toBe(handMade);
    assertStateDelta(before, observeMachine(site), { universe: MACHINE_UNIVERSE, expected: allUnchanged() });
  }, SLOW);

  it('@error --force replaces a hand-made plist with the generated one and writes the wrapper', async () => {
    // Given the operator wrote the plist by hand
    const site = anInstallation();
    aHandMadePlist(site);
    const before = observeMachine(site);
    // When the operator runs install --force
    const result = await operatorRunsInstall(site, '--force');
    // Then it succeeds, the plist is the generated one (marked, 05:30) and the wrapper exists
    expect(result.status, result.stderr).toBe(0);
    expect(includesLine(result.stdout, actionLine('replace', site.plist))).toBe(true);
    expect(parsePlist(readPlistText(site)).comments).toHaveLength(1);
    expect(thePlist(site).StartCalendarInterval).toEqual({ Hour: 5, Minute: 30 });
    assertStateDelta(before, observeMachine(site), {
      universe: MACHINE_UNIVERSE,
      expected: { ...allUnchanged(), 'home.tree': treeChangedBy({ replaced: [HOME_PLIST] }), 'workspace.tree': treeChangedBy({ created: FRESH_CHECKOUT_ENTRIES }) },
    });
  }, SLOW);

  it('@error a job installed from another checkout is refused as install.other-checkout, and left running that checkout\'s update', async () => {
    // Given an install from one checkout, and a second checkout on the same machine
    const first = anInstallation();
    await anInstallationThatHasBeenDone(first);
    const installedText = readPlistText(first);
    const second = anInstallation({ sandbox: first.sandbox, checkoutName: 'second-checkout' });
    const before = observeMachine(second);
    // When the operator runs install from the second checkout
    const result = await operatorRunsInstall(second);
    // Then it is refused, the plist is as it was, and the second checkout holds no wrapper
    expect(refusesWith(result, InstallRefusal.OTHER_CHECKOUT), result.stderr).toBe(true);
    expect(readPlistText(first)).toBe(installedText);
    assertStateDelta(before, observeMachine(second), { universe: MACHINE_UNIVERSE, expected: allUnchanged() });
  }, SLOW);

  it('@error --force moves the job to the second checkout: the plist now works in that directory and its wrapper exists', async () => {
    // Given an install from one checkout, and a second checkout on the same machine
    const first = anInstallation();
    await anInstallationThatHasBeenDone(first);
    const second = anInstallation({ sandbox: first.sandbox, checkoutName: 'second-checkout' });
    // When the operator runs install --force from the second checkout
    const result = await operatorRunsInstall(second, '--force');
    // Then the plist names the second checkout and its wrapper, and the wrapper is written there
    expect(result.status, result.stderr).toBe(0);
    expect(thePlist(second)).toMatchObject({ WorkingDirectory: second.workspace, ProgramArguments: ['/bin/sh', second.wrapper] });
    expect(existsSync(second.wrapper)).toBe(true);
  }, SLOW);

  it('@error an existing LaunchAgents folder is used as it is: only the plist is added to HOME', async () => {
    // Given a HOME that already has an empty Library/LaunchAgents folder
    const site = anInstallation({ launchAgents: 'exists' });
    const before = observeMachine(site);
    // When the operator runs install
    const result = await operatorRunsInstall(site);
    // Then exactly one file is added under HOME
    expect(result.status, result.stderr).toBe(0);
    assertStateDelta(before, observeMachine(site), { universe: MACHINE_UNIVERSE, expected: { ...allUnchanged(), 'home.tree': treeChangedBy({ created: [HOME_PLIST] }), 'workspace.tree': treeChangedBy({ created: FRESH_CHECKOUT_ENTRIES }) } });
  }, SLOW);
});
