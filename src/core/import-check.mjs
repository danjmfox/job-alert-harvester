// PURE. RED scaffold (DISTILL): the verdict on a workbook before import, and on the converted Sheet after.
export const __SCAFFOLD__ = true;

const scaffold = (name) => {
  throw new Error(`RED scaffold: ${name} is not implemented`);
};

/** @param {{ tabs: Record<string, { columns: string[], rows: object[] }> }} workbookState @returns {undefined} or throws an ImportRefusal */
export const checkWorkbook = (workbookState) => scaffold('checkWorkbook');

/** @returns {undefined} or throws `import.conversion-mismatch` when tabs, headers, row counts or key sets differ */
export const checkConversion = ({ workbookState, convertedState }) => scaffold('checkConversion');
