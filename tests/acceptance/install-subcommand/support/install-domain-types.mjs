// Domain vocabulary for the install-subcommand acceptance tests (nWave Mandate-12).
//
// Production owns the domain nouns: the refusal codes come from src/. This module adds the operator's machine (a HOME that is
// empty, a checkout that is a real `git init` on a branch, a ledger, a node binary, a LaunchAgents folder that may or may not
// exist), the three tools the commands reach through the shell (`launchctl`, `osascript`, `git`) as PATH shims or the real
// thing, the command as an operator runs it (a spawned subprocess through the production composition root, the clock and the
// platform fixed by `node --import` preloads), the observers of what a run left behind, and the wording the scenarios pin.
// Nothing here decides anything a production module decides.
//
// Safety: every run gets an empty temp HOME and a PATH whose first entry is the shim directory, so `launchctl` and
// `osascript` are the shims, never the host's. `operatorRuns` refuses to start a run that does not have both.

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PROJECT_ROOT, anInterval } from '../../job-alert-harvester/support/domain-types.mjs';
import { aScratchWorkspace, anEmptyHome, useWorkspaceCleanup } from '../../search-yield-summary/support/search-yield-domain-types.mjs';
import { runHarvestAsync, writeJson } from '../../sheets-api-target/support/sheets-domain-types.mjs';
import { includesLine, indexOfLineMatching, lastLineOf, linesOf } from '../../update-subcommand/support/update-domain-types.mjs';
import { aLaunchctlPrint } from './launchctl-print-sample.mjs';
import { callsRecordedIn, writeFakeNode, writeInertNode, writeLaunchctlShim, writeOsascriptShim, writeToolbox } from './shims.mjs';
import { parsePlist } from './plist-oracle.mjs';

export { InstallRefusal } from '../../../../src/core/install-plan.mjs';
export { CliRefusal } from '../../../../src/core/cli-options.mjs';
export { runHarvestAsync, useWorkspaceCleanup, includesLine, indexOfLineMatching, lastLineOf, linesOf, writeJson, aLaunchctlPrint };

// ---------------------------------------------------------------- the fixed facts

/** The one job label (DESIGN Q-label), restated so a scenario can notice production changing it. */
export const LABEL = 'local.job-alert-harvester.update';
export const DEFAULT_UID = 501;
export const NOW = '2026-09-10T07:30:00.000Z';
const FIXED_CLOCK = pathToFileURL(new URL('../../search-yield-summary/support/fixed-clock.mjs', import.meta.url).pathname).href;
const FIXED_PLATFORM = pathToFileURL(new URL('./fixed-platform.mjs', import.meta.url).pathname).href;
const GIT_IDENTITY = Object.freeze({
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Example Operator',
  GIT_AUTHOR_EMAIL: 'operator@example.invalid',
  GIT_COMMITTER_NAME: 'Example Operator',
  GIT_COMMITTER_EMAIL: 'operator@example.invalid',
});
/** The folder names an operator might keep a checkout in that macOS may protect from a background job (DESIGN, Earned Trust). */
export const PROTECTED_FOLDER = 'Documents';
/** Directory names that stress quoting: spaces, quotes, `&`, `<`, `$`, backticks, `;`, and command substitutions that would drop a file named SENTINEL in the current directory if ever run. */
export const HOSTILE_NAMES = Object.freeze([
  'with space',
  "it's here",
  'say "hi"',
  'a&b<c>d',
  'dollar $HOME and ${PATH}',
  'tick `touch SENTINEL` tick',
  'sub $(touch SENTINEL) sub',
  'semi; touch SENTINEL; done',
  'back\\slash',
  'unicode é — 日本',
]);

// ---------------------------------------------------------------- the wording the scenarios pin (DISTILL PINNED DECISIONS)

