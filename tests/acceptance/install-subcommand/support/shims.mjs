// PATH shims for the tools install, uninstall and status reach through the shell: `launchctl` and `osascript`, plus a fake
// `node` for running the generated wrapper. No process fake existed to extend (DESIGN, Testing without launchd). Each shim
// is a small `sh` script that records every call, with the arguments NUL-separated (so a hostile argument cannot split a
// record), and answers from files the scenario staged, so a call changes only the scratch state and never the host.
//
// Trace: one file per call in SHIM_TRACE_DIR, `<six-digit sequence>.call` holding `tool NUL arg NUL arg NUL ...`, plus
// `<sequence>.self` (the path the shim was run as, `$0`), `<sequence>.seen` (one `present<TAB>path` or `absent<TAB>path` line per path listed in `<state>/watch`, taken at the moment
// of the call) and `<sequence>.cwd`. State: files in SHIM_STATE_DIR (see each shim's header).
//
// The `launchctl` print of an unloaded job (exit 113, the two lines "Bad request." and "Could not find service ...") is OBSERVED
// (slice 0; stream not captured separately, stderr here). `bootstrap` of a loaded job failing with status 5 is a guess (UNCONFIRMED) made so that a missing
// `bootout` is visible as a failure.

import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PRELUDE = (tool, guard = '') => `#!/bin/sh
${guard}tool=${tool}
dir="$SHIM_TRACE_DIR"
state="$SHIM_STATE_DIR"
seq=0
[ -f "$dir/.seq" ] && read seq < "$dir/.seq"
seq=$((seq + 1))
printf '%s\\n' "$seq" > "$dir/.seq"
id=$(printf '%06d' "$seq")
printf '%s\\0' "$tool" "$@" > "$dir/$id.call"
: > "$dir/$id.seen"
if [ -f "$state/watch" ]; then
  while IFS= read -r watched; do
    if [ -e "$watched" ]; then answer=present; else answer=absent; fi
    printf '%s\\t%s\\n' "$answer" "$watched" >> "$dir/$id.seen"
  done < "$state/watch"
fi
pwd > "$dir/$id.cwd"
printf '%s' "$0" > "$dir/$id.self"
`;

/** launchctl: `loaded` marks the job loaded; `print.out` is what a loaded job prints; `exit.<verb>` (print, print-domain, bootstrap, bootout) is a staged failing status. */
const LAUNCHCTL = `${PRELUDE('launchctl')}
staged() {
  if [ -f "$state/exit.$1" ]; then
    read code < "$state/exit.$1"
    echo "launchctl: staged failure of $1" >&2
    exit "$code"
  fi
}
case "$1" in
  print)
    case "$2" in
      gui/*/*)
        staged print
        if [ -f "$state/loaded" ]; then
          [ -f "$state/print.out" ] && cat "$state/print.out"
          exit 0
        fi
        echo "Bad request." >&2
        user=\${2#gui/}
        user=\${user%%/*}
        echo "Could not find service \\"\${2##*/}\\" in domain for user gui: $user" >&2
        exit 113 ;;
      gui/*)
        staged print-domain
        echo "domain = {}"
        exit 0 ;;
    esac ;;
  bootstrap)
    staged bootstrap
    if [ -f "$state/loaded" ]; then
      echo "Bootstrap failed: 5: Input/output error" >&2
      exit 5
    fi
    : > "$state/loaded"
    exit 0 ;;
  bootout)
    staged bootout
    if [ -f "$state/loaded" ]; then
      rm -f "$state/loaded"
      exit 0
    fi
    echo "Boot-out failed: 3: No such process" >&2
    exit 3 ;;
esac
echo "launchctl shim: no answer staged for: $*" >&2
exit 64
`;

/** Like the real osascript, an argument starting with a dash is an option unless it follows `--`; `--` itself is not an argument. */
const OSASCRIPT_OPTIONS = `after_dashes=no
count=$#
while [ "$count" -gt 0 ]; do
  arg=$1
  shift
  count=$((count - 1))
  if [ "$after_dashes" = yes ]; then
    set -- "$@" "$arg"
  elif [ "$arg" = -e ]; then
    set -- "$@" "$arg"
    if [ "$count" -gt 0 ]; then
      set -- "$@" "$1"
      shift
      count=$((count - 1))
    fi
  elif [ "$arg" = -- ]; then
    after_dashes=yes
  else
    case "$arg" in
      -?*)
        echo "osascript: no such component \\"\${arg#-?}\\"" >&2
        exit 1 ;;
    esac
    set -- "$@" "$arg"
  fi
done
`;

