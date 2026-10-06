// @contract-shape:bounded-change
// `harvest install --load` (DESIGN slice 4): the one place install reaches launchd. A PATH shim records every launchctl call
// with its arguments, in order, and answers from staged state (loaded or not, a failing verb), so the order and the target of
// every call can be asserted and a failure can be provoked. The shim's `print` text is a sanitised real sample
// (support/launchctl-print-sample.mjs); scenarios that rely on what launchd does for an unloaded job or a re-bootstrap carry `@unconfirmed-behaviour`. A failure after the files were
// written leaves them in place and exits 1. Subprocess layer: example-only (Mandate 11).
import { describe, expect } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { scenario } from './support/red-gate.mjs';
import {
  InstallRefusal,
  LABEL,
  actionLine,
  aHandMadePlist,
  aLaunchctlPrint,
  aLoadedJob,
  anInstallation,
  anInstallationThatHasBeenDone,
  hasBeenInstalled,
  includesLine,
  jobIsLoaded,
  lastLineOf,
  launchctlCalls,
  launchctlFails,
  loadedLine,
  observeMachine,
  operatorRunsInstall,
  stage,
  useWorkspaceCleanup,
  watching,
} from './support/install-domain-types.mjs';
import { expectARefusalThatChangesNothing } from './support/install-expectations.mjs';

useWorkspaceCleanup();

const SLOW = 30_000;
const argvOf = (site) => launchctlCalls(site).map((call) => call.argv);
const printOf = (site) => aLaunchctlPrint({ uid: site.uid, label: LABEL, plist: site.plist, wrapper: site.wrapper, root: site.workspace });
/** launchd will print this for the job once it is loaded (what a real `print` does), without the job being loaded yet. */
const aJobThatPrintsOnceLoaded = (site) => stage(site, 'print.out', printOf(site));
const domain = (site) => `gui/${site.uid}`;
const job = (site) => `gui/${site.uid}/${LABEL}`;

describe('install --load puts the job into the operator\'s session, in a fixed order', () => {
  scenario('--load on a machine where the job is not loaded: check the session, ask about the job, bootstrap it, ask again; the job is loaded and the output says so', async () => {
    // Given a fresh installation and a launchd that will print the job once it is loaded
    const site = anInstallation();
    aJobThatPrintsOnceLoaded(site);
    // When the operator runs install --load
    const result = await operatorRunsInstall(site, '--load');
    // Then it succeeds and says the job is loaded
    expect(result.status, result.stderr).toBe(0);
    expect(includesLine(result.stdout, loadedLine(site))).toBe(true);
    // And launchctl was asked exactly: the session, the job, bootstrap, the job again
    expect(argvOf(site)).toEqual([['print', domain(site)], ['print', job(site)], ['bootstrap', domain(site), site.plist], ['print', job(site)]]);
    expect(jobIsLoaded(site)).toBe(true);
  }, SLOW);

  scenario('@unconfirmed-behaviour --load on a loaded job: it is booted out before it is bootstrapped, and ends loaded', async () => {
    // Given the job is already loaded from an earlier install
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    aLoadedJob(site, printOf(site));
    const earlier = launchctlCalls(site).length;
    // When the operator runs install --at 06:45 --load, so the loaded job is stale
    const result = await operatorRunsInstall(site, '--at', '06:45', '--load');
    // Then it succeeds, and the calls it made are: the session, the job, bootout, bootstrap, the job again
    expect(result.status, result.stderr).toBe(0);
    expect(argvOf(site).slice(earlier)).toEqual([['print', domain(site)], ['print', job(site)], ['bootout', job(site)], ['bootstrap', domain(site), site.plist], ['print', job(site)]]);
    expect(jobIsLoaded(site)).toBe(true);
  }, SLOW);

  scenario('@unconfirmed-behaviour a second install --load with nothing changed reloads the job the same way: bootout, then bootstrap, exit 0', async () => {
    // Given an install --load has been done
    const site = anInstallation();
    aJobThatPrintsOnceLoaded(site);
    const first = await operatorRunsInstall(site, '--load');
    expect(first.status, first.stderr).toBe(0);
    const earlier = launchctlCalls(site).length;
    // When the operator runs it again
    const second = await operatorRunsInstall(site, '--load');
    // Then both files are unchanged, the job was booted out before it was bootstrapped, and it is loaded
    expect(second.status, second.stderr).toBe(0);
    expect(includesLine(second.stdout, actionLine('unchanged', site.plist))).toBe(true);
    const verbs = argvOf(site).slice(earlier).map((argv) => argv[0]);
    expect(verbs.indexOf('bootout')).toBeGreaterThanOrEqual(0);
    expect(verbs.indexOf('bootout')).toBeLessThan(verbs.indexOf('bootstrap'));
    expect(jobIsLoaded(site)).toBe(true);
  }, SLOW);

  scenario('both files are written before the first launchctl call', async () => {
    // Given a fresh installation, with the shim noting whether the plist and the wrapper exist at each call
    const site = anInstallation();
    aJobThatPrintsOnceLoaded(site);
    watching(site, [site.plist, site.wrapper]);
    // When the operator runs install --load
    const result = await operatorRunsInstall(site, '--load');
    // Then at the first launchctl call both files already existed
    expect(result.status, result.stderr).toBe(0);
    expect(launchctlCalls(site)[0].seen).toEqual({ [site.plist]: true, [site.wrapper]: true });
  }, SLOW);

  scenario('install --load touches only its own job: only print, bootstrap and bootout, only this session and this label, never kickstart', async () => {
    // Given an operator whose user id is 502
    const site = anInstallation({ uid: 502 });
    aJobThatPrintsOnceLoaded(site);
    // When the operator runs install --load
    const result = await operatorRunsInstall(site, '--load');
    // Then every call is one of the three verbs, and every target is the session or this job
    expect(result.status, result.stderr).toBe(0);
    const calls = argvOf(site);
    expect(calls.every(([verb]) => ['print', 'bootstrap', 'bootout'].includes(verb))).toBe(true);
    const targets = calls.flatMap((argv) => argv.slice(1)).filter((argument) => argument.startsWith('gui/'));
    expect(targets.every((target) => target === 'gui/502' || target === `gui/502/${LABEL}`)).toBe(true);
  }, SLOW);
});

