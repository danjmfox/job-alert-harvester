// fast-check generators for the pure layer (layers 1 and 2): hostile absolute paths, specs for the generated files, near-miss
// and arbitrary `--at` text, arbitrary `launchctl print` text, and node-path candidates. A path is absolute, holds no control
// character and no NUL (the DESIGN refuses those as `install.unsafe-path`), and otherwise draws from an alphabet of everything
// that breaks quoting.
import fc from 'fast-check';
import { timeOf } from './plist-oracle.mjs';

const SEGMENT_CHARACTERS = [...`abcXYZ019 _-.'"\\&<>$\`;|*?(){}[]!~#%@=+,:é日🙂`];
export const segmentArb = fc.string({ unit: fc.constantFrom(...SEGMENT_CHARACTERS), minLength: 1, maxLength: 12 }).filter((segment) => segment !== '.' && segment !== '..');
/** `/a/b c/it's`: one to five segments under the root. */
export const absolutePathArb = fc.array(segmentArb, { minLength: 1, maxLength: 5 }).map((segments) => `/${segments.join('/')}`);
export const hourArb = fc.integer({ min: 0, max: 23 });
export const minuteArb = fc.integer({ min: 0, max: 59 });
/** What `renderPlist` and `renderWrapper` are handed. */
export const specArb = fc.record({ root: absolutePathArb, home: absolutePathArb, nodePath: absolutePathArb, hour: hourArb, minute: minuteArb });
/** Two specs that differ in every path and nothing else. */
export const specPairArb = fc.tuple(specArb, absolutePathArb, absolutePathArb, absolutePathArb).map(([spec, root, home, nodePath]) => [spec, { ...spec, root, home, nodePath }]);

/** Any string at all, including unpaired surrogates and control characters. */
export const anyTextArb = fc.string({ unit: 'binary', maxLength: 60 });
export const validTimeArb = fc.integer({ min: 0, max: 1439 }).map(timeOf);
/** A valid time with one character changed, inserted or dropped: the near misses a lenient parser accepts. */
export const nearMissTimeArb = fc
  .tuple(validTimeArb, fc.integer({ min: 0, max: 5 }), fc.constantFrom('', ' ', ':', '0', '9', '-', '+', 'a', '٣', '\n', '\u0000'), fc.constantFrom('replace', 'insert', 'drop'))
  .map(([time, at, character, how]) => (how === 'replace' ? time.slice(0, at) + character + time.slice(at + 1) : how === 'insert' ? time.slice(0, at) + character + time.slice(at) : time.slice(0, at) + time.slice(at + 1)));
export const timeTextArb = fc.oneof({ weight: 2, arbitrary: validTimeArb }, { weight: 3, arbitrary: nearMissTimeArb }, { weight: 1, arbitrary: anyTextArb });

const fieldLineArb = fc.tuple(fc.constantFrom('state', 'runs', 'last exit code', 'pid', 'path', 'type', 'program'), fc.string({ maxLength: 20 })).map(([key, value]) => `\t${key} = ${value}`);
/** Text that might or might not be `launchctl print` output: arbitrary text, or lines shaped like its fields with arbitrary values. */
export const printTextArb = fc.oneof(anyTextArb, fc.array(fc.oneof(fieldLineArb, fc.string({ maxLength: 20 })), { maxLength: 12 }).map((lines) => lines.join('\n')));
/** Lines that are not `key = value` lines of any field the reader parses. */
export const junkLineArb = fc.string({ maxLength: 30 }).filter((line) => !line.includes('=') && !line.includes('\n') && !line.includes('\r'));

/** `PATH` entries holding a node: each has the path it was found at and where that really points; some point at the running binary. */
export const nodeChoiceArb = fc.tuple(absolutePathArb, fc.array(fc.tuple(absolutePathArb, fc.boolean(), absolutePathArb), { maxLength: 6 })).map(([execPath, entries]) => ({
  execPath,
  candidates: entries.map(([path, pointsAtRunningBinary, realPath]) => ({ path, realPath: pointsAtRunningBinary ? execPath : realPath })),
}));
