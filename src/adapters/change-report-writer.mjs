// Driven adapter: writes the `--report <file>` detail (DR-0004 rule 4).
// I/O only -- the lines it writes are already formatted by core/changes.mjs.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function writeChangeReport(path, lines) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
}
