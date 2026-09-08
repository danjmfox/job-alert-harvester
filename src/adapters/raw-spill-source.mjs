// Driven adapter: globs and parses the connector's spill directory (DR-0003).
// The agent never opens a spill file, quotes one, or summarises one — it passes
// a path and three control values, each of which is verified against the data.
//
// Every plausible drift lands on "nothing ingested", never on "partially
// ingested". The count check exists precisely to convert a partial into a refusal.
//
// RED scaffold — created by DISTILL.

export const __SCAFFOLD__ = true;

const notImplemented = (name) => {
  throw new Error(`${name}: Not yet implemented — RED scaffold`);
};

export const SpillRefusal = Object.freeze({
  DIRECTORY_ABSENT: 'spill.directory-absent',
  COUNT_MISMATCH: 'spill.count-mismatch',
  NOT_JSON: 'spill.not-json',
  MISSING_BODY: 'spill.missing-plaintext-body',
  OUTSIDE_WINDOW: 'spill.outside-window',
});

/** @returns {{ list: Function, read: Function, probe: Function }} */
export function createRawSpillSource(_spillDirectory) {
  return {
    list: (_window) => notImplemented('rawSpillSource.list'),
    read: (_id) => notImplemented('rawSpillSource.read'),
    probe: () => notImplemented('rawSpillSource.probe'),
  };
}
