// PURE. Decides whether a merge target looks like our own last output
// (DR-0005). Equality between the target's current digest and the most
// recent receipt's own outputDigest is the signal -- Google Sheets re-encodes
// a workbook on download, so a genuine upload-then-download cycle never
// reproduces our bytes.

export const Freshness = Object.freeze({
  FIRST_RUN: 'first-run',
  STALE: 'stale',
  FRESH: 'fresh',
});

const mostRecentOf = (receipts) =>
  receipts.reduce((latest, receipt) => (receipt.appliedAt > latest.appliedAt ? receipt : latest));

/**
 * @param {string} targetPath resolved path of the merge target
 * @param {string} currentDigest sha256 of the target's bytes as they are now, before any write
 * @param {Array<{ targetPath: string, outputDigest: string, appliedAt: string }>} receipts every receipt on record
 * @returns {typeof Freshness[keyof typeof Freshness]}
 */
export function evaluateFreshness(targetPath, currentDigest, receipts) {
  const priorReceipts = receipts.filter((receipt) => receipt.targetPath === targetPath);
  if (priorReceipts.length === 0) return Freshness.FIRST_RUN;

  const mostRecent = mostRecentOf(priorReceipts);
  return currentDigest === mostRecent.outputDigest ? Freshness.STALE : Freshness.FRESH;
}
