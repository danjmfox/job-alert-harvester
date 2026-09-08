// Universe-bound state-delta assertion — JavaScript port of the nWave Mandate 8
// contract. A test declares the complete set of observable names it promises to
// track (the universe) and a predicate for each name it expects to change.
// Anything in the universe that moves without a predicate fails the assertion.
//
// Universe names are port-exposed observables — a file digest, a directory
// listing, a cell value, an exit code. Never an internal field.

import { isDeepStrictEqual } from 'node:util';

const show = (value) => (typeof value === 'string' ? JSON.stringify(value) : String(value));

const predicate = (description, holds) => ({ description, holds });

export const unchanged = () => predicate('unchanged', (before, after) => isDeepStrictEqual(before, after));

export const setTo = (value) =>
  predicate(`set to ${show(value)}`, (_before, after) => isDeepStrictEqual(after, value));

export const normalizedTo = (value) =>
  predicate(`normalized to ${show(value)}`, (_before, after) => isDeepStrictEqual(after, value));

export const appendedWith = (...items) =>
  predicate(`appended with ${show(items)}`, (before, after) => {
    if (!Array.isArray(before) || !Array.isArray(after)) return false;
    return (
      after.length === before.length + items.length &&
      isDeepStrictEqual(after.slice(0, before.length), before) &&
      isDeepStrictEqual(after.slice(before.length), items)
    );
  });

export const prependedWith = (...items) =>
  predicate(`prepended with ${show(items)}`, (before, after) => {
    if (!Array.isArray(before) || !Array.isArray(after)) return false;
    return (
      after.length === before.length + items.length &&
      isDeepStrictEqual(after.slice(0, items.length), items) &&
      isDeepStrictEqual(after.slice(items.length), before)
    );
  });

export const containing = (item) =>
  predicate(`containing ${show(item)}`, (_before, after) =>
    Array.isArray(after) ? after.some((entry) => isDeepStrictEqual(entry, item)) : String(after).includes(item),
  );

export const grownBy = (count) =>
  predicate(`grown by ${count}`, (before, after) => {
    if (!Array.isArray(before) || !Array.isArray(after)) return false;
    return after.length === before.length + count;
  });

/**
 * @param {Record<string, unknown>} before  snapshot taken before the action
 * @param {Record<string, unknown>} after   snapshot taken after the action
 * @param {{ universe: Iterable<string>, expected?: Record<string, {description:string, holds:Function}> }} contract
 */
export function assertStateDelta(before, after, { universe, expected = {} }) {
  const names = new Set(universe);
  const failures = [];

  for (const name of names) {
    if (!(name in before)) failures.push(`universe name ${show(name)} is absent from the before snapshot`);
    if (!(name in after)) failures.push(`universe name ${show(name)} is absent from the after snapshot`);
  }

  for (const name of Object.keys(expected)) {
    if (!names.has(name)) failures.push(`expectation on ${show(name)} names something outside the declared universe`);
  }

  for (const name of names) {
    if (!(name in before) || !(name in after)) continue;
    const rule = expected[name] ?? unchanged();
    if (rule.holds(before[name], after[name])) continue;
    failures.push(
      `${name}: expected ${rule.description}\n    before: ${show(before[name])}\n    after:  ${show(after[name])}`,
    );
  }

  if (failures.length > 0) {
    throw new Error(`state-delta violated:\n  - ${failures.join('\n  - ')}`);
  }
}
