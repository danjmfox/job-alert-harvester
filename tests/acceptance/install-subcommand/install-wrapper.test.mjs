// @contract-shape:bounded-change
// The wrapper script `harvest install` generates, executed for real as launchd runs it (`/bin/sh <wrapper>`), from a directory
// that is not the checkout, under a fake `node` and a fake `osascript` that record their calls. The PATH is the shim directory
// plus a toolbox of plain utilities: the host's `osascript` is not reachable, so no notification is ever shown. Covers DESIGN
// slice 3 and the wrapper's seven pinned behaviours: the working directory, the node-missing exit, the passthrough of stdout and
// stderr, the notification passed as an argument and never spliced into script text, temporary files removed on every path,
// quoting of embedded paths, and no PATH of its own. Subprocess layer: example-only, hostile inputs enumerated (Mandate 11).
import { describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  HOSTILE_NAMES,
  anInstallation,
  anInstallationThatHasBeenDone,
  argumentsHolding,
  expectedNotification,
  leftInTheTemporaryDirectory,
  nodeRuns,
  notificationsShown,
  osascriptFails,
  removeExecutableBit,
  runsTheWrapper,
  theNodeWill,
  treeOf,
  useWorkspaceCleanup,
} from './support/install-domain-types.mjs';

useWorkspaceCleanup();

const SLOW = 30_000;
/** An installation whose generated wrapper pins the fake node, ready to run. */
async function anInstalledWrapper(options = {}) {
  const site = anInstallation({ node: 'fake', ...options });
  await anInstallationThatHasBeenDone(site);
  return site;
}
const sentinelsIn = (site) => [join(site.workspace, 'SENTINEL'), join(site.sandbox.root, 'SENTINEL'), join(site.home, 'SENTINEL')].filter((path) => existsSync(path));

describe('the wrapper runs update in the checkout and passes its output through', () => {
  it('@real-io the wrapper runs the pinned node once, with the checkout\'s harvest script and the one word update', async () => {
    // Given an installed wrapper and a node that succeeds
    const site = await anInstalledWrapper();
    theNodeWill(site, { exit: 0 });
    // When launchd runs the wrapper
    const run = runsTheWrapper(site);
    // Then it succeeds, node ran once as the pinned path, with the harvest script and update, and nothing else
    expect(run.status, run.stderr).toBe(0);
    expect(nodeRuns(site)).toHaveLength(1);
    const [call] = nodeRuns(site);
    expect(call.self).toBe(site.execPath);
    expect(call.argv).toHaveLength(2);
    expect(call.argv[1]).toBe('update');
    expect(resolve(call.cwd, call.argv[0])).toBe(join(site.workspace, 'src/cli/harvest.mjs'));
  }, SLOW);

  it('@real-io the wrapper changes to the checkout first, even when launchd starts it somewhere else', async () => {
    // Given an installed wrapper, started from a directory that is not the checkout
    const site = await anInstalledWrapper();
    theNodeWill(site, { exit: 0 });
    // When launchd runs the wrapper
    runsTheWrapper(site, { from: site.sandbox.root });
    // Then node ran in the checkout
    expect(nodeRuns(site)[0].cwd).toBe(site.workspace);
  }, SLOW);

  it('@real-io a good run passes node\'s stdout through and replays its stderr, shows no notification, and exits 0', async () => {
    // Given a node that prints progress on both streams and succeeds
    const site = await anInstalledWrapper();
    theNodeWill(site, { stdout: 'harvest update: complete, fetched 1 day(s), built the Sheet\n', stderr: 'harvest build: merged\n', exit: 0 });
    // When launchd runs the wrapper
    const run = runsTheWrapper(site);
    // Then the streams arrive as node wrote them, and no notification was shown
    expect([run.status, run.stdout, run.stderr]).toEqual([0, 'harvest update: complete, fetched 1 day(s), built the Sheet\n', 'harvest build: merged\n']);
    expect(notificationsShown(site)).toHaveLength(0);
  }, SLOW);
});