export const WARNING_PREFIX = 'harvest install: warning: ';
/** The prefix of every plan line: `harvest install:` for a run, `harvest install --dry-run:` for a preview. */
export const installPrefix = (dryRun) => (dryRun ? 'harvest install --dry-run:' : 'harvest install:');
export const actionLine = (verb, path, { dryRun = false } = {}) => `${installPrefix(dryRun)} ${verb} ${path}`;
export const nextLine = (command, { dryRun = false } = {}) => `${installPrefix(dryRun)} next: ${command}`;
/** Whether some stdout line ends with the command: how a preview or a `--load` preview names the command it would run. */
export const namesTheCommand = (stdout, command) => linesOf(stdout).some((line) => line.endsWith(command));
export const bootstrapCommand = (site) => `launchctl bootstrap gui/${site.uid} ${site.plist}`;
export const bootoutCommand = (site) => `launchctl bootout gui/${site.uid}/${LABEL}`;
export const loadedLine = (site) => `harvest install: loaded gui/${site.uid}/${LABEL}`;
export const RUNS_WHATEVER = 'runs whatever this checkout holds';
export const NOTHING_TO_REMOVE = 'harvest uninstall: nothing to remove';
export const removeLine = (path, { dryRun = false } = {}) => `${dryRun ? 'harvest uninstall --dry-run:' : 'harvest uninstall:'} remove ${path}`;
export const statusLine = (field, value) => `harvest status: ${field}: ${value}`;
export const statusFieldOf = (stdout, field) => linesOf(stdout).find((line) => line.startsWith(`harvest status: ${field}: `))?.slice(`harvest status: ${field}: `.length) ?? null;
export const warningsIn = (stderr) => linesOf(stderr).filter((line) => line.startsWith(WARNING_PREFIX));
export const refusalLineOf = (stderr) => lastLineOf(stderr);
export const refusesWith = (result, code) => result.status === 1 && lastLineOf(result.stderr).startsWith(`${code}:`) && result.stdout === '';

// ---------------------------------------------------------------- the machine

/** A scratch area outside the repository: an empty HOME, the shim directory and its state, the toolbox, node binaries. Removed after the scenario. */
export function aSandbox() {
  const root = realpathSync(anEmptyHome());
  const at = (name) => join(root, name);
  const sandbox = { root, home: at('home'), shims: at('shims'), trace: at('trace'), state: at('state'), tools: at('tools'), nodes: at('nodes'), tmp: at('tmp'), nodeOnly: at('node-only') };
  for (const directory of [sandbox.home, sandbox.trace, sandbox.state, sandbox.nodes, sandbox.tmp, sandbox.nodeOnly]) mkdirSync(directory, { recursive: true });
  writeLaunchctlShim(sandbox.shims);
  writeOsascriptShim(sandbox.shims);
  writeToolbox(sandbox.tools);
  symlinkSync(realpathSync(process.execPath), join(sandbox.nodeOnly, 'node'));
  return sandbox;
}

export const git = (directory, ...args) =>
  execFileSync('git', args, { cwd: directory, encoding: 'utf8', env: { ...process.env, ...GIT_IDENTITY, GIT_CEILING_DIRECTORIES: realpathSync(tmpdir()) } }).trim();

const writeInert = (path) => writeInertNode(path);
const NODES = (sandbox, hostileDirectory) => ({
  plain: join(sandbox.nodes, hostileDirectory ?? 'opt', 'node', 'bin', 'node'),
  versioned: join(sandbox.nodes, 'cellar', 'node', '22.9.1', 'bin', 'node'),
  fake: join(sandbox.nodes, hostileDirectory ?? 'fake', 'bin', 'node'),
  stableLink: join(sandbox.nodes, 'stable', 'node'),
});

/**
 * One operator's machine with a checkout of the harvester on it.
 * @param {object} [options]
 * @param {object} [options.sandbox] share another installation's HOME, shims and trace (a second checkout on the same machine)
 * @param {string} [options.platform] what the process believes `process.platform` is
 * @param {number} [options.uid] what it believes `process.getuid()` is
 * @param {string | null} [options.branch] `main`, another branch name, `detached`, or null for a directory that is not a git checkout
 * @param {'covered' | 'empty' | 'other-source' | 'absent'} [options.ledger] the coverage ledger: covers 7 to 9 September for linkedin, holds nothing, covers only another source, or no file and no `.cache/`
 * @param {'plain' | 'stable' | 'versioned' | 'fake'} [options.node] the node binary: a plain path, a versioned path with a stable `PATH` symlink to it, a versioned path with none, or a fake that records its calls
 * @param {string | null} [options.checkoutName] the directory name of the checkout (a hostile one, or a second one)
 * @param {string | null} [options.insideHome] a folder under HOME to keep the checkout in (the protected-folder case)
 * @param {string | null} [options.nodeDirectoryName] the directory name above the plain or fake node binary
 * @param {'absent' | 'exists'} [options.launchAgents] whether `<HOME>/Library/LaunchAgents` exists beforehand
 */
