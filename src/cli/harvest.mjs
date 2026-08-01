#!/usr/bin/env node
// Driving adapter (composition root):
//   node src/cli/harvest.mjs --in <dir> --out <file.xlsx>

import { readMessages } from '../adapters/fixture-message-reader.mjs';
import { writeWorkbook } from '../adapters/xlsx-workbook-writer.mjs';
import { harvest } from '../core/harvest.mjs';

function parseArguments(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === '--in') options.input = argv[i + 1];
    if (argv[i] === '--out') options.output = argv[i + 1];
  }
  return options;
}

const { input, output } = parseArguments(process.argv.slice(2));
if (!input || !output) {
  console.error('usage: harvest.mjs --in <dir> --out <file.xlsx>');
  process.exit(2);
}

const messages = readMessages(input);
const model = harvest(messages);
writeWorkbook(output, model);

console.log(
  `harvested ${messages.length} messages -> ${model.jobs.rows.length} jobs, ` +
    `${model.companies.rows.length} companies, ${model.sources.rows.length} saved searches`,
);
console.log(`wrote ${output}`);
