// Driven adapter: reads a workbook and executes a WritePlan (DR-0005).
// Absorbs xlsx-workbook-writer.mjs as its create-new branch.
// Bounded change universe: the target path and its sibling temp file.
//
// The dangerous probe: a Jobs tab with no Dedup Key column must refuse, because
// merging without a key appends every job as new and doubles the sheet.
//
// RED scaffold — created by DISTILL.

export const __SCAFFOLD__ = true;

const notImplemented = (name) => {
  throw new Error(`${name}: Not yet implemented — RED scaffold`);
};

export const TargetRefusal = Object.freeze({
  NOT_A_WORKBOOK: 'target.not-a-workbook',
  NO_DEDUP_KEY_COLUMN: 'target.no-dedup-key-column',
  NOT_WRITABLE: 'target.not-writable',
});

/** @returns {{ read: Function, apply: Function, probe: Function }} */
export function createTargetSheet(_targetPath) {
  return {
    read: () => notImplemented('targetSheet.read'),
    apply: (_plan) => notImplemented('targetSheet.apply'),
    probe: () => notImplemented('targetSheet.probe'),
  };
}