export function anInstallation({
  sandbox = aSandbox(),
  platform = 'darwin',
  uid = DEFAULT_UID,
  branch = 'main',
  ledger = 'covered',
  node = 'plain',
  checkoutName = null,
  insideHome = null,
  nodeDirectoryName = null,
  launchAgents = 'absent',
} = {}) {
  const workspace = insideHome !== null
    ? join(sandbox.home, insideHome, 'checkout')
    : checkoutName !== null
      ? join(sandbox.root, 'checkouts', checkoutName)
      : realpathSync(aScratchWorkspace());
  mkdirSync(workspace, { recursive: true });
  symlinkSync(join(PROJECT_ROOT, 'src'), join(workspace, 'src'));
  if (branch !== null) {
    git(workspace, 'init', '-q', '-b', 'main');
    git(workspace, 'commit', '-q', '--allow-empty', '-m', 'seed');
    if (branch === 'detached') git(workspace, 'checkout', '-q', '--detach');
    else if (branch !== 'main') git(workspace, 'checkout', '-q', '-b', branch);
  }
  const ledgerPath = join(workspace, '.cache/coverage.json');
  const intervals = { covered: [anInterval({ from: '2026-09-07', to: '2026-09-09', messageCount: 3 })], empty: [], 'other-source': [anInterval({ source: 'glassdoor', from: '2026-09-07', to: '2026-09-09' })] };
  if (ledger !== 'absent') writeJson(ledgerPath, intervals[ledger]);

  const nodes = NODES(sandbox, nodeDirectoryName);
  let execPath = nodes.plain;
  let pathEntries = [];
  if (node === 'plain') writeInert(nodes.plain);
  else if (node === 'versioned') {
    execPath = nodes.versioned;
    writeInert(nodes.versioned);
  } else if (node === 'stable') {
    execPath = nodes.versioned;
    writeInert(nodes.versioned);
    mkdirSync(dirname(nodes.stableLink), { recursive: true });
    symlinkSync(nodes.versioned, nodes.stableLink);
    pathEntries = [dirname(nodes.stableLink)];
  } else if (node === 'fake') {
    execPath = nodes.fake;
    writeFakeNode(nodes.fake);
  }
  const launchAgentsDirectory = join(sandbox.home, 'Library/LaunchAgents');
  if (launchAgents === 'exists') mkdirSync(launchAgentsDirectory, { recursive: true });
  return {
    ...sandbox,
    sandbox,
    workspace,
    platform,
    uid,
    branch,
    execPath,
    stableNodePath: nodes.stableLink,
    pathEntries,
    ledgerPath,
    launchAgentsDirectory,
    plist: join(launchAgentsDirectory, `${LABEL}.plist`),
    wrapper: join(workspace, '.cache/launchd/update.sh'),
    outLog: join(workspace, '.cache/logs/update.out.log'),
    errLog: join(workspace, '.cache/logs/update.err.log'),
  };
}

/** The same machine with a different node binary (an inert, executable file) at `path`: what an operator who upgraded node has. */
export function withNodeAt(site, path) {
  writeInertNode(path);
  return { ...site, execPath: path };
}

// ---------------------------------------------------------------- running

/** The environment of a run: an empty HOME, the shims first on PATH, the platform and node path fixed, git neutral. The scenario's own node entries come last, so the runner's bare `node` is always the real one, never an inert file. */
export const environmentOf = (site, { gitOnPath = true } = {}) => ({
  HOME: site.home,
  PATH: [site.shims, gitOnPath ? process.env.PATH : site.nodeOnly, ...site.pathEntries].join(':'),
  FIXED_PLATFORM: site.platform,
  FIXED_UID: String(site.uid),
  FIXED_EXEC_PATH: site.execPath,
  FIXED_CLOCK_ISO: NOW,
  NODE_OPTIONS: `--import=${FIXED_CLOCK} --import=${FIXED_PLATFORM}`,
  ...GIT_IDENTITY,
  GIT_CEILING_DIRECTORIES: realpathSync(tmpdir()),
  SHIM_TRACE_DIR: site.trace,
  SHIM_STATE_DIR: site.state,
});

function assertIsolated(site, environment) {
  const temporaryRoot = realpathSync(tmpdir());
  if (!site.home.startsWith(`${temporaryRoot}/`)) throw new Error(`refusing to run: HOME ${site.home} is not under ${temporaryRoot}`);
  if (environment.PATH.split(':')[0] !== site.shims) throw new Error('refusing to run: the shim directory is not first on PATH');
}

