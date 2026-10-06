// @contract-shape:unbounded-preservation
// `harvest status` (DESIGN slice 5): a read-only report of the scheduled job. Every scenario asserts that only reads happened:
// no file or folder changed, no notification, and launchctl was asked nothing but `print`. "Loaded" is the exit status of
// `launchctl print`; the other launchd fields are read from named lines of its text and read `unknown` when absent. That text
// is a sanitised real sample (support/launchctl-print-sample.mjs, DESIGN slice 0); scenarios that rely on fields the sample
// does not show (the running state, the pid, an unloaded job) carry `@unconfirmed-format`. Exit 0 whenever a report was produced. Subprocess layer: example-only (Mandate 11).
import { describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  InstallRefusal,
  LABEL,
  aHandMadePlist,
  aLaunchctlPrint,
  aLoadedJob,
  anInstallation,
  anInstallationThatHasBeenDone,
  launchctlCalls,
  launchctlFails,
  observeMachine,
  operatorRunsStatus,
  readPlistText,
  stage,
  statusFieldOf,
  useWorkspaceCleanup,
} from './support/install-domain-types.mjs';
import { expectOnlyReadsHappened } from './support/install-expectations.mjs';
import { AN_UNRECOGNISABLE_PRINT, aPrintWithOnlyTheState } from './support/launchctl-print-sample.mjs';

useWorkspaceCleanup();

const SLOW = 30_000;
const printed = (site, fields = {}) => aLaunchctlPrint({ uid: site.uid, label: LABEL, plist: site.plist, wrapper: site.wrapper, root: site.workspace, ...fields });
/** An installed job that launchd holds, printing the given fields. */
async function aLoadedInstalledJob(fields = {}) {
  const site = anInstallation();
  await anInstallationThatHasBeenDone(site);
  aLoadedJob(site, printed(site, fields));
  return site;
}
const writeLog = (path, text, modified) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  utimesSync(path, new Date(modified), new Date(modified));
};

describe('status reports whether the job is installed and loaded', () => {
  it('the job is installed and loaded: status reports the schedule, that it is loaded, its state, runs and last exit code, that nothing has drifted and the node file is there', async () => {
    // Given an installed job that launchd holds, not running, three runs behind it, the last one clean
    const site = await aLoadedInstalledJob({ state: 'not running', runs: 3, lastExitCode: 0 });
    const before = observeMachine(site);
    // When the operator runs status
    const result = await operatorRunsStatus(site);
    // Then it reports on stdout and exits 0
    expect(result.status, result.stderr).toBe(0);
    expect(statusFieldOf(result.stdout, 'installed')).toMatch(/^yes/);
    expect(statusFieldOf(result.stdout, 'schedule')).toBe('05:30');
    expect(statusFieldOf(result.stdout, 'loaded')).toBe('yes');
    expect(statusFieldOf(result.stdout, 'state')).toBe('not running');
    expect(statusFieldOf(result.stdout, 'runs')).toBe('3');
    expect(statusFieldOf(result.stdout, 'last exit code')).toBe('0');
    expect(statusFieldOf(result.stdout, 'drift')).toBe('none');
    expect(statusFieldOf(result.stdout, 'node')).toBe('ok');
    expect(statusFieldOf(result.stdout, 'wrapper')).toBe('ok');
    // And only reads happened, launchctl asked nothing but print
    expectOnlyReadsHappened(before, site);
    expect(launchctlCalls(site).every((call) => call.argv[0] === 'print')).toBe(true);
  }, SLOW);

  it('@unconfirmed-format a job that is running reports its state and process id', async () => {
    // Given a loaded job that is running as process 4321
    const site = await aLoadedInstalledJob({ state: 'running', runs: 1, pid: 4321 });
    // When the operator runs status
    const result = await operatorRunsStatus(site);
    // Then both are reported
    expect(result.status, result.stderr).toBe(0);
    expect(statusFieldOf(result.stdout, 'state')).toBe('running');
    expect(statusFieldOf(result.stdout, 'pid')).toBe('4321');
  }, SLOW);

  it('@error a job whose last run failed is still a report, exit 0, with the exit code shown', async () => {
    // Given a loaded job whose last exit code was 78
    const site = await aLoadedInstalledJob({ runs: 5, lastExitCode: 78 });
    // When the operator runs status
    const result = await operatorRunsStatus(site);
    // Then it exits 0 and shows 78
    expect(result.status, result.stderr).toBe(0);
    expect(statusFieldOf(result.stdout, 'last exit code')).toBe('78');
  }, SLOW);

  it('@error an installed job that launchd does not hold is reported as not loaded, exit 0', async () => {
    // Given files installed and nothing loaded
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    const before = observeMachine(site);
    // When the operator runs status
    const result = await operatorRunsStatus(site);
    // Then it reports installed and not loaded
    expect(result.status, result.stderr).toBe(0);
    expect(statusFieldOf(result.stdout, 'installed')).toMatch(/^yes/);
    expect(statusFieldOf(result.stdout, 'loaded')).toBe('no');
    expect(statusFieldOf(result.stdout, 'state')).not.toBe('running');
    expectOnlyReadsHappened(before, site);
  }, SLOW);

  it('@error nothing installed is a report, not a refusal: not installed, not loaded, exit 0, stderr empty, and only reads', async () => {
    // Given a checkout with nothing installed
    const site = anInstallation();
    const before = observeMachine(site);
    // When the operator runs status
    const result = await operatorRunsStatus(site);
    // Then it reports not installed and not loaded
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(statusFieldOf(result.stdout, 'installed')).toBe('no');
    expect(statusFieldOf(result.stdout, 'loaded')).toBe('no');
    expectOnlyReadsHappened(before, site);
  }, SLOW);

  it('@error "loaded" is the exit status of launchctl print, not its text: staged text with the job not loaded is still not loaded', async () => {
    // Given launchd prints text for the job but answers "not found"
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    stage(site, 'print.out', printed(site, { state: 'running', pid: 99 }));
    // When the operator runs status
    const result = await operatorRunsStatus(site);
    // Then the job is not loaded
    expect(statusFieldOf(result.stdout, 'loaded')).toBe('no');
  }, SLOW);

  it('@error a launchctl print that fails for any reason reads as not loaded, and status still reports and exits 0', async () => {
    // Given launchctl print fails with status 1 for the job
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    launchctlFails(site, 'print', 1);
    // When the operator runs status
    const result = await operatorRunsStatus(site);
    // Then it reports not loaded and exits 0
    expect(result.status, result.stderr).toBe(0);
    expect(statusFieldOf(result.stdout, 'loaded')).toBe('no');
  }, SLOW);
});

