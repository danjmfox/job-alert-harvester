// @contract-shape:bounded-change
// `harvest uninstall` (DESIGN slice 6). Its universe is the job `local.job-alert-harvester.update` in the operator's session,
// the plist and the generated wrapper, and nothing else: logs, the cache, the ledger and the credentials are never touched.
// Order: read the job, boot it out if loaded, then delete the plist, then the wrapper. The shim notes whether the two files
// still exist at the moment of the bootout call. Subprocess layer: example-only (Mandate 11).
import { describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertStateDelta, unchanged } from '../../common/state-delta.mjs';
import {
  InstallRefusal,
  LABEL,
  NOTHING_TO_REMOVE,
  aHandMadePlist,
  aLaunchctlPrint,
  aLoadedJob,
  anInstallation,
  anInstallationThatHasBeenDone,
  controlCallsOf,
  includesLine,
  jobIsLoaded,
  lastLineOf,
  launchctlFails,
  observeMachine,
  operatorRunsUninstall,
  removeLine,
  treeChangedBy,
  useWorkspaceCleanup,
  watching,
} from './support/install-domain-types.mjs';
import { expectARefusalThatOnlyReads, expectOnlyReadsHappened } from './support/install-expectations.mjs';

useWorkspaceCleanup();

const SLOW = 30_000;
const canBeDeniedWriteAccess = process.getuid() !== 0;
const HOME_PLIST = `Library/LaunchAgents/${LABEL}.plist`;
const WRAPPER = '.cache/launchd/update.sh';
const FILES_UNIVERSE = ['home.tree', 'workspace.tree', 'osascript.calls'];
const jobOf = (site) => `gui/${site.uid}/${LABEL}`;
const printed = (site) => aLaunchctlPrint({ uid: site.uid, label: LABEL, plist: site.plist, wrapper: site.wrapper, root: site.workspace });
/** Port-exposed change of the files: exactly these entries removed from HOME and the checkout, directories not compared, nothing notified. */
const expectedRemoval = (homeEntries, checkoutEntries) => ({
  'home.tree': treeChangedBy({ removed: homeEntries }, { ignoreDirectories: true }),
  'workspace.tree': treeChangedBy({ removed: checkoutEntries }, { ignoreDirectories: true }),
  'osascript.calls': unchanged(),
});