/** osascript: `exit.osascript` is a staged status; the default is success. */
const OSASCRIPT = `${PRELUDE('osascript', OSASCRIPT_OPTIONS)}
code=0
[ -f "$state/exit.osascript" ] && read code < "$state/exit.osascript"
exit "$code"
`;

/** A fake node: `node.stderr` and `node.stdout` are replayed byte for byte, `node.exit` is the status (default 0). */
const FAKE_NODE = `${PRELUDE('node')}
[ -f "$state/node.stderr" ] && cat "$state/node.stderr" >&2
[ -f "$state/node.stdout" ] && cat "$state/node.stdout"
code=0
[ -f "$state/node.exit" ] && read code < "$state/node.exit"
exit "$code"
`;

const writeExecutable = (path, text) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
};

export const writeLaunchctlShim = (directory) => writeExecutable(join(directory, 'launchctl'), LAUNCHCTL);
export const writeOsascriptShim = (directory) => writeExecutable(join(directory, 'osascript'), OSASCRIPT);
export const writeFakeNode = (path) => writeExecutable(path, FAKE_NODE);
/** A file that exists and is executable but holds nothing: all `install` needs of a node binary (it never runs it). */
export const writeInertNode = (path) => writeExecutable(path, '#!/bin/sh\nexit 0\n');

/** The utilities a wrapper might reasonably use, and nothing that reaches the host: no `osascript`, no `launchctl`, no `node`, no `git`. */
const TOOLS = ['sh', 'cat', 'tail', 'head', 'tr', 'rm', 'mktemp', 'sed', 'awk', 'cut', 'dirname', 'basename', 'wc', 'grep', 'expr', 'mv', 'mkdir', 'cp', 'ls', 'echo', 'env', 'pwd', 'sleep', 'date', 'od', 'id', 'printf', 'test', 'tee', 'sort', 'kill', 'uname'];
export const FORBIDDEN_IN_THE_TOOLBOX = Object.freeze(['osascript', 'launchctl', 'node', 'git']);

/** A directory of symlinks to those utilities, for a PATH that must resolve them but must not reach the real `osascript`. */
export function writeToolbox(directory) {
  mkdirSync(directory, { recursive: true });
  for (const tool of TOOLS) {
    const found = ['/bin', '/usr/bin'].map((place) => join(place, tool)).find((candidate) => existsSync(candidate));
    if (found) symlinkSync(found, join(directory, tool));
  }
  return directory;
}

// ---------------------------------------------------------------- reading the trace

const readSeen = (path) =>
  existsSync(path)
    ? Object.fromEntries(
        readFileSync(path, 'utf8')
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => {
            const [answer, ...rest] = line.split('\t');
            return [rest.join('\t'), answer === 'present'];
          }),
      )
    : {};

/** Every recorded call in order: `{ tool, argv, seen, cwd, self }`. */
export function callsRecordedIn(traceDirectory) {
  if (!existsSync(traceDirectory)) return [];
  return readdirSync(traceDirectory)
    .filter((name) => name.endsWith('.call'))
    .sort()
    .map((name) => {
      const id = name.slice(0, -'.call'.length);
      const fields = readFileSync(join(traceDirectory, name), 'utf8').split('\0');
      fields.pop();
      const [tool, ...argv] = fields;
      const cwdPath = join(traceDirectory, `${id}.cwd`);
      const selfPath = join(traceDirectory, `${id}.self`);
      return {
        tool,
        argv,
        seen: readSeen(join(traceDirectory, `${id}.seen`)),
        cwd: existsSync(cwdPath) ? readFileSync(cwdPath, 'utf8').trim() : null,
        self: existsSync(selfPath) ? readFileSync(selfPath, 'utf8') : null,
      };
    });
}