describe('status says when the installed files no longer match what install would write', () => {
  it('@error a wrapper edited by hand is drift, naming the wrapper', async () => {
    // Given an installed job whose wrapper has had a line added
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    appendFileSync(site.wrapper, '# edited by hand\n');
    // When the operator runs status
    const result = await operatorRunsStatus(site);
    // Then drift is reported, naming the wrapper, and the exit is 0
    expect(result.status, result.stderr).toBe(0);
    expect(statusFieldOf(result.stdout, 'drift')).not.toBe('none');
    expect(statusFieldOf(result.stdout, 'drift')).toContain('wrapper');
  }, SLOW);

  it('@error a plist whose log path was edited by hand is drift naming the plist', async () => {
    // Given an installed job whose plist now sends the output log elsewhere
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    writeFileSync(site.plist, readPlistText(site).replace('update.out.log', 'elsewhere.log'));
    // When the operator runs status
    const result = await operatorRunsStatus(site);
    // Then drift is reported, naming the plist, and the exit is 0
    expect(result.status, result.stderr).toBe(0);
    expect(statusFieldOf(result.stdout, 'drift')).not.toBe('none');
    expect(statusFieldOf(result.stdout, 'drift')).toContain('plist');
  }, SLOW);

  it('@error a schedule chosen with --at is the plist\'s own, and is not drift', async () => {
    // Given an install at 06:45
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site, '--at', '06:45');
    // When the operator runs status
    const result = await operatorRunsStatus(site);
    // Then it shows 06:45 and no drift: the files are compared with what install writes for that schedule
    expect(result.status, result.stderr).toBe(0);
    expect(statusFieldOf(result.stdout, 'schedule')).toBe('06:45');
    expect(statusFieldOf(result.stdout, 'drift')).toBe('none');
  }, SLOW);

  it('@error a hand-made plist is reported as installed and foreign, with its own schedule', async () => {
    // Given the how-to's hand-made plist, scheduled for 07:00
    const site = anInstallation();
    aHandMadePlist(site);
    // When the operator runs status
    const result = await operatorRunsStatus(site);
    // Then it reports installed, says the plist is foreign, and shows 07:00
    expect(result.status, result.stderr).toBe(0);
    expect(statusFieldOf(result.stdout, 'installed')).toMatch(/^yes.*foreign/);
    expect(statusFieldOf(result.stdout, 'schedule')).toBe('07:00');
  }, SLOW);
});

