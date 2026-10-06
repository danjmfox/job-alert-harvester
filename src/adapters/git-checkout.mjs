// Driven adapter: what git says about a checkout. Unbounded-preservation: two fixed read-only git invocations, nothing else.
import { execFileSync } from 'node:child_process';

const SHORT_COMMIT_LENGTH = 7;

const gitOutput = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const attempt = (read) => {
  try {
    return read();
  } catch {
    return null;
  }
};

/**
 * @param {string} root the checkout directory
 * @returns {{ commit: string, branch: string | null } | null} `branch` is null on a detached HEAD;
 *          null when git cannot be run, `root` is not a checkout, or HEAD names no commit: the checkout cannot be confirmed
 */
export function read(root) {
  const head = attempt(() => gitOutput(root, ['rev-parse', 'HEAD']));
  if (head === null || head === '') return null;
  const branch = attempt(() => gitOutput(root, ['symbolic-ref', '--short', '-q', 'HEAD']));
  return { commit: head.slice(0, SHORT_COMMIT_LENGTH), branch: branch === '' ? null : branch };
}
