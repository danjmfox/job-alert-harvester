// @contract-shape:pure-function
// The pure core of install-subcommand as properties (layers 1 and 2 only: fast-check never reaches the CLI). The `HH:MM`
// language, the escaping of generated text, the plist's round trip of its schedule and paths, the wrapper's independence of
// every path outside its quoted words, the node choice, and `launchctl print` reading that never throws. Each is pinned against
// an oracle that shares no code with src/ (support/plist-oracle.mjs). Each property first calls the module, so the scaffold
// fails as RED. The one property that reaches a process (shellQuote read back by a real `sh`) runs 40 cases, not 100.
// Pinned shapes (DISTILL PINNED DECISIONS): `renderPlist` and `renderWrapper` take `{ root, home, nodePath, hour, minute }`;
// `pathsFor(root, home)` returns `{ plist, wrapper, outLog, errLog }`; `parseAt` refuses with `{ refusal: 'install.invalid-time' }`;
// `chooseNodePath` takes `{ path, realPath }` candidates; `readLaunchdPrint` returns `{ state, runs, lastExitCode, pid }` as text.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { spawnSync } from 'node:child_process';
import { holds } from '../sheets-api-target/support/property.mjs';
import { scenario } from './support/red-gate.mjs';
import { DEFAULT_AT, LABEL, chooseNodePath, parseAt, pathsFor, renderPlist, renderWrapper, shellQuote, xmlEscape } from '../../../src/core/launch-agent.mjs';
import { InstallRefusal } from '../../../src/core/install-plan.mjs';
import { readLaunchdPrint } from '../../../src/core/launchd-print.mjs';
import { AN_UNRECOGNISABLE_PRINT, aLaunchctlPrint, aPrintWithOnlyTheState } from './support/launchctl-print-sample.mjs';
import { VALID_TIME, maskQuotedWords, parsePlist, timeOf, unescapeXml } from './support/plist-oracle.mjs';
import { absolutePathArb, junkLineArb, nodeChoiceArb, printTextArb, specArb, specPairArb, timeTextArb } from './support/install-generators.mjs';

const OUR_LABEL = 'local.job-alert-harvester.update';
const hasNoControlCharacter = (text) => !/[\u0000-\u001f\u007f]/.test(text);
const FIELDS = ['state', 'runs', 'lastExitCode', 'pid'];

describe('@property the --at language is exactly HH:MM with HH 00 to 23 and MM 00 to 59', () => {
  it('every valid minute of the day reads as its hour and minute', () => {
    // Given the 1440 times of day, written as two digits, a colon, two digits
    // When each is read
    // Then each gives its hour and its minute
    for (let minuteOfDay = 0; minuteOfDay < 1440; minuteOfDay += 1) {
      expect(parseAt(timeOf(minuteOfDay)), timeOf(minuteOfDay)).toEqual({ hour: Math.floor(minuteOfDay / 60), minute: minuteOfDay % 60 });
    }
  });

  it('@property @error for any text, parseAt gives the hour and minute exactly when the text is HH:MM, and the install.invalid-time refusal otherwise, and never throws', () => {
    holds(
      fc.property(timeTextArb, (text) => {
        const reading = parseAt(text);
        const valid = VALID_TIME.exec(text);
        if (valid) expect(reading).toEqual({ hour: Number(valid[1]), minute: Number(valid[2]) });
        else expect(reading).toEqual({ refusal: InstallRefusal.INVALID_TIME });
      }),
      { numRuns: 500 },
    );
  });

  it('the default time is 05:30 and reads as 5 hours 30 minutes', () => {
    // Given the constant the plist and the how-to share
    // When it is read
    // Then it is 05:30, and the label is the one the how-to's generated job carries
    expect(DEFAULT_AT).toBe('05:30');
    expect(parseAt(DEFAULT_AT)).toEqual({ hour: 5, minute: 30 });
    expect(LABEL).toBe(OUR_LABEL);
  });
});

