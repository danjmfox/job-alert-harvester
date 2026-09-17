// Driven adapter: reads a workbook and executes a WritePlan (DR-0005).
// Absorbs xlsx-workbook-writer.mjs as its create-new branch.
// Bounded change universe: the target path and its sibling temp file.
//
// The dangerous probe: a Jobs tab with no Dedup Key column must refuse, because
// merging without a key appends every job as new and doubles the sheet.

import {
  existsSync,
  readFileSync,
  accessSync,
  constants,
  openSync,
  closeSync,
  writeFileSync,
  fsyncSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { KEY_COLUMN } from '../core/merge.mjs';

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

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

/** Sibling-temp-file, fsync, rename — a crash mid-write leaves the previous
 *  target intact. On any failure the temp file is removed and the original
 *  error re-thrown unchanged (DR-0005). */
function writeAtomically(targetPath, buffer) {
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  let fd;
  try {
    fd = openSync(tempPath, 'w');
    writeFileSync(fd, buffer);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tempPath, targetPath);
  } catch (error) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // best-effort
      }
    }
    if (existsSync(tempPath)) {
      try {
        unlinkSync(tempPath);
      } catch {
        // best-effort
      }
    }
    throw error;
  }
}

const cellTypeOf = (value) => {
  if (typeof value === 'number') return 'n';
  if (typeof value === 'boolean') return 'b';
  return 's';
};

/** Overwrites t/v, keeps other cell properties (z, s), drops stale formatted
 *  text (w). A null value blanks the cell (DR-0004 overwrite semantics). */
function writeCell(sheet, address, value) {
  if (value === null || value === undefined) {
    delete sheet[address];
    return;
  }
  const { w: _staleFormattedText, ...rest } = sheet[address] ?? {};
  sheet[address] = { ...rest, t: cellTypeOf(value), v: value };
}

function headerMapOf(sheet, range) {
  const map = new Map();
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: column })];
    if (cell?.v !== undefined && cell.v !== null && cell.v !== '') map.set(String(cell.v), column);
  }
  return map;
}

/** Scans the key column's actual cells (never sheet_to_json indexes, which
 *  skip blank rows and drift from real sheet positions). Blank keys are
 *  skipped — DR-0004 rule 2, never match a blank key. */
function rowIndexByKey(sheet, range, headerRow, keyColumn) {
  const map = new Map();
  for (let row = headerRow + 1; row <= range.e.r; row += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: keyColumn })];
    if (cell?.v === undefined || cell.v === null || cell.v === '') continue;
    map.set(String(cell.v), row);
  }
  return map;
}

/** Lays the plan on top of the existing worksheet, in place. Returns the
 *  count of cells actually written. */
function applyPlanToSheet(sheet, plan) {
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const headerRow = range.s.r;
  const headerMap = headerMapOf(sheet, range);

  let nextColumn = range.e.c + 1;
  for (const name of plan.appendColumns) {
    sheet[XLSX.utils.encode_cell({ r: headerRow, c: nextColumn })] = { t: 's', v: name };
    headerMap.set(name, nextColumn);
    nextColumn += 1;
  }

  const keyColumn = headerMap.get(KEY_COLUMN);
  if (keyColumn === undefined) refuse(TargetRefusal.NO_DEDUP_KEY_COLUMN);
  const keyToRow = rowIndexByKey(sheet, range, headerRow, keyColumn);

  let cellsWritten = 0;
  for (const update of plan.updates) {
    const row = keyToRow.get(update.key);
    if (row === undefined) continue; // key vanished between plan and apply -- skip rather than corrupt
    for (const [column, value] of Object.entries(update.cells)) {
      const columnIndex = headerMap.get(column);
      if (columnIndex === undefined) continue;
      writeCell(sheet, XLSX.utils.encode_cell({ r: row, c: columnIndex }), value);
      cellsWritten += 1;
    }
  }

  let nextRow = range.e.r + 1;
  for (const appendRow of plan.appends) {
    for (const [column, value] of Object.entries(appendRow)) {
      const columnIndex = headerMap.get(column);
      if (columnIndex === undefined) continue; // appends only fill columns already in the header
      if (value === null || value === undefined) continue; // no cell created for a null value
      writeCell(sheet, XLSX.utils.encode_cell({ r: nextRow, c: columnIndex }), value);
      cellsWritten += 1;
    }
    nextRow += 1;
  }

  sheet['!ref'] = XLSX.utils.encode_range({
    s: { r: headerRow, c: range.s.c },
    e: { r: Math.max(range.e.r, nextRow - 1), c: Math.max(range.e.c, nextColumn - 1) },
  });

  return cellsWritten;
}

function apply(targetPath, plan) {
  const exists = existsSync(targetPath);
  const originalBuffer = exists ? readFileSync(targetPath) : null;
  const inputDigest = originalBuffer ? sha256(originalBuffer) : null;
  // cellNF: true is load-bearing — without it a human-typed date's number
  // format is dropped on read and cannot be carried through the edit.
  const book = originalBuffer ? XLSX.read(originalBuffer, { cellNF: true }) : XLSX.utils.book_new();

  if (!book.Sheets[plan.tab]) {
    book.Sheets[plan.tab] = XLSX.utils.aoa_to_sheet([[]]);
    book.SheetNames.push(plan.tab);
  }

  // Every other sheet in book.Sheets is left exactly as the parsed object —
  // only the plan's own tab is edited in place.
  const cellsWritten = applyPlanToSheet(book.Sheets[plan.tab], plan);
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  writeAtomically(targetPath, buffer);

  return { appliedAt: new Date().toISOString(), cellsWritten, inputDigest, outputDigest: sha256(buffer) };
}

function appendModelTab(book, name, { columns, rows }) {
  const sheet = XLSX.utils.json_to_sheet(rows, { header: columns });
  XLSX.utils.book_append_sheet(book, sheet, name);
}

/** Create-new path (DR-0005): no existing target, no merge. Retains the
 *  three-tab shape of xlsx-workbook-writer.mjs, through the same atomic writer. */
function create(targetPath, model) {
  const book = XLSX.utils.book_new();
  appendModelTab(book, 'Sources', model.sources);
  appendModelTab(book, 'Companies', model.companies);
  appendModelTab(book, 'Jobs', model.jobs);
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  writeAtomically(targetPath, buffer);

  const cellsWritten = model.sources.rows.length + model.companies.rows.length + model.jobs.rows.length;
  return { appliedAt: new Date().toISOString(), cellsWritten, inputDigest: null, outputDigest: sha256(buffer) };
}

/** @returns {{ read: Function, apply: Function, probe: Function, create: Function }} */
export function createTargetSheet(targetPath) {
  return {
    read: () => read(targetPath),
    apply: (plan) => apply(targetPath, plan),
    probe: () => probe(targetPath),
    create: (model) => create(targetPath, model),
  };
}
