// Driven adapter: reads a workbook and executes a WritePlan (DR-0005).
// Absorbs xlsx-workbook-writer.mjs as its create-new branch.
// Bounded change universe: the target path and its sibling temp file.
//
// The dangerous probe: a Jobs tab with no Dedup Key column must refuse, because
// merging without a key appends every job as new and doubles the sheet.

import { existsSync, readFileSync, accessSync, constants } from 'node:fs';
import { dirname } from 'node:path';
import * as XLSX from 'xlsx';
import { KEY_COLUMN } from '../core/merge.mjs';

// apply() has no acceptance test pinning it yet — stays a RED scaffold.
export const __SCAFFOLD__ = Object.freeze({ apply: true });

const notImplemented = (name) => {
  throw new Error(`${name}: Not yet implemented — RED scaffold`);
};

const JOBS_TAB = 'Jobs';

// The first four bytes of a real .xlsx (zip) file. SheetJS parses plain text
// as a one-cell workbook with no error, so a successful XLSX.read() does not
// mean "this is a workbook" — the zip signature is what actually tells us.
const XLSX_ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export const TargetRefusal = Object.freeze({
  NOT_A_WORKBOOK: 'target.not-a-workbook',
  NO_DEDUP_KEY_COLUMN: 'target.no-dedup-key-column',
  NOT_WRITABLE: 'target.not-writable',
});

const refuse = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};

const isXlsxSignature = (buffer) => buffer.length >= 4 && buffer.subarray(0, 4).equals(XLSX_ZIP_SIGNATURE);

const headerRowOf = (sheet) => XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] ?? [];

const assertDirectoryWritable = (targetPath) => {
  try {
    accessSync(dirname(targetPath), constants.W_OK);
  } catch {
    refuse(TargetRefusal.NOT_WRITABLE);
  }
};

const assertJobsTabHasDedupKeyColumn = (book) => {
  const jobsSheet = book.Sheets[JOBS_TAB];
  const columns = jobsSheet ? headerRowOf(jobsSheet) : [];
  if (!columns.includes(KEY_COLUMN)) refuse(TargetRefusal.NO_DEDUP_KEY_COLUMN);
};

function readWorkbook(targetPath) {
  const buffer = readFileSync(targetPath);
  if (!isXlsxSignature(buffer)) refuse(TargetRefusal.NOT_A_WORKBOOK);
  return XLSX.read(buffer);
}

function probe(targetPath) {
  // Refuse before any read work — an unwritable directory is checked first,
  // independent of whether a target file exists yet (DR-0005).
  assertDirectoryWritable(targetPath);
  if (!existsSync(targetPath)) return; // absent target: valid create-new
  const book = readWorkbook(targetPath);
  assertJobsTabHasDedupKeyColumn(book);
}

function read(targetPath) {
  const book = readWorkbook(targetPath);
  const tabs = {};
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    tabs[name] = {
      columns: headerRowOf(sheet),
      rows: XLSX.utils.sheet_to_json(sheet, { defval: null }),
    };
  }
  return { tabs };
}

/** @returns {{ read: Function, apply: Function, probe: Function }} */
export function createTargetSheet(targetPath) {
  return {
    read: () => read(targetPath),
    apply: (_plan) => notImplemented('targetSheet.apply'),
    probe: () => probe(targetPath),
  };
}