/** `harvest <args>` as a subprocess in the checkout (or `cwd`), against the shims, with nothing on the host reachable. */
export function operatorRuns(site, args, { cwd = site.workspace, gitOnPath = true, timeoutMs = 30_000 } = {}) {
  const env = environmentOf(site, { gitOnPath });
  assertIsolated(site, env);
  return runHarvestAsync(args, { cwd, env, timeoutMs });
}
export const operatorRunsInstall = (site, ...args) => operatorRuns(site, ['install', ...args]);
export const operatorRunsUninstall = (site, ...args) => operatorRuns(site, ['uninstall', ...args]);
export const operatorRunsStatus = (site, ...args) => operatorRuns(site, ['status', ...args]);

/** A Given: a first install has succeeded (so a later scenario can start from "already installed"). */
export async function anInstallationThatHasBeenDone(site, ...args) {
  const result = await operatorRunsInstall(site, ...args);
  assert.equal(result.status, 0, `the Given install failed: ${result.stderr}`);
  return result;
}

// ---------------------------------------------------------------- the shims' state

export const stage = (site, name, content) => writeFileSync(join(site.state, name), content);
/** launchd holds the job, printing `printed` when asked. */
export function aLoadedJob(site, printed = aLaunchctlPrint({ uid: site.uid, label: LABEL, plist: site.plist, wrapper: site.wrapper, root: site.workspace })) {
  stage(site, 'loaded', '');
  stage(site, 'print.out', printed);
}
export const launchctlFails = (site, verb, status) => stage(site, `exit.${verb}`, String(status));
export const osascriptFails = (site, status = 1) => stage(site, 'exit.osascript', String(status));
export const jobIsLoaded = (site) => existsSync(join(site.state, 'loaded'));
/** The shims note whether these paths exist at the moment of each call. */
export const watching = (site, paths) => stage(site, 'watch', `${paths.join('\n')}\n`);
export const callsOf = (site, tool) => callsRecordedIn(site.trace).filter((call) => call.tool === tool);
export const launchctlCalls = (site) => callsOf(site, 'launchctl');
export const verbsCalled = (site) => launchctlCalls(site).map((call) => call.argv[0]);
export const CONTROL_VERBS = Object.freeze(['bootstrap', 'bootout', 'kickstart', 'load', 'unload', 'enable', 'disable', 'kill']);
export const controlCallsOf = (site) => launchctlCalls(site).filter((call) => call.argv[0] !== 'print');

// ---------------------------------------------------------------- observing

const digestOf = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
/** Every entry under `root` as `relative path -> 'dir' | 'link:<target>' | sha256`; `.git` is left out. An absent root reads as {}. */
export function treeOf(root) {
  const tree = {};
  const walk = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (prefix === '' && entry.name === '.git') continue;
      const path = join(directory, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (lstatSync(path).isSymbolicLink()) tree[name] = `link:${readlinkSync(path)}`;
      else if (entry.isDirectory()) {
        tree[name] = 'dir';
        walk(path, name);
      } else tree[name] = digestOf(path);
    }
  };
  if (existsSync(root)) walk(root, '');
  return tree;
}

/** Port-exposed observables of the machine after a run: HOME, the checkout, and every `launchctl` and `osascript` call. */
export function observeMachine(site) {
  return {
    'home.tree': treeOf(site.home),
    'workspace.tree': treeOf(site.workspace),
    'launchctl.calls': launchctlCalls(site).map((call) => call.argv),
    'osascript.calls': callsOf(site, 'osascript').map((call) => call.argv),
  };
}
export const MACHINE_UNIVERSE = Object.freeze(['home.tree', 'workspace.tree', 'launchctl.calls', 'osascript.calls']);

const sorted = (values) => [...values].sort();
const keysOnlyIn = (left, right) => Object.keys(left).filter((key) => !(key in right));
/**
 * A tree changed by exactly: `created` entries added, `replaced` entries holding different content, `removed` entries gone, and nothing else.
 * `created` lists the entries the run may add; those that were already there are not expected to be added. With `ignoreDirectories`, directories are not compared.
 */