describe('@property the generated plist is well-formed and round-trips what it was given', () => {
  scenario('@property for any paths and any time the plist is well-formed property-list XML', () => {
    holds(fc.property(specArb, (spec) => void parsePlist(renderPlist(spec))));
  });

  scenario('@property the plist carries the label, the shell and wrapper, the checkout, both log files, and the hour and minute as integers', () => {
    holds(
      fc.property(specArb, (spec) => {
        const { value } = parsePlist(renderPlist(spec));
        const paths = pathsFor(spec.root, spec.home);
        expect(value.Label).toBe(OUR_LABEL);
        expect(value.ProgramArguments).toEqual(['/bin/sh', paths.wrapper]);
        expect(value.WorkingDirectory).toBe(spec.root);
        expect(value.StartCalendarInterval).toEqual({ Hour: spec.hour, Minute: spec.minute });
        expect(value.StandardOutPath).toBe(paths.outLog);
        expect(value.StandardErrorPath).toBe(paths.errLog);
      }),
    );
  });

  scenario('@property the plist holds exactly one comment, and it is the same text whatever the paths and the time', () => {
    holds(
      fc.property(specPairArb, ([left, right]) => {
        expect(parsePlist(renderPlist(left)).comments).toEqual(parsePlist(renderPlist(right)).comments);
      }),
    );
    expect(parsePlist(renderPlist({ root: '/r', home: '/h', nodePath: '/n', hour: 5, minute: 30 })).comments).toHaveLength(1);
  });

  scenario('a root holding every XML metacharacter and a quote survives, as a pinned example', () => {
    // Given a checkout whose path has an ampersand, angle brackets, both quotes, a dollar, a backtick and a backslash
    const root = '/Users/example/it\'s <a & b> "c" $d `e` \\f';
    // When the plist is rendered and read back
    const { value } = parsePlist(renderPlist({ root, home: '/Users/example', nodePath: '/opt/node/bin/node', hour: 5, minute: 30 }));
    // Then the working directory is that path, character for character
    expect(value.WorkingDirectory).toBe(root);
  });

  scenario('@property xmlEscape gives text a reader gets back unchanged, with no raw < and no & that starts no entity', () => {
    holds(
      fc.property(fc.oneof(absolutePathArb, fc.string({ unit: 'grapheme', maxLength: 30 }).filter(hasNoControlCharacter)), (text) => {
        expect(unescapeXml(xmlEscape(text))).toBe(text);
      }),
    );
  });
});

describe('@property shell quoting and the wrapper', () => {
  scenario('@property shellQuote gives one sh word that a real shell reads back as exactly the text', () => {
    holds(
      fc.property(fc.oneof(absolutePathArb, fc.string({ unit: 'grapheme', maxLength: 20 }).filter((text) => !text.includes('\0'))), (text) => {
        const run = spawnSync('/bin/sh', ['-c', `printf %s ${shellQuote(text)}`], { encoding: 'utf8' });
        expect(run.stdout).toBe(text);
      }),
      { numRuns: 40 },
    );
  });

  scenario('@property for any two sets of paths the wrapper is the same text once its single-quoted words are masked: no path character can reach the script outside quotes', () => {
    holds(
      fc.property(specPairArb, ([left, right]) => {
        expect(maskQuotedWords(renderWrapper(left))).toBe(maskQuotedWords(renderWrapper(right)));
      }),
    );
  });

  scenario('@property the wrapper embeds the checkout and the node path each as one shellQuote word', () => {
    holds(
      fc.property(specArb, (spec) => {
        const wrapper = renderWrapper(spec);
        expect(wrapper).toContain(shellQuote(spec.root));
        expect(wrapper).toContain(shellQuote(spec.nodePath));
      }),
    );
  });

  scenario('@property the wrapper and the plist are the same text every time for the same spec', () => {
    holds(
      fc.property(specArb, (spec) => {
        expect(renderWrapper(spec)).toBe(renderWrapper({ ...spec }));
        expect(renderPlist(spec)).toBe(renderPlist({ ...spec }));
      }),
    );
  });
});

describe('@property where the generated files go', () => {
  scenario('@property every path is derived from the checkout and the home directory, the same way for any of them', () => {
    holds(
      fc.property(absolutePathArb, absolutePathArb, (root, home) => {
        expect(pathsFor(root, home)).toEqual({
          plist: `${home}/Library/LaunchAgents/${OUR_LABEL}.plist`,
          wrapper: `${root}/.cache/launchd/update.sh`,
          outLog: `${root}/.cache/logs/update.out.log`,
          errLog: `${root}/.cache/logs/update.err.log`,
        });
      }),
    );
  });
});