describe('a launchctl failure leaves the files written and exits 1', () => {
  scenario('@error a session that launchd does not offer (an SSH login) is install.launchctl-failed naming the domain; the files stay and nothing is bootstrapped', async () => {
    // Given launchd has no session for this user
    const site = anInstallation();
    launchctlFails(site, 'print-domain', 113);
    // When the operator runs install --load
    const result = await operatorRunsInstall(site, '--load');
    // Then it is refused as a launchctl failure that names the session
    expect(result.status).toBe(1);
    expect(lastLineOf(result.stderr).startsWith(`${InstallRefusal.LAUNCHCTL_FAILED}:`)).toBe(true);
    expect(result.stderr).toContain(domain(site));
    // And the files it wrote are still there, and the job was not bootstrapped
    expect(hasBeenInstalled(site)).toBe(true);
    expect(argvOf(site).some(([verb]) => verb === 'bootstrap')).toBe(false);
  }, SLOW);

  scenario('@error a bootstrap that fails is install.launchctl-failed; the files stay and the job is not loaded', async () => {
    // Given launchd will refuse to bootstrap
    const site = anInstallation();
    launchctlFails(site, 'bootstrap', 5);
    // When the operator runs install --load
    const result = await operatorRunsInstall(site, '--load');
    // Then it is refused as a launchctl failure, the files stay, and the job is not loaded
    expect(result.status).toBe(1);
    expect(lastLineOf(result.stderr).startsWith(`${InstallRefusal.LAUNCHCTL_FAILED}:`)).toBe(true);
    expect(hasBeenInstalled(site)).toBe(true);
    expect(jobIsLoaded(site)).toBe(false);
  }, SLOW);

  scenario('@error a bootout that fails stops the reload: no bootstrap is attempted, the files stay, the old job is still loaded', async () => {
    // Given a loaded job and a launchd that will refuse to boot it out
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    aLoadedJob(site, printOf(site));
    launchctlFails(site, 'bootout', 3);
    const earlier = launchctlCalls(site).length;
    // When the operator runs install --at 06:45 --load
    const result = await operatorRunsInstall(site, '--at', '06:45', '--load');
    // Then it is refused as a launchctl failure, with no bootstrap, and the job is still loaded
    expect(result.status).toBe(1);
    expect(lastLineOf(result.stderr).startsWith(`${InstallRefusal.LAUNCHCTL_FAILED}:`)).toBe(true);
    expect(argvOf(site).slice(earlier).some(([verb]) => verb === 'bootstrap')).toBe(false);
    expect(jobIsLoaded(site)).toBe(true);
    expect(hasBeenInstalled(site)).toBe(true);
  }, SLOW);

  scenario('@unconfirmed-behaviour @error running install --load again once launchd works finishes the job: the files are unchanged and the job loads', async () => {
    // Given an install --load that failed at bootstrap after writing the files
    const site = anInstallation();
    aJobThatPrintsOnceLoaded(site);
    launchctlFails(site, 'bootstrap', 5);
    const failed = await operatorRunsInstall(site, '--load');
    expect(failed.status).toBe(1);
    rmSync(join(site.state, 'exit.bootstrap'));
    // When the operator runs the same command again
    const result = await operatorRunsInstall(site, '--load');
    // Then it succeeds, reports both files unchanged, and the job is loaded
    expect(result.status, result.stderr).toBe(0);
    expect(includesLine(result.stdout, actionLine('unchanged', site.plist))).toBe(true);
    expect(includesLine(result.stdout, actionLine('unchanged', site.wrapper))).toBe(true);
    expect(jobIsLoaded(site)).toBe(true);
  }, SLOW);

  scenario('@error a hand-made plist with --load is refused before any launchctl call, and the loaded job is left as it was', async () => {
    // Given a hand-made plist and a job loaded from it
    const site = anInstallation();
    aHandMadePlist(site);
    aLoadedJob(site);
    const before = observeMachine(site);
    // When the operator runs install --load
    // Then it is refused as a foreign plist, launchctl is not called, and the job is still loaded
    await expectARefusalThatChangesNothing(site, ['--load'], InstallRefusal.FOREIGN_PLIST);
    expect(jobIsLoaded(site)).toBe(true);
    expect(observeMachine(site)).toEqual(before);
  }, SLOW);
});
