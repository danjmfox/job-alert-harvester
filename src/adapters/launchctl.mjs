// Driven adapter: launchctl for the one job install manages. Bounded-change: closed over one label, so no other job can be named.
// Only print, bootstrap and bootout exist; launchctl is spawned by bare name with an argument array, never through a shell.
import { spawnSync } from 'node:child_process';

const lastLineOf = (text) => text.split('\n').map((line) => line.trim()).filter((line) => line !== '').at(-1) ?? '';

const printJob = (target) => {
  const args = ['print', target];
  const command = `launchctl ${args.join(' ')}`;
  const { status, stdout, error } = spawnSync('launchctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return { loaded: error === undefined && status === 0, text: error === undefined && status === 0 ? stdout ?? '' : '', command };
};

const run = (args) => {
  const { status, stderr, error } = spawnSync('launchctl', args, { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
  const command = `launchctl ${args.join(' ')}`;
  if (error !== undefined) return { ok: false, command, detail: `could not run launchctl (${error.code ?? error.message})` };
  return { ok: status === 0, command, detail: `exited ${status}${lastLineOf(stderr ?? '') === '' ? '' : `: ${lastLineOf(stderr)}`}` };
};

/**
 * @param {{ uid: number, label: string, plistPath: string }} job
 * @returns {{ domain: string, job: string,
 *             reader: { jobIsLoaded: () => boolean, printJob: () => { loaded: boolean, text: string, command: string } },
 *             controller: { probeSession: () => Result, bootstrap: () => Result, bootout: () => Result } }}
 *          where Result is `{ ok: boolean, command: string, detail: string }`; "loaded" is the exit status of `print`, never its text
 */
export function createLaunchctl({ uid, label, plistPath }) {
  const domain = `gui/${uid}`;
  const target = `${domain}/${label}`;
  return {
    domain,
    job: target,
    reader: { jobIsLoaded: () => run(['print', target]).ok, printJob: () => printJob(target) },
    controller: {
      probeSession: () => run(['print', domain]),
      bootstrap: () => run(['bootstrap', domain, plistPath]),
      bootout: () => run(['bootout', target]),
    },
  };
}