describe('@property the node path chosen', () => {
  scenario('@property it is the first PATH entry whose real path is the running binary, else the running binary\'s own path', () => {
    holds(
      fc.property(nodeChoiceArb, ({ execPath, candidates }) => {
        const match = candidates.find((candidate) => candidate.realPath === execPath);
        expect(chooseNodePath(candidates, execPath)).toBe(match ? match.path : execPath);
      }),
    );
  });

  scenario('with no PATH entry at all the running binary is chosen', () => {
    expect(chooseNodePath([], '/opt/node/bin/node')).toBe('/opt/node/bin/node');
  });
});

describe('@property reading launchctl print', () => {
  for (const [what, indent] of [['eight spaces per level, as observed', '        '], ['a tab per level', '\t']]) {
    scenario(`the four fields are read from the sanitised real sample indented with ${what}, whatever the label and plist name are`, () => {
      // Given the sample for a job whose label is mixed case and differs from its plist's file name
      const text = aLaunchctlPrint({ label: 'Local.Example-Job.Update', plist: '/h/Library/LaunchAgents/other-name.plist', wrapper: '/h/bin/w.sh', root: '/r', state: 'not running', runs: 1, lastExitCode: 0, indent });
      // When it is read
      // Then the state, runs and last exit code are those printed, and there is no pid
      expect(readLaunchdPrint(text)).toEqual({ state: 'not running', runs: '1', lastExitCode: '0', pid: 'unknown' });
    });
  }

  scenario('@property for any text at all it never throws and gives exactly the four fields, each as text', () => {
    holds(
      fc.property(printTextArb, (text) => {
        const reading = readLaunchdPrint(text);
        expect(Object.keys(reading).sort()).toEqual([...FIELDS].sort());
        for (const field of FIELDS) expect(typeof reading[field], field).toBe('string');
      }),
      { numRuns: 300 },
    );
  });

  scenario('@property lines that hold no = change nothing: junk between the sample\'s lines leaves what is read as it was', () => {
    const sample = aLaunchctlPrint({ label: OUR_LABEL, plist: '/p', wrapper: '/w', root: '/r', state: 'not running', runs: 3, lastExitCode: 78 });
    holds(
      fc.property(fc.array(fc.tuple(fc.nat(30), junkLineArb), { maxLength: 8 }), (insertions) => {
        const lines = sample.split('\n');
        for (const [at, junk] of insertions) lines.splice(at % (lines.length + 1), 0, junk);
        expect(readLaunchdPrint(lines.join('\n'))).toEqual(readLaunchdPrint(sample));
      }),
    );
  });

  scenario('@unconfirmed-format the four fields are read as printed, for a running job with a pid (the running state text and the pid line are not in the real sample)', () => {
    // Given the guessed format, for a job that is running as process 4321 with a failed last run
    const text = aLaunchctlPrint({ label: OUR_LABEL, plist: '/p', wrapper: '/w', root: '/r', state: 'running', runs: 7, lastExitCode: 78, pid: 4321 });
    // When it is read
    // Then each field is the text after its equals sign
    expect(readLaunchdPrint(text)).toEqual({ state: 'running', runs: '7', lastExitCode: '78', pid: '4321' });
  });

  scenario('@error a field that is absent reads as unknown: no pid when the job is not running', () => {
    // Given the guessed format for a job that is not running
    const text = aLaunchctlPrint({ label: OUR_LABEL, plist: '/p', wrapper: '/w', root: '/r', state: 'not running', runs: 0, lastExitCode: 0 });
    // When it is read
    // Then the pid is unknown and the rest are as printed
    expect(readLaunchdPrint(text)).toEqual({ state: 'not running', runs: '0', lastExitCode: '0', pid: 'unknown' });
  });

  scenario('@error text with no recognised field reads as four unknowns, and so does no text at all', () => {
    const allUnknown = { state: 'unknown', runs: 'unknown', lastExitCode: 'unknown', pid: 'unknown' };
    expect(readLaunchdPrint(AN_UNRECOGNISABLE_PRINT)).toEqual(allUnknown);
    expect(readLaunchdPrint('')).toEqual(allUnknown);
  });

  scenario('@error a format that kept only the state line reads that and three unknowns', () => {
    expect(readLaunchdPrint(aPrintWithOnlyTheState('running'))).toEqual({ state: 'running', runs: 'unknown', lastExitCode: 'unknown', pid: 'unknown' });
  });
});
