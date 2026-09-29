// Driven adapter. RED scaffold (DISTILL): TargetSheet over a harvester-created native Sheet (DR-0012).
// The reader has probe and read only; the writer adds apply. Neither imports a node: module or global fetch:
// they receive a transport, an endpoint table, sleep and jitter.
export const __SCAFFOLD__ = true;

const scaffold = (name) => {
  throw new Error(`RED scaffold: ${name} is not implemented`);
};

/**
 * @param {{ store: object, tokenSource: object, transport: { read: object }, endpoints: object,
 *           spreadsheetId?: string, sleep: Function, jitter: () => number }} options
 *   spreadsheetId, when given, overrides the recorded id (import verifies a Sheet before recording it).
 * @returns {{ probe: Function, read: Function }}
 */
export function createSheetsTargetReader(options) {
  return { probe: () => scaffold('reader.probe'), read: () => scaffold('reader.read') };
}

/**
 * @param {{ store: object, tokenSource: object, transport: { read: object, write: object }, endpoints: object,
 *           spreadsheetId?: string, sleep: Function, jitter: () => number, maxBatchBytes?: number }} options
 * @returns {{ probe: Function, read: Function, apply: Function, bindRowKeys: Function }}
 *   apply(plans) resolves { appliedAt, cellsWritten, inputDigest: null, outputDigest: null, appendsSkippedAsPresent, metadataPending, warnings }.
 *   bindRowKeys() resolves { bound, pending }: searches first, binds only keyed rows lacking metadata, in chunks.
 */
export function createSheetsTargetWriter(options) {
  return {
    probe: () => scaffold('writer.probe'),
    read: () => scaffold('writer.read'),
    apply: () => scaffold('writer.apply'),
    bindRowKeys: () => scaffold('writer.bindRowKeys'),
  };
}