describe('uninstall boots the job out, then removes the plist and the wrapper', () => {
  it('@driving_adapter @real-io Operator runs uninstall and the loaded daily job is gone: booted out first, with both files still there at that moment, then both files removed', async () => {
    // Given an installed job that launchd holds, with the shim noting whether the files exist at each call
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    aLoadedJob(site, printed(site));
    watching(site, [site.plist, site.wrapper]);
    const before = observeMachine(site);
    // When the operator runs uninstall
    const result = await operatorRunsUninstall(site);
    // Then it succeeds and names both removals
    expect(result.status, result.stderr).toBe(0);
    expect(includesLine(result.stdout, removeLine(site.plist))).toBe(true);
    expect(includesLine(result.stdout, removeLine(site.wrapper))).toBe(true);
    // And the job was booted out while both files still existed, and is no longer loaded
    const [bootout, ...others] = controlCallsOf(site);
    expect(bootout.argv).toEqual(['bootout', jobOf(site)]);
    expect(bootout.seen).toEqual({ [site.plist]: true, [site.wrapper]: true });
    expect(others).toEqual([]);
    expect(jobIsLoaded(site)).toBe(false);
    // And exactly the plist and the wrapper are gone
    assertStateDelta(before, observeMachine(site), { universe: FILES_UNIVERSE, expected: expectedRemoval([HOME_PLIST], [WRAPPER]) });
  }, SLOW);

  it('@error a job that is installed but not loaded is not booted out: only the two files go', async () => {
    // Given an installed job that launchd does not hold
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    const before = observeMachine(site);
    // When the operator runs uninstall
    const result = await operatorRunsUninstall(site);
    // Then it succeeds, launchctl was asked nothing but print, and the two files are gone
    expect(result.status, result.stderr).toBe(0);
    expect(controlCallsOf(site)).toEqual([]);
    assertStateDelta(before, observeMachine(site), { universe: FILES_UNIVERSE, expected: expectedRemoval([HOME_PLIST], [WRAPPER]) });
  }, SLOW);

  it('@error logs, the cache, the ledger and the credentials are never touched', async () => {
    // Given an installed job, logs it wrote, a cache, the ledger and the operator's credentials
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    mkdirSync(join(site.workspace, '.cache/messages/2026-09'), { recursive: true });
    writeFileSync(join(site.workspace, '.cache/messages/2026-09/m1.json'), '{}');
    writeFileSync(site.outLog, 'harvest update: complete, fetched 1 day(s), built the Sheet\n');
    writeFileSync(site.errLog, '');
    mkdirSync(join(site.home, '.config/job-alert-harvester'), { recursive: true });
    writeFileSync(join(site.home, '.config/job-alert-harvester/token.json'), '{"synthetic":true}');
    const before = observeMachine(site);
    // When the operator runs uninstall
    const result = await operatorRunsUninstall(site);
    // Then only the plist and the wrapper were removed: every other entry under HOME and the checkout is as it was
    expect(result.status, result.stderr).toBe(0);
    assertStateDelta(before, observeMachine(site), { universe: FILES_UNIVERSE, expected: expectedRemoval([HOME_PLIST], [WRAPPER]) });
  }, SLOW);

  it('@error a job loaded from files that are already gone is still booted out', async () => {
    // Given launchd holds the job but neither file exists
    const site = anInstallation();
    aLoadedJob(site, printed(site));
    // When the operator runs uninstall
    const result = await operatorRunsUninstall(site);
    // Then the job is booted out and the command succeeds
    expect(result.status, result.stderr).toBe(0);
    expect(controlCallsOf(site).map((call) => call.argv)).toEqual([['bootout', jobOf(site)]]);
    expect(jobIsLoaded(site)).toBe(false);
  }, SLOW);

  it('@error a plist whose wrapper is already gone is removed; so is a wrapper whose plist is already gone', async () => {
    // Given one installed job whose wrapper was deleted and another whose plist was deleted
    const noWrapper = anInstallation();
    await anInstallationThatHasBeenDone(noWrapper);
    rmSync(noWrapper.wrapper);
    const noPlist = anInstallation();
    await anInstallationThatHasBeenDone(noPlist);
    rmSync(noPlist.plist);
    // When the operator runs uninstall on each
    const first = await operatorRunsUninstall(noWrapper);
    const second = await operatorRunsUninstall(noPlist);
    // Then both succeed and nothing of the job is left in either
    expect([first.status, second.status], first.stderr + second.stderr).toEqual([0, 0]);
    expect([existsSync(noWrapper.plist), existsSync(noPlist.wrapper)]).toEqual([false, false]);
  }, SLOW);
});

describe('uninstall with nothing installed is a report, not a failure', () => {
  it('@error nothing installed: it says there is nothing to remove, exits 0, and only reads', async () => {
    // Given no plist, no wrapper and no loaded job
    const site = anInstallation();
    const before = observeMachine(site);
    // When the operator runs uninstall
    const result = await operatorRunsUninstall(site);
    // Then it says so
    expect(result.status, result.stderr).toBe(0);
    expect(includesLine(result.stdout, NOTHING_TO_REMOVE)).toBe(true);
    expectOnlyReadsHappened(before, site);
  }, SLOW);

  it('@error a second uninstall straight after a good one is the same report', async () => {
    // Given an uninstall has been done
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    expect((await operatorRunsUninstall(site)).status).toBe(0);
    const before = observeMachine(site);
    // When the operator runs it again
    const result = await operatorRunsUninstall(site);
    // Then there is nothing to remove and nothing changed
    expect(result.status, result.stderr).toBe(0);
    expect(includesLine(result.stdout, NOTHING_TO_REMOVE)).toBe(true);
    expectOnlyReadsHappened(before, site);
  }, SLOW);
});

