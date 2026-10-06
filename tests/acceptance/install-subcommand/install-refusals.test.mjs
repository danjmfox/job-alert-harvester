// @contract-shape:unbounded-preservation
// What `harvest install` refuses or warns about before it writes: the `--at` value, the platform, the directory it runs from,
// paths it cannot embed safely, folders it cannot write, an empty ledger, and the node path it chooses. Every refusal is exit 1,
// stdout empty, the code leading the last stderr line, and the machine (HOME, the checkout, launchctl, osascript) exactly as it
// was. Covers DESIGN slice 2 (`--at`, platform, identity, safety, baseline, node path). Subprocess layer: example-only, each
// sad path a named example (Mandate 11).
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scenario } from './support/red-gate.mjs';
import {
  HOSTILE_NAMES,
  InstallRefusal,
  PROTECTED_FOLDER,
  aHandMadePlist,
  anInstallation,
  anInstallationThatHasBeenDone,
  hasBeenInstalled,
  operatorRunsInstall,
  readWrapperText,
  thePlist,
  useWorkspaceCleanup,
  warningsIn,
} from './support/install-domain-types.mjs';
import { expectARefusalThatChangesNothing } from './support/install-expectations.mjs';
import { writeInertNode } from './support/shims.mjs';

useWorkspaceCleanup();

const SLOW = 30_000;
const plutilAvailable = process.platform === 'darwin' && existsSync('/usr/bin/plutil');
const canBeDeniedWriteAccess = process.getuid() !== 0;

describe('--at chooses the hour and minute, validated before anything is read or written', () => {
  const TIMES = [
    ['00:00', 0, 0],
    ['05:30', 5, 30],
    ['09:07', 9, 7],
    ['12:05', 12, 5],
    ['23:59', 23, 59],
  ];
  for (const [text, hour, minute] of TIMES) {
    it(`--at ${text} schedules the job for ${hour} hours ${minute} minutes: the plist carries both as integers`, async () => {
      // Given a fresh installation
      const site = anInstallation();
      // When the operator runs install --at with that time
      const result = await operatorRunsInstall(site, '--at', text);
      // Then the plist's start time is that hour and minute
      expect(result.status, result.stderr).toBe(0);
      expect(thePlist(site).StartCalendarInterval).toEqual({ Hour: hour, Minute: minute });
    }, SLOW);
  }

  const INVALID = ['5:30', '05:3', '24:00', '05:60', '0530', '05.30', '05:30:00', ' 05:30', '05:30 ', 'noon', '', '-1:00', '+5:30', '٠٥:٣٠', '05:30pm'];
  for (const text of INVALID) {
    it(`@error --at ${JSON.stringify(text)} is refused as install.invalid-time, and nothing is read, written or called`, async () => {
      // Given a fresh installation
      const site = anInstallation();
      // When the operator runs install --at with that text
      // Then it is refused as an invalid time and the machine is as it was
      await expectARefusalThatChangesNothing(site, ['--at', text], InstallRefusal.INVALID_TIME);
    }, SLOW);
  }

  it('@error an invalid time wins over every later refusal: off main, with a hand-made plist and a ledger that cannot be read, it is still install.invalid-time', async () => {
    // Given a checkout off main, a hand-made plist and a ledger that is not valid JSON
    const site = anInstallation({ branch: 'feature/x' });
    aHandMadePlist(site);
    writeFileSync(site.ledgerPath, '{not json');
    // When the operator runs install --at 99:99
    // Then the time is what is refused: nothing else was looked at
    await expectARefusalThatChangesNothing(site, ['--at', '99:99'], InstallRefusal.INVALID_TIME);
  }, SLOW);

  it('@error the platform is checked before the time: off macOS an invalid --at is install.unsupported-platform', async () => {
    // Given a machine that is not macOS
    const site = anInstallation({ platform: 'linux' });
    // When the operator runs install --at 99:99
    // Then the platform is what is refused
    await expectARefusalThatChangesNothing(site, ['--at', '99:99'], InstallRefusal.UNSUPPORTED_PLATFORM);
  }, SLOW);
});

describe('the platform must be macOS, for all three commands, and nothing is read first', () => {
  const OFF_MACOS = [
    ['install', 'linux', { branch: 'feature/x' }],
    ['install', 'freebsd', {}],
    ['uninstall', 'linux', {}],
    ['uninstall', 'freebsd', {}],
    ['status', 'linux', {}],
    ['status', 'freebsd', {}],
  ];
  for (const [command, platform, options] of OFF_MACOS) {
    (command === 'install' ? it : scenario)(`@error ${command} on ${platform} is refused as install.unsupported-platform, ahead of every other check, and reaches no launchctl`, async () => {
      // Given a ${platform} machine (for install, one whose checkout is also off main, so a later refusal would otherwise fire)
      const site = anInstallation({ platform, ...options });
      // When the operator runs the command
      // Then the platform is refused and nothing was read, written or called
      await expectARefusalThatChangesNothing(site, [], InstallRefusal.UNSUPPORTED_PLATFORM, { command });
    }, SLOW);
  }
});