describe('status flags what would make the job fail tomorrow', () => {
  it('@error a node file that is gone is flagged as missing, naming the path, and the report still exits 0', async () => {
    // Given an installed job whose pinned node binary was deleted
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    rmSync(site.execPath);
    // When the operator runs status
    const result = await operatorRunsStatus(site);
    // Then the node is flagged missing with its path, and the exit is 0
    expect(result.status, result.stderr).toBe(0);
    expect(statusFieldOf(result.stdout, 'node')).toMatch(/^missing/);
    expect(statusFieldOf(result.stdout, 'node')).toContain(site.execPath);
  }, SLOW);

  it('@error a wrapper that is gone (the operator deleted .cache) is flagged as missing, exit 0', async () => {
    // Given an installed job whose wrapper was deleted
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    rmSync(site.wrapper);
    // When the operator runs status
    const result = await operatorRunsStatus(site);
    // Then the wrapper is flagged missing
    expect(result.status, result.stderr).toBe(0);
    expect(statusFieldOf(result.stdout, 'wrapper')).toBe('missing');
  }, SLOW);

  it('@error the logs\' modification times and the last output line stand in for a last run time', async () => {
    // Given an installed job whose logs were last written at 05:31 on 9 September
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    writeLog(site.outLog, 'harvest update: nothing new from Gmail\nharvest update: complete, fetched 0 day(s), built the Sheet\n', '2026-09-09T05:31:00Z');
    writeLog(site.errLog, '', '2026-09-09T05:31:00Z');
    // When the operator runs status
    const result = await operatorRunsStatus(site);
    // Then both logs' times and the last line of the output log are reported
    expect(result.status, result.stderr).toBe(0);
    expect(statusFieldOf(result.stdout, 'output log')).toContain('2026-09-09T05:31');
    expect(statusFieldOf(result.stdout, 'error log')).toContain('2026-09-09T05:31');
    expect(statusFieldOf(result.stdout, 'last output line')).toBe('harvest update: complete, fetched 0 day(s), built the Sheet');
  }, SLOW);

  it('@error logs that do not exist yet read as none', async () => {
    // Given an installed job that has never run
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    // When the operator runs status
    const result = await operatorRunsStatus(site);
    // Then each log reads none
    expect(statusFieldOf(result.stdout, 'output log')).toBe('none');
    expect(statusFieldOf(result.stdout, 'error log')).toBe('none');
  }, SLOW);
});

describe('status fails loud only when it cannot understand a job launchd holds', () => {
  it('@error a loaded job whose print text has no recognised field is install.unrecognised-output, the raw text on stderr, stdout empty', async () => {
    // Given launchd holds the job and prints text in a format the reader does not know
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    aLoadedJob(site, AN_UNRECOGNISABLE_PRINT);
    // When the operator runs status
    const result = await operatorRunsStatus(site);
    // Then it is refused as unrecognised output, the raw text is on stderr, and nothing is on stdout
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unrecognised format 2027');
    expect(result.stderr.split('\n').some((line) => line.startsWith(`${InstallRefusal.UNRECOGNISED_OUTPUT}:`))).toBe(true);
    expect(result.stdout).toBe('');
  }, SLOW);

  it('@error a loaded job whose print text keeps only one known field reports that field, the others unknown, one stderr line naming the command, exit 0', async () => {
    // Given launchd prints a format that has kept the state line and dropped the rest
    const site = anInstallation();
    await anInstallationThatHasBeenDone(site);
    aLoadedJob(site, aPrintWithOnlyTheState('running'));
    // When the operator runs status
    const result = await operatorRunsStatus(site);
    // Then the report has the state, the rest unknown, and stderr names the raw command once
    expect(result.status, result.stderr).toBe(0);
    expect(statusFieldOf(result.stdout, 'loaded')).toBe('yes');
    expect(statusFieldOf(result.stdout, 'state')).toBe('running');
    for (const field of ['runs', 'last exit code', 'pid']) expect(statusFieldOf(result.stdout, field), field).toBe('unknown');
    expect(result.stderr.split('\n').filter((line) => line.includes(`launchctl print gui/${site.uid}/${LABEL}`))).toHaveLength(1);
  }, SLOW);
});
