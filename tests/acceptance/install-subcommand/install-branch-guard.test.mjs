// @contract-shape:unbounded-preservation
// The branch guard of `harvest install` (DESIGN, Q-branch): the job runs whatever the checkout holds when it fires, so install
// refuses a checkout that is not on `main`, including a detached HEAD, a directory that is not a git checkout and a machine
// where git cannot be asked, unless `--allow-any-branch`. The real adapter runs against a real `git init` in a temp checkout.
// The printed text says what the job will run and never claims a commit pin (DESIGN, Contradictions 2). uninstall and status do
// not apply the guard. Subprocess layer: example-only (Mandate 11). Covers DESIGN slice 2's branch guard.
import { describe, expect, it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scenario } from './support/red-gate.mjs';
import {
  InstallRefusal,
  NOTHING_TO_REMOVE,
  RUNS_WHATEVER,
  aHandMadePlist,
  anInstallation,
  git,
  hasBeenInstalled,
  includesLine,
  linesOf,
  observeMachine,
  operatorRuns,
  operatorRunsInstall,
  operatorRunsStatus,
  operatorRunsUninstall,
  useWorkspaceCleanup,
} from './support/install-domain-types.mjs';
import { expectARefusalThatChangesNothing, expectOnlyReadsHappened } from './support/install-expectations.mjs';

useWorkspaceCleanup();

const SLOW = 30_000;
const shortCommitOf = (site) => git(site.workspace, 'rev-parse', 'HEAD').slice(0, 7);

describe('install refuses a checkout that is not on main', () => {
  it('@error a feature branch is refused as install.not-on-main, naming the branch, and nothing is written', async () => {
    // Given a checkout on feature/x
    const site = anInstallation({ branch: 'feature/x' });
    // When the operator runs install
    // Then it is refused, the refusal names the branch, and the machine is as it was
    const result = await expectARefusalThatChangesNothing(site, [], InstallRefusal.NOT_ON_MAIN);
    expect(result.stderr).toContain('feature/x');
  }, SLOW);

  for (const branch of ['master', 'develop', 'main2', 'mainline', 'feature/main']) {
    it(`@error a branch named ${branch} is not main: install refuses it as install.not-on-main`, async () => {
      // Given a checkout on a branch named ${branch}
      const site = anInstallation({ branch });
      // When the operator runs install
      // Then it is refused and the machine is as it was
      await expectARefusalThatChangesNothing(site, [], InstallRefusal.NOT_ON_MAIN);
    }, SLOW);
  }

  it('@error a detached HEAD is refused as install.not-on-main, saying the checkout is detached', async () => {
    // Given a checkout whose HEAD is detached at the main commit
    const site = anInstallation({ branch: 'detached' });
    // When the operator runs install
    // Then it is refused as not on main, and the refusal says detached
    const result = await expectARefusalThatChangesNothing(site, [], InstallRefusal.NOT_ON_MAIN);
    expect(result.stderr.toLowerCase()).toContain('detached');
  }, SLOW);

  it('@error a directory that is not a git checkout is refused as install.not-on-main, saying so', async () => {
    // Given a checkout directory with no git history at all
    const site = anInstallation({ branch: null });
    // When the operator runs install
    // Then it is refused as not on main, and the refusal says it is not a git checkout
    const result = await expectARefusalThatChangesNothing(site, [], InstallRefusal.NOT_ON_MAIN);
    expect(result.stderr.toLowerCase()).toContain('not a git checkout');
  }, SLOW);

  it('@error a machine where git cannot be run is treated as "cannot confirm main", never as main: install.not-on-main', async () => {
    // Given a checkout on main but a PATH with no git on it
    const site = anInstallation();
    // When the operator runs install
    // Then it is refused, because main cannot be confirmed
    await expectARefusalThatChangesNothing(site, [], InstallRefusal.NOT_ON_MAIN, { gitOnPath: false });
  }, SLOW);

  it('@error the guard comes before the plan: off main with a hand-made plist is install.not-on-main, not install.foreign-plist', async () => {
    // Given a checkout off main and a hand-made plist
    const site = anInstallation({ branch: 'feature/x' });
    aHandMadePlist(site);
    // When the operator runs install
    // Then the branch is what is refused
    await expectARefusalThatChangesNothing(site, [], InstallRefusal.NOT_ON_MAIN);
  }, SLOW);

  it('@error a preview off main is refused as a real run would be', async () => {
    // Given a checkout on feature/x
    const site = anInstallation({ branch: 'feature/x' });
    // When the operator runs install --dry-run
    // Then it is refused as not on main
    await expectARefusalThatChangesNothing(site, ['--dry-run'], InstallRefusal.NOT_ON_MAIN);
  }, SLOW);

  it('@error --load off main is refused before any launchctl call', async () => {
    // Given a checkout on feature/x
    const site = anInstallation({ branch: 'feature/x' });
    // When the operator runs install --load
    // Then it is refused as not on main and launchctl was never called
    await expectARefusalThatChangesNothing(site, ['--load'], InstallRefusal.NOT_ON_MAIN);
  }, SLOW);
});

