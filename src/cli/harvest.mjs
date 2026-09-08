#!/usr/bin/env node
// Driving adapter (composition root):
//   node src/cli/harvest.mjs --in <dir> --out <file.xlsx>          rebuild from a directory
//   node src/cli/harvest.mjs plan-fetch --source <id> --from <d> --to <d> --batch <n>
//   node src/cli/harvest.mjs ingest --raw <dir> --window <a>..<b> --expect <n> [--complete]
//   node src/cli/harvest.mjs build --out <f> [--merge <f>] [--dry-run] [--report <f>]
//
// Subcommands resolve the cache and the ledger under .cache/ relative to the
// working directory. Wire, then probe, then use: a failed probe refuses to start.

import { readMessages } from '../adapters/fixture-message-reader.mjs';
import { writeWorkbook } from '../adapters/xlsx-workbook-writer.mjs';
import { harvest } from '../core/harvest.mjs';

// RED scaffolds — wired here so the composition root's imports are real.
import { createLedgerStore } from '../adapters/ledger-store.mjs';
import { createMessageCache } from '../adapters/message-cache.mjs';
import { createRawSpillSource } from '../adapters/raw-spill-source.mjs';
import { createTargetSheet } from '../adapters/xlsx-target-sheet.mjs';

export const __SCAFFOLD__ = true;

const SUBCOMMANDS = ['plan-fetch', 'ingest', 'build'];

function parseArguments(argv) {
  const options = { flags: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      options.flags.add(token.slice(2));
      continue;
    }
    options[token.slice(2)] = next;
    i += 1;
  }
  return options;
}

function runSubcommand(name, _options) {
  // Composition root: wire -> probe -> use. Every port below is a RED scaffold.
  createLedgerStore('.cache/coverage.json');
  createMessageCache('.cache/messages');
  createRawSpillSource('.');
  createTargetSheet('.');
  throw new Error(`harvest ${name}: Not yet implemented — RED scaffold`);
}

const argv = process.argv.slice(2);

if (SUBCOMMANDS.includes(argv[0])) {
  try {
    runSubcommand(argv[0], parseArguments(argv.slice(1)));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
} else {
  const { in: input, out: output } = parseArguments(argv);
  if (!input || !output) {
    console.error(
      'usage: harvest.mjs --in <dir> --out <file.xlsx>\n' + `       harvest.mjs <${SUBCOMMANDS.join('|')}> [options]`,
    );
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
}