describe('a failed run shows one notification carrying the last stderr line as an argument', () => {
  it('@error a failed update exits with node\'s own status, replays its stderr to the log, and shows one notification holding the last stderr line', async () => {
    // Given a node that fails with a named refusal
    const site = await anInstalledWrapper();
    const refusal = 'update.stage-failed: fetch stopped at gmail.quota-exhausted';
    theNodeWill(site, { stdout: 'harvest fetch: 2026-09-09..2026-09-09 — 0 message(s)\n', stderr: `${refusal}\n`, exit: 3 });
    // When launchd runs the wrapper
    const run = runsTheWrapper(site);
    // Then it exits 3, the stderr reached the log, and one notification carries the line as one argument
    expect(run.status).toBe(3);
    expect(run.stderr).toBe(`${refusal}\n`);
    expect(notificationsShown(site)).toHaveLength(1);
    expect(notificationsShown(site)[0].argv.filter((argument) => argument === refusal)).toHaveLength(1);
  }, SLOW);

  const HOSTILE_LINES = [
    ['double quotes', 'say "hi" and "bye"'],
    ['a backslash before a quote', 'path C:\\temp\\"x" end'],
    ['backticks', 'run `touch SENTINEL` now'],
    ['a command substitution', 'value $(touch SENTINEL) end'],
    ['a shell break-out', 'end"; touch SENTINEL; echo "'],
    ['an AppleScript break-out', 'x" & (do shell script "touch SENTINEL") & "'],
    ['a leading dash that looks like an option', '-e display dialog "SENTINEL"'],
    ['percent signs and braces', '%s %d ${HOME} {x} SENTINEL'],
    ['single quotes', "it's 'quoted' SENTINEL"],
    ['non-ASCII text', 'déjà vu — 日本語 🙂'],
  ];
  for (const [what, line] of HOSTILE_LINES) {
    it(`@error a last stderr line with ${what} reaches osascript as one argument, equal to the line, and is never spliced into script text`, async () => {
      // Given a node that fails and ends its stderr with a hostile line
      const site = await anInstalledWrapper();
      theNodeWill(site, { stderr: `an earlier line\n${line}\n`, exit: 3 });
      // When launchd runs the wrapper
      const run = runsTheWrapper(site);
      // Then it exits 3 and exactly one notification was shown
      expect(run.status).toBe(3);
      expect(notificationsShown(site)).toHaveLength(1);
      const [shown] = notificationsShown(site);
      // And the line is one whole argument of it, and no other argument carries any of its text
      expect(shown.argv.filter((argument) => argument === expectedNotification(`${line}\n`, 3))).toHaveLength(1);
      expect(shown.argv.filter((argument) => argument.includes(line.slice(0, 8)))).toHaveLength(1);
      // And nothing in the line was run
      expect(sentinelsIn(site)).toEqual([]);
    }, SLOW);
  }

  it('@error control characters in the line are removed from the notification', async () => {
    // Given a node whose last stderr line holds a tab, a carriage return and a bell
    const site = await anInstalledWrapper();
    theNodeWill(site, { stderr: 'abc\tdef\rghi\u0007jkl\n', exit: 3 });
    // When launchd runs the wrapper
    runsTheWrapper(site);
    // Then the argument is the line without them
    expect(notificationsShown(site)[0].argv.filter((argument) => argument === 'abcdefghijkl')).toHaveLength(1);
  }, SLOW);

  it('@error the line used is the last non-empty one: trailing blank lines are skipped', async () => {
    // Given a node whose stderr ends with blank lines after the real last line
    const site = await anInstalledWrapper();
    theNodeWill(site, { stderr: 'first line\nlast real line\n\n\n', exit: 3 });
    // When launchd runs the wrapper
    runsTheWrapper(site);
    // Then the argument is that last real line
    expect(notificationsShown(site)[0].argv.filter((argument) => argument === 'last real line')).toHaveLength(1);
  }, SLOW);

  it('@error a very long line is cut: the argument is a prefix of the line, at least 60 characters and at most 1000', async () => {
    // Given a node whose last stderr line is 5000 characters of quotes, backslashes and backticks
    const site = await anInstalledWrapper();
    const line = 'a"b\\c`d'.repeat(715);
    theNodeWill(site, { stderr: `${line}\n`, exit: 3 });
    // When launchd runs the wrapper
    const run = runsTheWrapper(site);
    // Then it exits 3 and the notification's argument is a cut prefix of the line
    expect(run.status).toBe(3);
    const arguments_ = notificationsShown(site)[0].argv.filter((argument) => argument.startsWith('a"b'));
    expect(arguments_).toHaveLength(1);
    expect(line.startsWith(arguments_[0])).toBe(true);
    expect(arguments_[0].length).toBeGreaterThanOrEqual(60);
    expect(arguments_[0].length).toBeLessThanOrEqual(1000);
  }, SLOW);

  for (const [what, stderr, status] of [
    ['empty stderr', '', 3],
    ['only blank lines on stderr', '\n\n', 9],
    ['empty stderr and status 70', '', 70],
  ]) {
    it(`@error ${what}: the notification says exit status ${status}`, async () => {
      // Given a node that fails with ${what}
      const site = await anInstalledWrapper();
      theNodeWill(site, { stderr, exit: status });
      // When launchd runs the wrapper
      const run = runsTheWrapper(site);
      // Then it exits with that status and the notification names it
      expect(run.status).toBe(status);
      expect(notificationsShown(site)[0].argv.filter((argument) => argument === `exit status ${status}`)).toHaveLength(1);
    }, SLOW);
  }

  for (const status of [1, 2, 3, 70, 127, 255]) {
    it(`@error a node that exits ${status} makes the wrapper exit ${status} with one notification`, async () => {
      // Given a node that fails with status ${status}
      const site = await anInstalledWrapper();
      theNodeWill(site, { stderr: 'it failed\n', exit: status });
      // When launchd runs the wrapper
      const run = runsTheWrapper(site);
      // Then the wrapper exits the same way, and shows one notification
      expect(run.status).toBe(status);
      expect(notificationsShown(site)).toHaveLength(1);
    }, SLOW);
  }
});