describe('--allow-any-branch lets the operator schedule a checkout off main', () => {
  it('@error --allow-any-branch on a feature branch installs, and the output names that branch', async () => {
    // Given a checkout on feature/x
    const site = anInstallation({ branch: 'feature/x' });
    // When the operator runs install --allow-any-branch
    const result = await operatorRunsInstall(site, '--allow-any-branch');
    // Then it succeeds, both files are written, and the branch is named on stdout
    expect(result.status, result.stderr).toBe(0);
    expect(hasBeenInstalled(site)).toBe(true);
    expect(linesOf(result.stdout).some((line) => line.includes('feature/x'))).toBe(true);
  }, SLOW);

  it('@error --allow-any-branch on a detached HEAD installs, and the output names the commit', async () => {
    // Given a checkout with a detached HEAD
    const site = anInstallation({ branch: 'detached' });
    // When the operator runs install --allow-any-branch
    const result = await operatorRunsInstall(site, '--allow-any-branch');
    // Then it succeeds and names the commit the checkout is at
    expect(result.status, result.stderr).toBe(0);
    expect(hasBeenInstalled(site)).toBe(true);
    expect(result.stdout).toContain(shortCommitOf(site));
  }, SLOW);

  it('@error --allow-any-branch on a directory that is not a git checkout installs', async () => {
    // Given a checkout directory with no git history
    const site = anInstallation({ branch: null });
    // When the operator runs install --allow-any-branch
    const result = await operatorRunsInstall(site, '--allow-any-branch');
    // Then it succeeds and both files are written
    expect(result.status, result.stderr).toBe(0);
    expect(hasBeenInstalled(site)).toBe(true);
  }, SLOW);

  it('@error --allow-any-branch where git cannot be run installs', async () => {
    // Given a checkout on main and a PATH with no git on it
    const site = anInstallation();
    // When the operator runs install --allow-any-branch
    const result = await operatorRuns(site, ['install', '--allow-any-branch'], { gitOnPath: false });
    // Then it succeeds and both files are written
    expect(result.status, result.stderr).toBe(0);
    expect(hasBeenInstalled(site)).toBe(true);
  }, SLOW);
});

describe('what install says about the checkout it schedules', () => {
  it('install names the checkout, its short commit and its branch, and says the job runs whatever the checkout holds', async () => {
    // Given a checkout on main at a known commit
    const site = anInstallation();
    // When the operator runs install
    const result = await operatorRunsInstall(site);
    // Then one line names the checkout directory, the branch and the short commit
    expect(result.status, result.stderr).toBe(0);
    const line = linesOf(result.stdout).find((candidate) => candidate.includes(site.workspace) && candidate.includes('main'));
    expect(line, result.stdout).toBeDefined();
    expect(line).toContain(shortCommitOf(site));
    // And another line says the job runs whatever the checkout holds
    expect(includesLine(result.stdout, new RegExp(RUNS_WHATEVER))).toBe(true);
  }, SLOW);

  it('install never says the job is pinned to a commit, in stdout or stderr', async () => {
    // Given a checkout on main
    const site = anInstallation();
    // When the operator runs install
    const result = await operatorRunsInstall(site);
    // Then neither stream claims a pin
    expect(result.status, result.stderr).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`.toLowerCase()).not.toMatch(/\bpinn?(ed|ing)?\b/);
  }, SLOW);

  it('@error uncommitted edits do not stop install: the job runs them too, and the guard does not look', async () => {
    // Given a checkout on main with a tracked file edited and not committed
    const site = anInstallation();
    writeFileSync(join(site.workspace, 'notes.txt'), 'one\n');
    git(site.workspace, 'add', 'notes.txt');
    git(site.workspace, 'commit', '-q', '-m', 'add notes');
    appendFileSync(join(site.workspace, 'notes.txt'), 'two\n');
    // When the operator runs install
    const result = await operatorRunsInstall(site);
    // Then it succeeds
    expect(result.status, result.stderr).toBe(0);
    expect(hasBeenInstalled(site)).toBe(true);
  }, SLOW);
});

describe('the guard belongs to install alone', () => {
  it('@error status works on a feature branch: it reports and reads only', async () => {
    // Given a checkout on feature/x
    const site = anInstallation({ branch: 'feature/x' });
    const before = observeMachine(site);
    // When the operator runs status
    const result = await operatorRunsStatus(site);
    // Then it produces a report, and the machine is only read
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toBe('');
    expectOnlyReadsHappened(before, site);
  }, SLOW);

  it('@error uninstall works on a feature branch: with nothing installed it says so and exits 0', async () => {
    // Given a checkout on feature/x with nothing installed
    const site = anInstallation({ branch: 'feature/x' });
    const before = observeMachine(site);
    // When the operator runs uninstall
    const result = await operatorRunsUninstall(site);
    // Then it reports there is nothing to remove, and only reads happened
    expect(result.status, result.stderr).toBe(0);
    expect(includesLine(result.stdout, NOTHING_TO_REMOVE)).toBe(true);
    expectOnlyReadsHappened(before, site);
  }, SLOW);
});
