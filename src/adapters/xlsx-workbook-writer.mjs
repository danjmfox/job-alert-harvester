// Driven adapter: writes the workbook model to a real .xlsx on disk.
// Tab order is significant — Sources, Companies, Jobs.

import * as XLSX from 'xlsx';

function appendTab(book, name, { columns, rows }) {
  const sheet = XLSX.utils.json_to_sheet(rows, { header: columns });
  XLSX.utils.book_append_sheet(book, sheet, name);
}

export function writeWorkbook(outputPath, model) {
  const book = XLSX.utils.book_new();
  appendTab(book, 'Sources', model.sources);
  appendTab(book, 'Companies', model.companies);
  appendTab(book, 'Jobs', model.jobs);
  XLSX.writeFile(book, outputPath, { compression: true });
}
