// Test infrastructure for install-subcommand: not a scenario, and unskipped. It proves the builders hand the scenarios what they
// claim (so a scenario cannot fail, or pass, because of a fixture): the shims record hostile arguments exactly and answer from
// staged state, the toolbox cannot reach the host's `osascript`, the installation is a real git checkout with the node and ledger
// asked for, the runner is isolated and reaches the real CLI under both preloads, the observers see what they must, and the
// oracles and generators reach the cases the properties are about. Nothing here exercises install, uninstall or status.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { holds } from '../sheets-api-target/support/property.mjs';
import { PROJECT_ROOT } from '../job-alert-harvester/support/domain-types.mjs';
import {
  FRESH_CHECKOUT_ENTRIES,
  FRESH_HOME_ENTRIES,
  HOSTILE_NAMES,
  LABEL,
  aHandMadePlist,
  aLaunchctlPrint,
  aLoadedJob,
  aSandbox,
  anInstallation,
  callsOf,
  environmentOf,
  expectedNotification,
  git,
  jobIsLoaded,
  launchctlCalls,
  launchctlFails,
  observeMachine,
  operatorRuns,
  osascriptFails,
  runsTheWrapper,
  stage,
  theNodeWill,
  treeChangedBy,
  treeOf,
  useWorkspaceCleanup,
  watching,
} from './support/install-domain-types.mjs';
import { AN_UNRECOGNISABLE_PRINT } from './support/launchctl-print-sample.mjs';
import { FORBIDDEN_IN_THE_TOOLBOX, callsRecordedIn } from './support/shims.mjs';
import { maskQuotedWords, parsePlist, timeOf, unescapeXml } from './support/plist-oracle.mjs';
import { absolutePathArb, nearMissTimeArb, nodeChoiceArb, printTextArb, specArb, validTimeArb } from './support/install-generators.mjs';

useWorkspaceCleanup();

const runShim = (site, tool, args) =>
  spawnSync(join(site.shims, tool), args, { encoding: 'utf8', env: { PATH: `${site.tools}`, SHIM_TRACE_DIR: site.trace, SHIM_STATE_DIR: site.state } });

describe('the launchctl shim records every call and answers from staged state', () => {
  it('records the arguments of each call in order, NUL-separated, and the paths it was told to watch', () => {
    const site = anInstallation();
    writeFileSync(join(site.workspace, 'seen-file'), '');
    watching(site, [join(site.workspace, 'seen-file'), join(site.workspace, 'not-there')]);
    runShim(site, 'launchctl', ['print', 'gui/501']);
    runShim(site, 'launchctl', ['bootstrap', 'gui/501', '/some path/with spaces.plist']);
    const calls = callsRecordedIn(site.trace);
    expect(calls.map((call) => [call.tool, ...call.argv])).toEqual([
      ['launchctl', 'print', 'gui/501'],
      ['launchctl', 'bootstrap', 'gui/501', '/some path/with spaces.plist'],
    ]);
    expect(calls[0].seen).toEqual({ [join(site.workspace, 'seen-file')]: true, [join(site.workspace, 'not-there')]: false });
  });

  it('answers print for the domain, for an unloaded job (status 113) and for a loaded one (the staged text)', () => {
    const site = anInstallation();
    expect(runShim(site, 'launchctl', ['print', 'gui/501']).status).toBe(0);
    const unloaded = runShim(site, 'launchctl', ['print', `gui/501/${LABEL}`]);
    expect([unloaded.status, unloaded.stderr]).toEqual([113, `Bad request.\nCould not find service "${LABEL}" in domain for user gui: 501\n`]);
    aLoadedJob(site, 'state = running\n');
    const loaded = runShim(site, 'launchctl', ['print', `gui/501/${LABEL}`]);
    expect([loaded.status, loaded.stdout]).toEqual([0, 'state = running\n']);
  });

  it('bootstrap loads, bootstrap of a loaded job fails with 5 so a missing bootout shows, bootout unloads, bootout of an unloaded job fails with 3', () => {
    const site = anInstallation();
    expect(runShim(site, 'launchctl', ['bootstrap', 'gui/501', 'p']).status).toBe(0);
    expect(jobIsLoaded(site)).toBe(true);
    expect(runShim(site, 'launchctl', ['bootstrap', 'gui/501', 'p']).status).toBe(5);
    expect(runShim(site, 'launchctl', ['bootout', `gui/501/${LABEL}`]).status).toBe(0);
    expect(jobIsLoaded(site)).toBe(false);
    expect(runShim(site, 'launchctl', ['bootout', `gui/501/${LABEL}`]).status).toBe(3);
  });

  it('a staged failure answers with its status and changes no state; a verb it does not know is refused with 64 and still recorded', () => {
    const site = anInstallation();
    launchctlFails(site, 'bootstrap', 7);
    launchctlFails(site, 'print-domain', 113);
    expect(runShim(site, 'launchctl', ['bootstrap', 'gui/501', 'p']).status).toBe(7);
    expect(jobIsLoaded(site)).toBe(false);
    expect(runShim(site, 'launchctl', ['print', 'gui/501']).status).toBe(113);
    expect(runShim(site, 'launchctl', ['kickstart', '-k', `gui/501/${LABEL}`]).status).toBe(64);
    expect(launchctlCalls(site).map((call) => call.argv[0])).toEqual(['bootstrap', 'print', 'kickstart']);
  });
});

