// Driven adapter: globs and parses the connector's spill directory (DR-0003).
// The agent never opens a spill file, quotes one, or summarises one — it passes
// a path and three control values, each of which is verified against the data.
//
// Every plausible drift lands on "nothing ingested", never on "partially
// ingested". The count check exists precisely to convert a partial into a refusal.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SpillRefusal = Object.freeze({
  DIRECTORY_ABSENT: 'spill.directory-absent',
  COUNT_MISMATCH: 'spill.count-mismatch',
  NOT_JSON: 'spill.not-json',
  NOT_A_MESSAGE: 'spill.not-a-message',
  MISSING_BODY: 'spill.missing-plaintext-body',
  OUTSIDE_WINDOW: 'spill.outside-window',
});

/** The harness's own spill naming (DR-0007): mcp-<connector-id>-get_message-<epoch-ms>.txt.
 * The connector id is a wildcard, never hard-coded — every other file in a shared
 * directory (unrelated tool output) is ignored and never counted. */
const SPILL_FILE_PATTERN = /^mcp-.+-get_message-\d+\.txt$/;

const refuse = (code, detail) => {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  throw error;
};

const listSpillFileNames = (spillDirectory) => {
  if (!existsSync(spillDirectory)) return [];
  return readdirSync(spillDirectory)
    .filter((name) => SPILL_FILE_PATTERN.test(name))
    .sort();
};

const parseSpillFile = (spillDirectory, fileName) => {
  const raw = readFileSync(join(spillDirectory, fileName), 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return refuse(SpillRefusal.NOT_JSON, fileName);
  }
};

const hasMessageEnvelope = (payload) =>
  payload !== null &&
  typeof payload === 'object' &&
  typeof payload.id === 'string' &&
  typeof payload.date === 'string' &&
  typeof payload.sender === 'string';

const hasPlaintextBody = (payload) => typeof payload.plaintextBody === 'string' && payload.plaintextBody.length > 0;

/** Structural validity only — semantic truncation is core/slim.mjs's concern, not this adapter's.
 * The candidate file's JSON IS the message (DR-0007) — no wrapper to unwrap. */
const validateMessage = (payload, fileName) => {
  if (!hasMessageEnvelope(payload)) return refuse(SpillRefusal.NOT_A_MESSAGE, fileName);
  if (!hasPlaintextBody(payload)) return refuse(SpillRefusal.MISSING_BODY, fileName);
  return payload;
};

const readValidatedEntry = (spillDirectory, fileName) => {
  const payload = parseSpillFile(spillDirectory, fileName);
  const message = validateMessage(payload, fileName);
  return { fileName, message };
};

const fallsWithinWindow = (isoDate, window) => {
  const day = isoDate.slice(0, 10);
  return day >= window.from && day <= window.to;
};

const assertWithinWindow = (message, window, fileName) => {
  if (!fallsWithinWindow(message.date, window)) {
    refuse(SpillRefusal.OUTSIDE_WINDOW, fileName);
  }
};

/** @returns {{ list: Function, read: Function, probe: Function }} */
export function createRawSpillSource(spillDirectory) {
  /** Every spilled message inside `window`, keyed by the id found inside its own payload (DR-0003 Rule 2). Refuses — naming the file — on the first structurally invalid or out-of-window entry; never skips one. */
  const list = (window) =>
    listSpillFileNames(spillDirectory).map((fileName) => {
      const { message } = readValidatedEntry(spillDirectory, fileName);
      assertWithinWindow(message, window, fileName);
      return { id: message.id, date: message.date };
    });

  /** The raw spill payload for a given id — never looked up by filename. Null when no file carries that id. */
  const read = (id) => {
    for (const fileName of listSpillFileNames(spillDirectory)) {
      const { message } = readValidatedEntry(spillDirectory, fileName);
      if (message.id === id) return message;
    }
    return null;
  };

  /** Pre-flight: directory must exist, and its file count must match `expectedCount` when given. A wrong count fails closed rather than proceeding on a partial batch. */
  const probe = (expectedCount) => {
    if (!existsSync(spillDirectory)) refuse(SpillRefusal.DIRECTORY_ABSENT);
    const fileCount = listSpillFileNames(spillDirectory).length;
    if (expectedCount !== undefined && fileCount !== expectedCount) {
      refuse(SpillRefusal.COUNT_MISMATCH, `expected ${expectedCount}, found ${fileCount}`);
    }
    return { fileCount };
  };

  return { list, read, probe };
}