describe('install runs from the checkout it will schedule', () => {
  it('@error a directory whose src/cli/harvest.mjs is another file is install.wrong-directory: the job would run a different checkout', async () => {
    // Given the operator runs this repository's harvest from a directory that holds its own, different, src/cli/harvest.mjs
    const site = anInstallation();
    rmSync(join(site.workspace, 'src'));
    mkdirSync(join(site.workspace, 'src/cli'), { recursive: true });
    writeFileSync(join(site.workspace, 'src/cli/harvest.mjs'), '// another checkout\n');
    // When the operator runs install
    // Then it is refused as the wrong directory and nothing was written
    await expectARefusalThatChangesNothing(site, [], InstallRefusal.WRONG_DIRECTORY);
  }, SLOW);

  it('@error a subdirectory of the checkout is install.wrong-directory: .cache/ would be resolved against it', async () => {
    // Given the operator is in a subdirectory of the checkout
    const site = anInstallation();
    const subdirectory = join(site.workspace, 'docs');
    mkdirSync(subdirectory);
    // When the operator runs install there
    // Then it is refused as the wrong directory and nothing was written
    await expectARefusalThatChangesNothing(site, [], InstallRefusal.WRONG_DIRECTORY, { cwd: subdirectory });
  }, SLOW);
});

describe('paths that cannot be embedded safely, and ones that can', () => {
  const UNSAFE = [
    ['a newline', 'new\nline'],
    ['a control character', 'bell\u0007here'],
    ['a tab', 'tab\there'],
  ];
  for (const [what, name] of UNSAFE) {
    it(`@error a checkout directory name with ${what} is refused as install.unsafe-path and nothing is written`, async () => {
      // Given a checkout whose directory name holds ${what}
      const site = anInstallation({ checkoutName: name });
      // When the operator runs install
      // Then the path is refused as unsafe and the machine is as it was
      await expectARefusalThatChangesNothing(site, [], InstallRefusal.UNSAFE_PATH);
    }, SLOW);
  }

  it('@error a node path with a newline in its directory name is refused as install.unsafe-path and nothing is written', async () => {
    // Given a node binary whose directory name holds a newline
    const site = anInstallation({ nodeDirectoryName: 'new\nline' });
    // When the operator runs install
    // Then the path is refused as unsafe and the machine is as it was
    await expectARefusalThatChangesNothing(site, [], InstallRefusal.UNSAFE_PATH);
  }, SLOW);

  for (const name of HOSTILE_NAMES) {
    it(`a checkout directory named ${JSON.stringify(name)} installs, and the plist names exactly that directory; nothing in the name is run`, async () => {
      // Given a checkout whose directory name holds characters that break quoting
      const site = anInstallation({ checkoutName: name });
      // When the operator runs install
      const result = await operatorRunsInstall(site);
      // Then it succeeds, the plist's working directory and wrapper are that directory's, and no command in the name ran
      expect(result.status, result.stderr).toBe(0);
      expect(thePlist(site)).toMatchObject({ WorkingDirectory: site.workspace, ProgramArguments: ['/bin/sh', site.wrapper] });
      expect(hasBeenInstalled(site)).toBe(true);
      expect(existsSync(join(site.workspace, 'SENTINEL'))).toBe(false);
      expect(existsSync(join(process.cwd(), 'SENTINEL'))).toBe(false);
    }, SLOW);
  }

  for (const name of ['a&b<c>d', 'say "hi"', "it's here", 'unicode é — 日本']) {
    it.skipIf(!plutilAvailable)(`@real-io the plist for a checkout named ${JSON.stringify(name)} passes plutil -lint`, async () => {
      // Given an install into a checkout whose name holds XML metacharacters
      const site = anInstallation({ checkoutName: name });
      await anInstallationThatHasBeenDone(site);
      // When plutil checks the plist
      const lint = spawnSync('/usr/bin/plutil', ['-lint', site.plist], { encoding: 'utf8' });
      // Then it is well formed
      expect(lint.status, lint.stdout + lint.stderr).toBe(0);
    }, SLOW);
  }
});