describe('the osascript shim and the fake node record hostile arguments and replay staged output exactly', () => {
  it('osascript keeps an argument with quotes, backslashes, newlines and a leading dash as one element, and exits with the staged status', () => {
    const site = anInstallation();
    const hostile = ['-e', 'say "hi" \\ `x` $(y)\nsecond line', ''];
    osascriptFails(site, 4);
    expect(runShim(site, 'osascript', hostile).status).toBe(4);
    expect(callsOf(site, 'osascript')[0].argv).toEqual(hostile);
  });

  it('the fake node writes its staged stderr and stdout byte for byte, exits with the staged status, and records its arguments and directory', () => {
    const site = anInstallation({ node: 'fake' });
    theNodeWill(site, { stderr: 'bad "line"\n\\ `x`\n', stdout: 'out\n', exit: 3 });
    const run = spawnSync(site.execPath, ['src/cli/harvest.mjs', 'update'], { cwd: site.workspace, encoding: 'utf8', env: { PATH: site.tools, SHIM_TRACE_DIR: site.trace, SHIM_STATE_DIR: site.state } });
    expect([run.status, run.stdout, run.stderr]).toEqual([3, 'out\n', 'bad "line"\n\\ `x`\n']);
    const [call] = callsOf(site, 'node');
    expect(call.argv).toEqual(['src/cli/harvest.mjs', 'update']);
    expect(call.cwd).toBe(site.workspace);
    expect(call.self).toBe(site.execPath);
  });

  it('the toolbox resolves the plain utilities and none of the tools that reach the host', () => {
    const site = anInstallation();
    for (const tool of ['sh', 'cat', 'tail', 'tr', 'rm', 'mktemp']) expect(existsSync(join(site.tools, tool)), tool).toBe(true);
    for (const tool of FORBIDDEN_IN_THE_TOOLBOX) expect(existsSync(join(site.tools, tool)), tool).toBe(false);
  });

  it('a wrapper-shaped script run through runsTheWrapper sees the shim osascript first, or none at all, never the host\'s', () => {
    const site = anInstallation();
    const script = join(site.sandbox.root, 'probe.sh');
    writeFileSync(script, '#!/bin/sh\ncommand -v osascript || echo none\n');
    chmodSync(script, 0o755);
    expect(runsTheWrapper(site, { wrapper: script, osascript: 'works' }).stdout.trim()).toBe(join(site.shims, 'osascript'));
    expect(runsTheWrapper(site, { wrapper: script, osascript: 'missing' }).stdout.trim()).toBe('none');
  });
});

