// Driven adapter: reads saved alert emails off the real filesystem.
// One JSON file per message: { id, date, sender, subject, snippet, plaintextBody }.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readMessages(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(directory, name), 'utf8')));
}
