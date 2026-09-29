// PURE. RED scaffold (DISTILL): plan + resolution -> one spreadsheets.batchUpdate body, and the request classifier.
// Only the five allow-listed request types are constructable: no delete, clear or sort request exists here.
export const __SCAFFOLD__ = true;

export const ALLOWED_REQUEST_TYPES = Object.freeze(['updateCells', 'appendCells', 'appendDimension', 'addSheet', 'createDeveloperMetadata']);

export const RequestClass = Object.freeze({ READ: 'read', WRITE: 'write' });

/** Bytes; the real ceiling is unmeasured (API assumption A6). */
export const MAX_BATCH_BYTES = 10 * 1024 * 1024;

export const ROW_KEY_VISIBILITY = 'DOCUMENT';

const scaffold = (name) => {
  throw new Error(`RED scaffold: ${name} is not implemented`);
};

/** @returns {'read'|'write'} decided by method and path; anything unrecognised is a write. */
export const classifyRequest = ({ method, url }) => scaffold('classifyRequest');

/**
 * Drops appends whose key is already in the fresh key column and updates whose cell already holds the planned value.
 * @returns {{ plans: object[], appendsSkippedAsPresent: number }}
 */
export const settlePlans = ({ plans, resolution }) => scaffold('settlePlans');

/** @returns {{ requests: object[] }} one body for every tab; refuses `sheets.header-changed` */
export const buildApplyBody = ({ plans, resolution }) => scaffold('buildApplyBody');

/** @param {{ sheetId: number, rowIndex: number, key: string }[]} bindings @returns {{ requests: object[] }} */
export const buildMetadataBody = ({ bindings }) => scaffold('buildMetadataBody');

/** Throws `sheets.plan-too-large` when the serialised body exceeds maxBytes. */
export const assertWithinLimit = (body, { maxBytes }) => scaffold('assertWithinLimit');