describe('folders that cannot be written are found before the first file is written', () => {
  it.skipIf(!canBeDeniedWriteAccess)('@error a LaunchAgents folder the operator cannot write to is install.not-writable, and not even the wrapper is written', async () => {
    // Given a LaunchAgents folder that is read-only
    const site = anInstallation({ launchAgents: 'exists' });
    chmodSync(site.launchAgentsDirectory, 0o500);
    try {
      // When the operator runs install
      // Then it is refused as not writable and the machine is as it was
      await expectARefusalThatChangesNothing(site, [], InstallRefusal.NOT_WRITABLE);
    } finally {
      chmodSync(site.launchAgentsDirectory, 0o700);
    }
  }, SLOW);

  it('@error a Library/LaunchAgents that is a file is install.not-writable, and the checkout is not touched', async () => {
    // Given HOME holds a file where the LaunchAgents folder should be
    const site = anInstallation();
    mkdirSync(join(site.home, 'Library'));
    writeFileSync(join(site.home, 'Library/LaunchAgents'), 'in the way');
    // When the operator runs install
    // Then it is refused as not writable and nothing changed
    await expectARefusalThatChangesNothing(site, [], InstallRefusal.NOT_WRITABLE);
  }, SLOW);

  it('@error a .cache that is a file is install.not-writable, and no plist is written to HOME', async () => {
    // Given the checkout holds a file where .cache/ should be
    const site = anInstallation({ ledger: 'absent' });
    writeFileSync(join(site.workspace, '.cache'), 'in the way');
    // When the operator runs install
    // Then it is refused as not writable and nothing changed
    await expectARefusalThatChangesNothing(site, [], InstallRefusal.NOT_WRITABLE);
  }, SLOW);
});

describe('an empty ledger warns and proceeds', () => {
  const NO_BASELINE = [
    ['holds no interval', 'empty'],
    ['covers only another source', 'other-source'],
    ['does not exist, and neither does .cache/', 'absent'],
  ];
  for (const [what, ledger] of NO_BASELINE) {
    it(`@error a ledger that ${what}: install warns on stderr that update would refuse update.no-baseline, and still writes both files`, async () => {
      // Given a ledger that ${what}
      const site = anInstallation({ ledger });
      // When the operator runs install
      const result = await operatorRunsInstall(site);
      // Then it succeeds with a warning that names the refusal the job would meet each morning
      expect(result.status, result.stderr).toBe(0);
      expect(warningsIn(result.stderr).some((line) => line.includes('update.no-baseline'))).toBe(true);
      // And both files were written
      expect(hasBeenInstalled(site)).toBe(true);
    }, SLOW);
  }
});

describe('the node path the job pins, and when it warns', () => {
  it('@error a stable PATH entry that is the running binary is pinned in preference to the versioned path, with no warning', async () => {
    // Given node 22.9.1 reached through a stable symlink that comes first on PATH
    const site = anInstallation({ node: 'stable' });
    // When the operator runs install
    const result = await operatorRunsInstall(site);
    // Then the wrapper pins the symlink, not the versioned file, and stderr is empty
    expect(result.status, result.stderr).toBe(0);
    expect(readWrapperText(site)).toContain(`'${site.stableNodePath}'`);
    expect(readWrapperText(site)).not.toContain(site.execPath);
    expect(result.stderr).toBe('');
  }, SLOW);

  it('@error a node reached only by a versioned path is pinned as it is, with a warning that names the path and that it holds a version', async () => {
    // Given node 22.9.1 with no stable entry on PATH
    const site = anInstallation({ node: 'versioned' });
    // When the operator runs install
    const result = await operatorRunsInstall(site);
    // Then it succeeds, pins that path, and warns that an upgrade would break the job
    expect(result.status, result.stderr).toBe(0);
    expect(readWrapperText(site)).toContain(`'${site.execPath}'`);
    const warning = warningsIn(result.stderr).find((line) => line.includes(site.execPath));
    expect(warning, result.stderr).toBeDefined();
    expect(warning.toLowerCase()).toContain('version');
  }, SLOW);

  it('@error a node on PATH that is not the running binary is not pinned: the running binary\'s own path is', async () => {
    // Given another node binary earlier on PATH than anything else
    const site = anInstallation({ node: 'plain' });
    const decoyDirectory = join(site.sandbox.nodes, 'decoy');
    writeInertNode(join(decoyDirectory, 'node'));
    const withDecoy = { ...site, pathEntries: [decoyDirectory] };
    // When the operator runs install
    const result = await operatorRunsInstall(withDecoy);
    // Then the wrapper pins the running binary and not the decoy
    expect(result.status, result.stderr).toBe(0);
    expect(readWrapperText(site)).toContain(`'${site.execPath}'`);
    expect(readWrapperText(site)).not.toContain(decoyDirectory);
  }, SLOW);
});

describe('a checkout in a folder macOS protects from background jobs', () => {
  it('@error @unconfirmed-behaviour a checkout under ~/Documents installs but warns that a launchd job may not be allowed to read it', async () => {
    // Given a checkout kept under the Documents folder of HOME
    const site = anInstallation({ insideHome: PROTECTED_FOLDER });
    // When the operator runs install
    const result = await operatorRunsInstall(site);
    // Then it succeeds and warns, naming the folder
    expect(result.status, result.stderr).toBe(0);
    expect(warningsIn(result.stderr).some((line) => line.includes(PROTECTED_FOLDER))).toBe(true);
    expect(hasBeenInstalled(site)).toBe(true);
  }, SLOW);
});