describe('uninstall refuses what it did not generate, unless forced', () => {
  it('@error a hand-made plist is refused as install.foreign-plist, with the plist kept and no bootout', async () => {
    // Given the how-to's hand-made plist, and a job loaded from it
    const site = anInstallation();
    aHandMadePlist(site);
    aLoadedJob(site);
    // When the operator runs uninstall
    // Then it is refused, launchctl was asked nothing but print, and the plist is still there
    await expectARefusalThatOnlyReads(site, [], InstallRefusal.FOREIGN_PLIST, { command: 'uninstall' });
    expect(existsSync(site.plist)).toBe(true);
    expect(jobIsLoaded(site)).toBe(true);
  }, SLOW);

  it('@error --force removes a hand-made plist, booting the job out first', async () => {
    // Given the how-to's hand-made plist, and a job loaded from it
    const site = anInstallation();
    aHandMadePlist(site);
    aLoadedJob(site);
    watching(site, [site.plist]);
    // When the operator runs uninstall --force
    const result = await operatorRunsUninstall(site, '--force');
    // Then it succeeds, the job was booted out while the plist still existed, and the plist is gone
    expect(result.status, result.stderr).toBe(0);
    expect(controlCallsOf(site)[0].argv).toEqual(['bootout', jobOf(site)]);
    expect(controlCallsOf(site)[0].seen).toEqual({ [site.plist]: true });
    expect(existsSync(site.plist)).toBe(false);
  }, SLOW);

  it('@error uninstall --dry-run of a hand-made plist is refused as a real run would be', async () => {
    // Given the how-to's hand-made plist
    const site = anInstallation();
    aHandMadePlist(site);
    // When the operator runs uninstall --dry-run
    // Then it is refused and nothing but reads happened
    await expectARefusalThatOnlyReads(site, ['--dry-run'], InstallRefusal.FOREIGN_PLIST, { command: 'uninstall' });
  }, SLOW);
});

describe('a failure part way leaves the rest in place', () => {
  it('@error a bootout that fails is install.launchctl-failed: both files stay and the job stays loaded', async () => {
    // Given a loaded job and a launchd that refuses to boot it out
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    aLoadedJob(site, printed(site));
    launchctlFails(site, 'bootout', 3);
    // When the operator runs uninstall
    const result = await operatorRunsUninstall(site);
    // Then it is refused as a launchctl failure and nothing was removed
    expect(result.status).toBe(1);
    expect(lastLineOf(result.stderr).startsWith(`${InstallRefusal.LAUNCHCTL_FAILED}:`)).toBe(true);
    expect([existsSync(site.plist), existsSync(site.wrapper), jobIsLoaded(site)]).toEqual([true, true, true]);
  }, SLOW);

  (canBeDeniedWriteAccess ? it : it.skip)('@error the plist goes before the wrapper: when the wrapper cannot be removed, the plist is already gone, and the exit is 1', async () => {
    // Given an installed job whose wrapper's folder is read-only
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    const folder = join(site.workspace, '.cache/launchd');
    chmodSync(folder, 0o500);
    try {
      // When the operator runs uninstall
      const result = await operatorRunsUninstall(site);
      // Then it fails, and the plist, the file that launchd reads, is already removed
      expect(result.status).toBe(1);
      expect(existsSync(site.plist)).toBe(false);
      expect(existsSync(site.wrapper)).toBe(true);
    } finally {
      chmodSync(folder, 0o700);
    }
  }, SLOW);
});

describe('uninstall --dry-run says what it would remove and removes nothing', () => {
  it('@unconfirmed-behaviour @error a preview names both files and the bootout, and changes nothing', async () => {
    // Given an installed job that launchd holds
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    aLoadedJob(site, printed(site));
    const before = observeMachine(site);
    // When the operator runs uninstall --dry-run
    const result = await operatorRunsUninstall(site, '--dry-run');
    // Then it names both files as ones it would remove
    expect(result.status, result.stderr).toBe(0);
    expect(includesLine(result.stdout, removeLine(site.plist, { dryRun: true }))).toBe(true);
    expect(includesLine(result.stdout, removeLine(site.wrapper, { dryRun: true }))).toBe(true);
    // And only reads happened: the files are there and the job is still loaded
    expectOnlyReadsHappened(before, site);
    expect(jobIsLoaded(site)).toBe(true);
  }, SLOW);
});
