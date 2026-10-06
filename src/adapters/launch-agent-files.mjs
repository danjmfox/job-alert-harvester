// Driven adapter: the launch agent's two generated files. Bounded change universe: the plist, the wrapper, their `.tmp` siblings,
// the directories that hold them, and the `.probe` files the probe makes and removes inside those directories.
import { accessSync, chmodSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { InstallRefusal } from '../core/install-refusal.mjs';

const PROBE_NAME = '.probe';
const PROBE_RENAMED_NAME = '.probe.renamed';

const refuse = (code, detail) => {
  throw Object.assign(new Error(`${code}: ${detail}`), { code });
};

const readText = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
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

const nearestExistingAncestor = (path) => {
  try {
    return statSync(path).isDirectory() ? path : null;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return nearestExistingAncestor(dirname(path));
  }
};

const removeQuietly = (path) => {
  try {
    rmSync(path, { force: true });
  } catch {
    // the path sits under something that is not a directory, so nothing of ours can be there
  }
};

/** A folder that exists is tried with a file that is renamed and removed; one that does not is judged by its nearest existing ancestor, and nothing is created. */
const probeDirectory = (directory) => {
  const first = join(directory, PROBE_NAME);
  const second = join(directory, PROBE_RENAMED_NAME);
  try {
    if (!existsSync(directory)) {
      const ancestor = nearestExistingAncestor(directory);
      if (ancestor === null) throw Object.assign(new Error('not a directory'), { code: 'ENOTDIR' });
      accessSync(ancestor, constants.W_OK | constants.X_OK);
      return;
    }
    writeFileSync(first, '');
    renameSync(first, second);
    rmSync(second);
  } catch (error) {
    removeQuietly(first);
    removeQuietly(second);
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
