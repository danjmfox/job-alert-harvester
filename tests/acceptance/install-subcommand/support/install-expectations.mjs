// Assertions shared by the install, uninstall and status scenarios. Each speaks of the machine through the observers of
// install-domain-types.mjs; none decides what production decides.
import { expect } from 'vitest';
import { assertStateDelta, unchanged } from '../../../common/state-delta.mjs';
import { MACHINE_UNIVERSE, controlCallsOf, observeMachine, operatorRuns, refusesWith } from './install-domain-types.mjs';

export const allUnchanged = () => Object.fromEntries(MACHINE_UNIVERSE.map((name) => [name, unchanged()]));

/** Nothing on the machine moved: no file or folder under HOME or the checkout, no launchctl call, no notification. */
export const expectTheMachineUnchanged = (before, site) => assertStateDelta(before, observeMachine(site), { universe: MACHINE_UNIVERSE, expected: allUnchanged() });

/** A refusal that changes nothing: exit 1, the code leading the last stderr line, stdout empty, the machine as it was. */
export async function expectARefusalThatChangesNothing(site, args, code, { command = 'install', cwd, gitOnPath } = {}) {
  const before = observeMachine(site);
  const options = { ...(cwd === undefined ? {} : { cwd }), ...(gitOnPath === undefined ? {} : { gitOnPath }) };
  const result = await operatorRuns(site, [command, ...args], options);
  expect(refusesWith(result, code), `${result.status} ${result.stderr}`).toBe(true);
  expectTheMachineUnchanged(before, site);
  return result;
}

const READS_ONLY_UNIVERSE = Object.freeze(['home.tree', 'workspace.tree', 'osascript.calls']);
/** The machine was only read: no file or folder changed, nothing was shown, and launchctl was asked nothing but `print`. */
export function expectOnlyReadsHappened(before, site) {
  assertStateDelta(before, observeMachine(site), { universe: READS_ONLY_UNIVERSE, expected: Object.fromEntries(READS_ONLY_UNIVERSE.map((name) => [name, unchanged()])) });
  expect(controlCallsOf(site)).toEqual([]);
}

/** A refusal after which the machine was at most read: exit 1, the code leading the last stderr line, stdout empty, no file changed, launchctl asked nothing but `print`. */
export async function expectARefusalThatOnlyReads(site, args, code, { command } = {}) {
  const before = observeMachine(site);
  const result = await operatorRuns(site, [command, ...args]);
  expect(refusesWith(result, code), `${result.status} ${result.stderr}`).toBe(true);
  expectOnlyReadsHappened(before, site);
  return result;
}
