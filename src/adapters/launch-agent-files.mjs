// Driven adapter: the launch agent's two generated files. Bounded change universe: the plist, the wrapper, their `.tmp` siblings,
// the directories that hold them, and the `.probe` files the probe makes and removes inside those directories.
import { accessSync, chmodSync, constants, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { InstallRefusal } from '../core/install-plan.mjs';

const PROBE_NAME = '.probe';
const PROBE_RENAMED_NAME = '.probe.renamed';

const refuse = (code, detail) => {
  throw Object.assign(new Error(`${code}: ${detail}`), { code });
};

const readText = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

const modifiedTime = (path) => statSync(path).mtime.toISOString();

const isExecutable = (path) => {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const realPath = (path) => realpathSync(path);

const makeDirectory = (path) => {
  mkdirSync(path, { recursive: true });
};

/** The temporary file is a sibling of the target, so the rename never crosses a volume. */
const writeAtomically = (path, text, mode) => {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, text, { mode });
  chmodSync(temporary, mode);
  renameSync(temporary, path);
};

const remove = (path) => {
  rmSync(path, { force: true });
};

const probeDirectory = (directory) => {
  const first = join(directory, PROBE_NAME);
  const second = join(directory, PROBE_RENAMED_NAME);
  try {
    makeDirectory(directory);
    writeFileSync(first, '');
    renameSync(first, second);
    rmSync(second);
  } catch (error) {
    rmSync(first, { force: true });
    rmSync(second, { force: true });
    refuse(InstallRefusal.NOT_WRITABLE, `${directory} (${error.code ?? error.message})`);
  }
};

/** @returns {{ reader: { readText, modifiedTime, isExecutable, realPath }, writer: { probe, makeDirectory, write, remove } }} observation and change kept apart */
export function createLaunchAgentFiles() {
  return {
    reader: Object.freeze({ readText, modifiedTime, isExecutable, realPath }),
    writer: Object.freeze({
      probe: (directories) => directories.forEach(probeDirectory),
      makeDirectory,
      write: writeAtomically,
      remove,
    }),
  };
}