describe('the wrapper cannot run, and says so', () => {
  it('@error a node file that is not executable: exit 127, one notification telling the operator to run harvest install again, node never run', async () => {
    // Given the pinned node is no longer executable
    const site = await anInstalledWrapper();
    removeExecutableBit(site.execPath);
    // When launchd runs the wrapper
    const run = runsTheWrapper(site);
    // Then it exits 127 and the notification says to run harvest install again
    expect(run.status).toBe(127);
    expect(nodeRuns(site)).toHaveLength(0);
    expect(notificationsShown(site)).toHaveLength(1);
    expect(notificationsShown(site)[0].argv.filter((argument) => argument.includes('harvest install'))).toHaveLength(1);
  }, SLOW);

  it('@error a node file that is gone (the operator upgraded node): exit 127 and the same notification', async () => {
    // Given the pinned node has been deleted
    const site = await anInstalledWrapper();
    rmSync(site.execPath);
    // When launchd runs the wrapper
    const run = runsTheWrapper(site);
    // Then it exits 127 and the notification says to run harvest install again
    expect(run.status).toBe(127);
    expect(notificationsShown(site)[0].argv.filter((argument) => argument.includes('harvest install'))).toHaveLength(1);
  }, SLOW);

  it('@error a checkout that is gone: the wrapper exits non-zero, shows one notification, and never runs node', async () => {
    // Given the wrapper has been kept and the checkout it names has been deleted
    const site = await anInstalledWrapper();
    const kept = join(site.sandbox.root, 'kept', 'update.sh');
    mkdirSync(join(site.sandbox.root, 'kept'));
    cpSync(site.wrapper, kept);
    rmSync(site.workspace, { recursive: true, force: true });
    // When launchd runs the kept wrapper
    const run = runsTheWrapper(site, { wrapper: kept });
    // Then it fails, with a notification, and node never ran
    expect(run.status).not.toBe(0);
    expect(notificationsShown(site)).toHaveLength(1);
    expect(nodeRuns(site)).toHaveLength(0);
  }, SLOW);
});