describe('an installation is a machine with a real checkout on it', () => {
  it('a default installation: an empty HOME, a git checkout on main with one commit, src pointing at this repository, a ledger covering 7 to 9 September, a node file', () => {
    const site = anInstallation();
    expect(treeOf(site.home)).toEqual({});
    expect(git(site.workspace, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(git(site.workspace, 'rev-list', '--count', 'HEAD')).toBe('1');
    expect(realpathSync(join(site.workspace, 'src/cli/harvest.mjs'))).toBe(realpathSync(join(PROJECT_ROOT, 'src/cli/harvest.mjs')));
    expect(JSON.parse(readFileSync(site.ledgerPath, 'utf8'))).toMatchObject([{ source: 'linkedin', from: '2026-09-07', to: '2026-09-09' }]);
    expect(lstatSync(site.execPath).mode & 0o111).not.toBe(0);
    expect(site.workspace).toBe(realpathSync(site.workspace));
  });

  it('a branch name, a detached HEAD and a directory that is not a checkout are each what they say', () => {
    expect(git(anInstallation({ branch: 'feature/x' }).workspace, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature/x');
    expect(git(anInstallation({ branch: 'detached' }).workspace, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD');
    const bare = anInstallation({ branch: null });
    expect(existsSync(join(bare.workspace, '.git'))).toBe(false);
    expect(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: bare.workspace, env: { ...environmentOf(bare), PATH: process.env.PATH } }).status).not.toBe(0);
  });

  it('the ledger comes covered, empty, covering only another source, or not at all (no .cache/ either)', () => {
    expect(JSON.parse(readFileSync(anInstallation({ ledger: 'empty' }).ledgerPath, 'utf8'))).toEqual([]);
    expect(JSON.parse(readFileSync(anInstallation({ ledger: 'other-source' }).ledgerPath, 'utf8')).map((interval) => interval.source)).toEqual(['glassdoor']);
    const absent = anInstallation({ ledger: 'absent' });
    expect(existsSync(join(absent.workspace, '.cache'))).toBe(false);
  });

  it('the node comes plain, versioned, versioned with a stable PATH symlink to it, or fake; only the stable one puts an entry on PATH', () => {
    const plain = anInstallation({ node: 'plain' });
    expect([plain.pathEntries, /\/\d+\.\d+\.\d+\//.test(plain.execPath)]).toEqual([[], false]);
    const versioned = anInstallation({ node: 'versioned' });
    expect([versioned.pathEntries, /\/22\.9\.1\//.test(versioned.execPath)]).toEqual([[], true]);
    const stable = anInstallation({ node: 'stable' });
    expect(stable.pathEntries).toHaveLength(1);
    expect(realpathSync(stable.stableNodePath)).toBe(stable.execPath);
    expect(existsSync(anInstallation({ node: 'fake' }).execPath)).toBe(true);
  });

  it('a hostile checkout name and a checkout under HOME are made as asked, and a second installation shares the first one\'s HOME, shims and trace', () => {
    const first = anInstallation({ checkoutName: HOSTILE_NAMES[1] });
    expect(first.workspace.endsWith(HOSTILE_NAMES[1])).toBe(true);
    expect(git(first.workspace, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    const second = anInstallation({ sandbox: first.sandbox, checkoutName: 'second' });
    expect([second.home, second.trace, second.shims]).toEqual([first.home, first.trace, first.shims]);
    expect(second.workspace).not.toBe(first.workspace);
    expect(anInstallation({ insideHome: 'Documents' }).workspace).toContain('/home/Documents/');
  });
});

describe('the runner is isolated and reaches the real command line under both preloads', () => {
  it('the environment puts the shims first, HOME in the sandbox, and fixes the platform, user and node path', () => {
    const site = anInstallation({ platform: 'linux', uid: 777 });
    const env = environmentOf(site);
    expect(env.PATH.split(':')[0]).toBe(site.shims);
    expect(env.HOME).toBe(site.home);
    expect([env.FIXED_PLATFORM, env.FIXED_UID, env.FIXED_EXEC_PATH]).toEqual(['linux', '777', site.execPath]);
    expect(environmentOf(site, { gitOnPath: false }).PATH.split(':').at(-1)).toBe(site.nodeOnly);
  });

  it('a node entry a scenario puts on PATH comes after the host\'s, so the runner\'s bare `node` is the real one and the entry is still on PATH for install to find', () => {
    const site = anInstallation({ node: 'stable' });
    const env = environmentOf(site);
    const resolved = spawnSync('/bin/sh', ['-c', 'command -v node'], { encoding: 'utf8', env });
    expect(resolved.stdout.trim()).not.toBe(site.stableNodePath);
    expect(env.PATH.split(':')).toContain(site.pathEntries[0]);
  });

  it('a run that would leave the sandbox is refused before it starts', () => {
    const site = anInstallation();
    expect(() => operatorRuns({ ...site, home: homedir() }, ['status'])).toThrow(/not under/);
  });

  it('the preloads make a subprocess answer as the fixed platform, user id and node path', () => {
    const site = anInstallation({ platform: 'linux', uid: 777 });
    const run = spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify([process.platform, process.getuid(), process.execPath]))'], { encoding: 'utf8', env: { ...process.env, ...environmentOf(site) } });
    expect(JSON.parse(run.stdout)).toEqual(['linux', 777, site.execPath]);
  });

  it('with no variable set the preload leaves the host\'s own answers', () => {
    const site = anInstallation();
    const env = { ...process.env, NODE_OPTIONS: environmentOf(site).NODE_OPTIONS };
    for (const name of ['FIXED_PLATFORM', 'FIXED_UID', 'FIXED_EXEC_PATH']) delete env[name];
    const run = spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify([process.platform, process.getuid(), process.execPath]))'], { encoding: 'utf8', env });
    expect(JSON.parse(run.stdout)).toEqual([process.platform, process.getuid(), process.execPath]);
  });

  it('the real command line is reached through the runner, and with the shims first the host\'s launchctl is never called: a refused rebuild-form command line exits 1 and the shim saw nothing', async () => {
    const site = anInstallation();
    const before = observeMachine(site);
    const result = await operatorRuns(site, ['--wat']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('cli.unknown-option');
    expect(observeMachine(site)).toEqual(before);
  });
});

describe('the observers and the oracles', () => {
  it('treeOf lists files with digests, directories and links, leaves out .git, and reads an absent root as empty', () => {
    const site = anInstallation({ ledger: 'covered' });
    const tree = treeOf(site.workspace);
    expect(Object.keys(tree).sort()).toEqual(['.cache', '.cache/coverage.json', 'src']);
    expect(tree['.cache']).toBe('dir');
    expect(tree.src).toMatch(/^link:/);
    expect(treeOf(join(site.workspace, 'nowhere'))).toEqual({});
  });

  it('treeChangedBy holds for exactly the changes it names and for no others', () => {
    const before = { a: 'x', b: 'y', d: 'dir' };
    const after = { a: 'x', b: 'changed', c: 'new', d: 'dir' };
    expect(treeChangedBy({ created: ['c'], replaced: ['b'] }).holds(before, after)).toBe(true);
    expect(treeChangedBy({ created: ['c'] }).holds(before, after)).toBe(false);
    expect(treeChangedBy({ created: ['c', 'z'], replaced: ['b'] }).holds(before, after)).toBe(false);
    expect(treeChangedBy({ created: [], removed: ['b'] }).holds({ b: 'y' }, {})).toBe(true);
    expect(treeChangedBy({ removed: ['b'] }, { ignoreDirectories: true }).holds({ b: 'y', k: 'dir' }, {})).toBe(true);
    expect(treeChangedBy({ created: ['a'] }).holds({ a: 'x' }, { a: 'x' })).toBe(true);
  });

  it('the expected entries of a first install are the plist under HOME and the wrapper and log folder under the checkout', () => {
    expect(FRESH_HOME_ENTRIES).toContain(`Library/LaunchAgents/${LABEL}.plist`);
    expect(FRESH_CHECKOUT_ENTRIES).toEqual(['.cache', '.cache/launchd', '.cache/launchd/update.sh', '.cache/logs']);
  });

  it('the plist reader reads the hand-made plist into plain values, keys in file order, and finds no generated marker in it', () => {
    const site = anInstallation();
    aHandMadePlist(site);
    const { value, comments } = parsePlist(readFileSync(site.plist, 'utf8'));
    expect(Object.keys(value)).toEqual(['Label', 'ProgramArguments', 'WorkingDirectory', 'StartCalendarInterval']);
    expect(value.StartCalendarInterval).toEqual({ Hour: 7, Minute: 0 });
    expect(comments).toEqual([]);
  });

  it('the plist reader refuses text that is not well formed: a raw <, a stray &, a closing tag out of order, a dict value without a key', () => {
    const wrap = (inner) => `<plist version="1.0"><dict><key>k</key>${inner}</dict></plist>`;
    expect(parsePlist(wrap('<string>a &amp; b &lt; &#65;</string>')).value).toEqual({ k: 'a & b < A' });
    expect(() => parsePlist(wrap('<string>a < b</string>'))).toThrow();
    expect(() => parsePlist(wrap('<string>a & b</string>'))).toThrow();
    expect(() => parsePlist(wrap('<string>a</key>'))).toThrow();
    expect(() => parsePlist('<plist version="1.0"><dict><string>x</string></dict></plist>')).toThrow();
    expect(() => unescapeXml('&nonsense;')).toThrow();
  });

  it('maskQuotedWords turns a single-quoted word, with the quote escaped inside it, into one placeholder', () => {
    expect(maskQuotedWords("cd 'a b' && node 'it'\\''s' x")).toBe('cd Q && node Q x');
  });

  it('the expected notification is the last non-empty stderr line without control characters, or the exit status when nothing is left', () => {
    expect(expectedNotification('first\nsecond \t"x"\r\n\n', 3)).toBe('second "x"');
    expect(expectedNotification('', 3)).toBe('exit status 3');
    expect(expectedNotification('\n\n', 9)).toBe('exit status 9');
  });

  it('the launchctl print sample carries the four fields the reader parses and drops pid when there is none', () => {
    const text = aLaunchctlPrint({ label: LABEL, plist: '/p', wrapper: '/w', root: '/r', state: 'running', runs: 4, lastExitCode: 78, pid: 321 });
    for (const line of ['        state = running', '        runs = 4', '        last exit code = 78', '        pid = 321']) expect(text).toContain(line);
    expect(aLaunchctlPrint({ label: LABEL, plist: '/p', wrapper: '/w', root: '/r' })).not.toContain('pid =');
    expect(AN_UNRECOGNISABLE_PRINT).not.toContain('=');
  });
});

describe('the generators reach the cases the properties are about', () => {
  const sample = (arbitrary, runs = 400) => fc.sample(arbitrary, runs);

  it('paths are absolute, free of control characters, and reach quotes, ampersands, angle brackets, dollars, backticks and non-ASCII', () => {
    const paths = sample(absolutePathArb);
    expect(paths.every((path) => path.startsWith('/') && !/[\u0000-\u001f\u007f]/.test(path))).toBe(true);
    for (const character of ["'", '"', '&', '<', '$', '`', '\\', ' ', 'é']) expect(paths.some((path) => path.includes(character)), character).toBe(true);
  });

  it('times: valid ones cover every kind of minute, near misses are mostly invalid yet look valid, and the mix reaches both', () => {
    expect(sample(validTimeArb, 300).every((time) => /^\d\d:\d\d$/.test(time))).toBe(true);
    const misses = sample(nearMissTimeArb);
    expect(misses.filter((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time)).length).toBeLessThan(misses.length);
    expect(misses.some((time) => /^\d\d:\d\d$/.test(time) === false && time.length >= 4)).toBe(true);
    expect(timeOf(0)).toBe('00:00');
    expect(timeOf(1439)).toBe('23:59');
  });

  it('specs carry hours 0 to 23 and minutes 0 to 59; print text reaches lines shaped like the fields; node choices reach both a match and no match', () => {
    const specs = sample(specArb);
    expect([Math.min(...specs.map((spec) => spec.hour)), Math.max(...specs.map((spec) => spec.hour))]).toEqual([0, 23]);
    expect(sample(printTextArb).some((text) => /\tstate = /.test(text))).toBe(true);
    const choices = sample(nodeChoiceArb);
    expect(choices.some(({ execPath, candidates }) => candidates.some((candidate) => candidate.realPath === execPath))).toBe(true);
    expect(choices.some(({ execPath, candidates }) => candidates.every((candidate) => candidate.realPath !== execPath))).toBe(true);
  });

  it('holds reports a counterexample for a property that is false', () => {
    expect(() => holds(fc.property(fc.integer(), (n) => n < 0))).toThrow(/Property failed/);
  });
});
