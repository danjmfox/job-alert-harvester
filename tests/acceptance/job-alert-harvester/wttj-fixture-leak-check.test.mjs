// @contract-shape:unbounded-preservation
// welcome-to-the-jungle-source, DDD-15 and the DEVOPS R1 note: every file committed under fixtures/wttj/ is
// invented text. The folder is not gitignored, so one real token or tracking link in it would be published. This
// test reads every file in the folder and fails on a foreign host, a foreign mail address, a run of 40 or more
// token characters, or an unsubscribe or token value. Each rule is first shown to fire on a deliberately bad
// string, so a rule that matches nothing cannot pass silently. A preservation guard over committed files: it is
// GREEN once the fixtures exist, and it fails the day a real value is pasted into one.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { WELCOME_FIXTURES_DIR, WELCOME_SENDER, WelcomeAlert } from './support/wttj-fixtures.mjs';
import {
  LEAK_RULES,
  TOKEN_RUN_LENGTH,
  foreignAddresses,
  foreignHosts,
  leaksIn,
  longTokenRuns,
  unsubscribeOrTokenValues,
} from './support/fixture-leaks.mjs';

const filesUnder = (directory) =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();

describe('every fixture of the Welcome to the Jungle source is invented text (DDD-15)', () => {
  it('holds every alert the acceptance tests name, and nothing the tests do not know of', () => {
    // Given the committed fixture folder
    // When its files are listed
    const names = filesUnder(WELCOME_FIXTURES_DIR).map((path) => path.slice(WELCOME_FIXTURES_DIR.length + 1));

    // Then it holds one file per named alert, so the check below is never over an empty folder
    expect(names).toEqual(Object.values(WelcomeAlert).map((alert) => `${alert}.json`).sort());
  });

  it('carries no real host, address, token or unsubscribe value in any file', () => {
    // Given every file under the fixture folder
    const files = filesUnder(WELCOME_FIXTURES_DIR);

    // When each is checked against the four leak rules
    const leaks = files.flatMap((path) => leaksIn(readFileSync(path, 'utf8')).map((leak) => `${path.slice(WELCOME_FIXTURES_DIR.length + 1)} -> ${leak}`));

    // Then nothing is found
    expect(leaks).toEqual([]);
  });
});

describe('@error each leak rule fires on a deliberately bad string and stays quiet on a clean one', () => {
  const run = (length) => 'A1b2'.repeat(Math.ceil(length / 4)).slice(0, length);

  it.each([
    ['a URL on a real host', foreignHosts, 'see https://www.example.com/jobs/1 here', 'see https://example.invalid/ls/click?upn=u001.three-1 here'],
    ['a URL on a host that only ends like the safe one', foreignHosts, 'https://example.invalid.evil.test/a', 'https://example.invalid/a'],
    ['an address at a real domain', foreignAddresses, 'write to someone@gmail.com today', `from ${WELCOME_SENDER} and ops@example.invalid`],
    ['another address at the sender\'s domain', foreignAddresses, 'jane.doe@welcometothejungle.com', WELCOME_SENDER],
    [`a run of ${TOKEN_RUN_LENGTH} token characters`, longTokenRuns, `upn: ${run(TOKEN_RUN_LENGTH)}`, `upn: ${run(TOKEN_RUN_LENGTH - 1)}`],
    ['an unsubscribe link carrying a value', unsubscribeOrTokenValues, 'https://example.invalid/unsubscribe?upn=abc', 'Unsubscribe at https://example.invalid/stop'],
    ['a token= value', unsubscribeOrTokenValues, 'link?token=abc123', 'a token of appreciation'],
  ])('%s', (_name, rule, bad, clean) => {
    expect(rule(bad), `bad: ${bad}`).not.toEqual([]);
    expect(rule(clean), `clean: ${clean}`).toEqual([]);
  });

  it('is listed once in the combined check, so no rule is left out of it', () => {
    // Given one string that breaks every rule
    const everything = ['https://real.example.com/x', 'a@b.com', run(TOKEN_RUN_LENGTH), 'token=zzz'].join(' ');

    // When the combined check reads it
    const leaks = leaksIn(everything);

    // Then each of the four rules reports at least once
    for (const rule of Object.keys(LEAK_RULES)) expect(leaks.some((leak) => leak.startsWith(`${rule}:`)), rule).toBe(true);
  });
});
