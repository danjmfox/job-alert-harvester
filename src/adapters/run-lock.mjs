// Driven adapter: the run lock (DR-0016 decision 8), an exclusive-create file holding the pid of the running process.
// Bounded change universe: the one file at `lockPath` and the sibling `<lockPath>.probe` the probe creates and removes.

import { accessSync, closeSync, constants, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

export const LockRefusal = Object.freeze({
  HELD: 'lock.held',
  UNREADABLE: 'lock.unreadable',
  NOT_WRITABLE: 'lock.not-writable',
});

const Holder = Object.freeze({ LIVE: 'live', STALE: 'stale' });

const NEVER_A_PROCESS = 2 ** 31 - 1;

const refuse = (code) => {
  throw Object.assign(new Error(code), { code });
};

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

const pidOf = (text) => (/^\d+\s*$/.test(text) ? Number(text) : null);

const holderOf = (lockPath) => {
  let pid;
  try {
    pid = pidOf(readFileSync(lockPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    refuse(LockRefusal.UNREADABLE);
  }
  if (pid === null) refuse(LockRefusal.UNREADABLE);
  return isAlive(pid) ? Holder.LIVE : Holder.STALE;
};

const ensureWritableDirectory = (lockPath) => {
  try {
    const directory = dirname(lockPath);
    mkdirSync(directory, { recursive: true });
    accessSync(directory, constants.W_OK);
  } catch {
    refuse(LockRefusal.NOT_WRITABLE);
  }
};

const createExclusively = (path, pid) => {
  let descriptor;
  try {
    descriptor = openSync(path, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    refuse(LockRefusal.NOT_WRITABLE);
  }
  try {
    writeSync(descriptor, String(pid));
  } finally {
    closeSync(descriptor);
  }
  return true;
};

const removeQuietly = (path) => {
  try {
    unlinkSync(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
};

const takeFrom = (lockPath, pid) => {
  if (createExclusively(lockPath, pid)) return;
  if (holderOf(lockPath) === Holder.LIVE) refuse(LockRefusal.HELD);
  removeQuietly(lockPath);
  if (!createExclusively(lockPath, pid)) refuse(LockRefusal.HELD);
};

const demonstrateStaleDetection = (probePath) => {
  const holderNamed = (pid) => {
    createExclusively(probePath, pid);
    try {
      return holderOf(probePath);
    } finally {
      removeQuietly(probePath);
    }
  };
  if (holderNamed(process.pid) !== Holder.LIVE || holderNamed(NEVER_A_PROCESS) !== Holder.STALE) refuse(LockRefusal.UNREADABLE);
};

/** @returns {{ probe: () => void, acquire: () => () => void }} `acquire` returns the release; refusals carry a `LockRefusal` code */
export function createRunLock(lockPath) {
  const probePath = `${lockPath}.probe`;
  const probe = () => {
    ensureWritableDirectory(lockPath);
    removeQuietly(probePath);
    demonstrateStaleDetection(probePath);
  };
  const acquire = () => {
    ensureWritableDirectory(lockPath);
    takeFrom(lockPath, process.pid);
    return () => removeQuietly(lockPath);
  };
  return { probe, acquire };
}