export const treeChangedBy = ({ created = [], replaced = [], removed = [] }, { ignoreDirectories = false } = {}) => ({
  description: `created ${JSON.stringify(created)}, replaced ${JSON.stringify(replaced)}, removed ${JSON.stringify(removed)}`,
  holds: (before, after) => {
    const concern = (tree) => (ignoreDirectories ? Object.fromEntries(Object.entries(tree).filter(([, value]) => value !== 'dir')) : tree);
    const [was, now] = [concern(before), concern(after)];
    const expectedCreated = created.filter((path) => !(path in before) && (!ignoreDirectories || after[path] !== 'dir'));
    const changed = Object.keys(now).filter((key) => key in was && was[key] !== now[key]);
    return (
      JSON.stringify(sorted(keysOnlyIn(now, was))) === JSON.stringify(sorted(expectedCreated)) &&
      JSON.stringify(sorted(changed)) === JSON.stringify(sorted(replaced)) &&
      JSON.stringify(sorted(keysOnlyIn(was, now))) === JSON.stringify(sorted(removed))
    );
  },
});
export const FRESH_HOME_ENTRIES = Object.freeze(['Library', 'Library/LaunchAgents', `Library/LaunchAgents/${LABEL}.plist`]);
export const FRESH_CHECKOUT_ENTRIES = Object.freeze(['.cache', '.cache/launchd', '.cache/launchd/update.sh', '.cache/logs']);

export const readPlistText = (site) => readFileSync(site.plist, 'utf8');
export const readWrapperText = (site) => readFileSync(site.wrapper, 'utf8');
export const thePlist = (site) => parsePlist(readPlistText(site)).value;
export const modeOf = (path) => lstatSync(path).mode & 0o777;
export const hasBeenInstalled = (site) => existsSync(site.plist) && existsSync(site.wrapper);

/** Sets both generated files' modification time far in the past, so a later rewrite is visible even when the text is the same. */
export function agedLongAgo(site, paths = [site.plist, site.wrapper]) {
  const longAgo = new Date('2020-01-01T00:00:00Z');
  for (const path of paths) utimesSync(path, longAgo, longAgo);
  return paths.map((path) => lstatSync(path).mtimeMs);
}
export const modifiedTimesOf = (paths) => paths.map((path) => lstatSync(path).mtimeMs);

// ---------------------------------------------------------------- a plist someone else wrote

/** The plist the how-to had the operator write by hand: no generated marker, a label of the operator's choosing. */
export function aHandMadePlist(site, { label = LABEL, root = site.workspace, wrapper = join(site.sandbox.root, 'my-wrapper.sh') } = {}) {
  mkdirSync(site.launchAgentsDirectory, { recursive: true });
  const text = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>${wrapper}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${root}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>7</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
</dict>
</plist>
`;
  writeFileSync(site.plist, text);
  return text;
}

// ---------------------------------------------------------------- running the generated wrapper

/**
 * What the fake node does when the wrapper runs it.
 * @param {{ stderr?: string, stdout?: string, exit?: number }} behaviour
 */
export function theNodeWill(site, { stderr = '', stdout = '', exit = 0 }) {
  stage(site, 'node.stderr', stderr);
  stage(site, 'node.stdout', stdout);
  stage(site, 'node.exit', String(exit));
}

/**
 * Runs the generated wrapper as launchd does (`/bin/sh <wrapper>`), from a directory that is not the checkout, with a PATH of the
 * shim directory and a toolbox of plain utilities (the host's `osascript` is not reachable), and TMPDIR pointing at an empty directory.
 * @param {'works' | 'missing'} [osascript] whether an `osascript` is on PATH (the shim) or not
 */
export function runsTheWrapper(site, { osascript = 'works', wrapper = site.wrapper, from = site.sandbox.root } = {}) {
  const pathEntries = osascript === 'works' ? [site.shims, site.tools] : [site.tools];
  const result = spawnSync('/bin/sh', [wrapper], {
    cwd: from,
    encoding: 'utf8',
    env: { PATH: pathEntries.join(':'), TMPDIR: site.tmp, HOME: site.home, SHIM_TRACE_DIR: site.trace, SHIM_STATE_DIR: site.state },
    timeout: 20_000,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
export const nodeRuns = (site) => callsOf(site, 'node');
export const notificationsShown = (site) => callsOf(site, 'osascript');
export const leftInTheTemporaryDirectory = (site) => readdirSync(site.tmp);
export const removeExecutableBit = (path) => chmodSync(path, 0o644);

/** The notification the DESIGN says a failed run shows: the last non-empty stderr line, control characters removed, or `exit status N` when nothing is left. */
export function expectedNotification(stderrText, status) {
  const last = stderrText.split('\n').filter((line) => line !== '').at(-1) ?? '';
  const cleaned = last.replace(/[\u0000-\u001f\u007f]/g, '');
  return cleaned === '' ? `exit status ${status}` : cleaned;
}
/** The argv elements of a recorded call that contain `marker`. */
export const argumentsHolding = (call, marker) => call.argv.filter((argument) => argument.includes(marker));
