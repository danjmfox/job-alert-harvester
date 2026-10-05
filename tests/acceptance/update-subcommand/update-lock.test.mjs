// @contract-shape:bounded-change
// DR-0016 decision 8: an exclusive-create lock file `.cache/update.lock` holding the pid of the running update. A second
// update while one runs refuses `update.already-running` and touches nothing; a lock left by a process that has died is
// recovered; the lock is released when the run ends, whether it succeeded or failed. The lock is the only file `update`
// adds under `.cache/`. Subprocess layer: each case is a named example (Mandate 11); a live holder is the test's own
// process, a dead one is a process that has exited.
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { assertStateDelta, unchanged } from '../../common/state-delta.mjs';
import { scenario } from './support/red-gate.mjs';
import {
  TokenRefusal,
  UpdateRefusal,
  WEEK_FILES_UNIVERSE,
  YESTERDAY,
  aDeadPid,
  aLockHeldBy,
  aScratchWorkspace,
  coveredDays,
  emptyListing,
  includesLine,
  lastLineOf,
  lockPathOf,
  observeWeekFiles,
  operatorRunsUpdate,
  pidIsAlive,
  STAGE_FAILED_PREFIX,
  summaryLineFor,
  theLockHolder,
  theUsualWeek,
  useWorkspaceCleanup,
} from './support/update-domain-types.mjs';

useWorkspaceCleanup();

const SLOW = 30_000;
const allUnchanged = (names) => Object.fromEntries(names.map((name) => [name, unchanged()]));

describe('@driving_adapter harvest update does not run twice at once', () => {
  it('@error a second update while one is running refuses update.already-running, reaches no service, and leaves the running update\'s lock alone', async () => {
    // Given another update is running: the lock names a live process
    const week = theUsualWeek(aScratchWorkspace());
    aLockHeldBy(week, process.pid);
    const before = observeWeekFiles(week);
    // When the operator runs update
    const result = await operatorRunsUpdate(week);
    // Then it refuses by name, last on stderr, and prints nothing to stdout
    expect(result.status).toBe(1);
    expect(lastLineOf(result.stderr).startsWith(UpdateRefusal.ALREADY_RUNNING)).toBe(true);
    expect(result.stdout).toBe('');
    // And neither service heard from it, the cache and ledger are untouched, and the lock still names the first update
    expect(week.gmail.requests).toHaveLength(0);
    expect(week.sheets.requests).toHaveLength(0);
    expect(theLockHolder(week)).toBe(String(process.pid));
    assertStateDelta(before, observeWeekFiles(week), { universe: WEEK_FILES_UNIVERSE, expected: allUnchanged(WEEK_FILES_UNIVERSE) });
  }, SLOW);

  it('@error a lock left by a process that has died is recovered: update runs to the end and the lock is gone', async () => {
    // Given a killed update left its lock behind, naming a process that no longer exists
    const week = theUsualWeek(aScratchWorkspace());
    const deadPid = aDeadPid();
    expect(pidIsAlive(deadPid)).toBe(false);
    aLockHeldBy(week, deadPid);
    // When the operator runs update
    const result = await operatorRunsUpdate(week);
    // Then it runs as if there were no lock, and releases its own
    expect(result.status, result.stderr).toBe(0);
    expect(lastLineOf(result.stdout)).toBe(summaryLineFor(1));
    expect(existsSync(lockPathOf(week))).toBe(false);
    expect(coveredDays(week)).toEqual([`2026-09-07..${YESTERDAY}`]);
  }, SLOW);

  it('@error while update runs its lock names a live process, and the lock is removed when the run ends', async () => {
    // Given Gmail will tell us, mid-fetch, what the lock holds
    const week = theUsualWeek(aScratchWorkspace());
    const seen = { holder: null, alive: null };
    week.gmail.override(
      'list',
      () => {
        seen.holder = theLockHolder(week);
        seen.alive = seen.holder === null ? null : pidIsAlive(Number(seen.holder));
        return emptyListing();
      },
      { times: 1, when: (request) => /after:\d+/.test(request.query.q ?? '') },
    );
    // When the operator runs update
    const result = await operatorRunsUpdate(week);
    // Then during the fetch the lock held one process id, as digits, of a process that was alive; afterwards it is gone
    expect(result.status, result.stderr).toBe(0);
    expect(seen.holder).toMatch(/^\d+\s*$/);
    expect(seen.alive).toBe(true);
    expect(existsSync(lockPathOf(week))).toBe(false);
  }, SLOW);

  it('@error a failed update releases its lock, so the next run gets as far as the fetch again instead of refusing', async () => {
    // Given an update that fails at the fetch because Gmail needs authorising again
    const week = theUsualWeek(aScratchWorkspace());
    week.gmail.revokeRefreshToken();
    const first = await operatorRunsUpdate(week);
    expect(first.status).toBe(1);
    expect(existsSync(lockPathOf(week))).toBe(false);
    // When the operator runs update again
    const second = await operatorRunsUpdate(week);
    // Then it is not refused as already running: it reaches the fetch and fails there the same way
    expect(second.status).toBe(1);
    expect(second.stderr).not.toContain(UpdateRefusal.ALREADY_RUNNING);
    expect(lastLineOf(second.stderr).startsWith(`${STAGE_FAILED_PREFIX} fetch`)).toBe(true);
    expect(lastLineOf(second.stderr)).toContain(TokenRefusal.REAUTH_REQUIRED);
    expect(existsSync(lockPathOf(week))).toBe(false);
  }, SLOW);

  it('@error an update that is refused for its command line takes no lock and leaves none', async () => {
    // Given a command line the option table refuses
    const week = theUsualWeek(aScratchWorkspace());
    // When the operator runs update --from with an impossible day
    const result = await operatorRunsUpdate(week, '--from', '2026-02-30');
    // Then it refuses and no lock file exists afterwards
    expect(result.status).toBe(1);
    expect(includesLine(result.stderr, /^cli\.invalid-date/)).toBe(true);
    expect(existsSync(lockPathOf(week))).toBe(false);
  }, SLOW);
});