describe('a notification that cannot be shown never changes the exit status', () => {
  it('@error an osascript that fails leaves the wrapper\'s exit status as node\'s', async () => {
    // Given a node that fails with 3 and an osascript that fails with 1
    const site = await anInstalledWrapper();
    theNodeWill(site, { stderr: 'it failed\n', exit: 3 });
    osascriptFails(site, 1);
    // When launchd runs the wrapper
    const run = runsTheWrapper(site);
    // Then the wrapper still exits 3
    expect(run.status).toBe(3);
    expect(notificationsShown(site)).toHaveLength(1);
  }, SLOW);

  it('@error no osascript at all leaves the wrapper\'s exit status as node\'s', async () => {
    // Given a node that fails with 3 and a PATH with no osascript
    const site = await anInstalledWrapper();
    theNodeWill(site, { stderr: 'it failed\n', exit: 3 });
    // When launchd runs the wrapper
    const run = runsTheWrapper(site, { osascript: 'missing' });
    // Then the wrapper still exits 3
    expect(run.status).toBe(3);
  }, SLOW);

  it('@error no osascript and no node: the wrapper still exits 127', async () => {
    // Given the pinned node is gone and the PATH has no osascript
    const site = await anInstalledWrapper();
    rmSync(site.execPath);
    // When launchd runs the wrapper
    const run = runsTheWrapper(site, { osascript: 'missing' });
    // Then it exits 127
    expect(run.status).toBe(127);
  }, SLOW);
});

describe('the wrapper leaves no temporary file behind, on any path out', () => {
  const PATHS = [
    ['a good run', async (site) => theNodeWill(site, { stderr: 'progress\n', exit: 0 }), {}],
    ['a failed run', async (site) => theNodeWill(site, { stderr: 'it failed\n', exit: 3 }), {}],
    ['a failed run with no osascript', async (site) => theNodeWill(site, { stderr: 'it failed\n', exit: 3 }), { osascript: 'missing' }],
    ['a node that is gone', async (site) => rmSync(site.execPath), {}],
  ];
  for (const [what, arrange, runOptions] of PATHS) {
    it(`@error after ${what} the temporary directory is empty and the checkout's .cache is as it was`, async () => {
      // Given an installed wrapper and ${what} about to happen
      const site = await anInstalledWrapper();
      await arrange(site);
      const cacheBefore = treeOf(join(site.workspace, '.cache'));
      // When launchd runs the wrapper
      runsTheWrapper(site, runOptions);
      // Then nothing is left in the temporary directory, and the wrapper wrote nothing to .cache
      expect(leftInTheTemporaryDirectory(site)).toEqual([]);
      expect(treeOf(join(site.workspace, '.cache'))).toEqual(cacheBefore);
    }, SLOW);
  }
});

describe('paths with quoting hazards in them are run, not interpreted', () => {
  for (const name of HOSTILE_NAMES) {
    it(`@real-io a checkout and a node binary both in directories named ${JSON.stringify(name)}: the wrapper changes into the first and runs the second, and nothing in the names is run`, async () => {
      // Given an install whose checkout directory and node directory carry that name
      const site = await anInstalledWrapper({ checkoutName: name, nodeDirectoryName: name });
      theNodeWill(site, { exit: 0 });
      // When launchd runs the wrapper
      const run = runsTheWrapper(site);
      // Then it succeeds, node ran as the pinned path in the checkout, and no command in the names ran
      expect(run.status, run.stderr).toBe(0);
      expect(nodeRuns(site)).toHaveLength(1);
      expect(nodeRuns(site)[0].self).toBe(site.execPath);
      expect(nodeRuns(site)[0].cwd).toBe(site.workspace);
      expect(sentinelsIn(site)).toEqual([]);
      expect(argumentsHolding(nodeRuns(site)[0], 'SENTINEL')).toEqual([]);
    }, SLOW);
  }
});
