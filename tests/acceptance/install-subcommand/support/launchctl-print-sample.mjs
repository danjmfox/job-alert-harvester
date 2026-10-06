// A SANITISED REAL SAMPLE of `launchctl print gui/<uid>/<label>` for a loaded job, captured by the operator on macOS (version
// unconfirmed) during DESIGN slice 0 and rewritten with synthetic placeholders (uid, home, checkout, label, random launchd ids).
// This is the only place the shape of that text is written down in the install-subcommand tests. OBSERVED: a loaded job prints
// with exit 0; the header is `gui/<uid>/<label> = {`; fields are flat `key = value` lines indented 8 spaces per level (tab versus
// spaces is unconfirmed, so the builder takes the indent and the reader must tolerate both); `runs` and `last exit code` are
// integers; `arguments` and `descriptor` are nested blocks and the schedule shows as `"Hour" => 5` inside `event triggers`.
// ALSO OBSERVED (slice 0): `launchctl print` of a label that is NOT loaded exits 113 and prints `Bad request.` then
// `Could not find service "<label>" in domain for user gui: <uid>`; `bootstrap` of a plist whose label differs from its file name
// exits 0 silently; `kickstart -k` exits 0 silently; a wrapper that exits 127 shows `last exit code = 127` and `runs` incremented;
// the job's default PATH is /usr/bin:/bin:/usr/sbin:/sbin; launchd appends to the logs.
// STILL UNCONFIRMED (scenarios that rely on them carry `@unconfirmed-format`): bootstrap of an already-loaded label, the `state` text while running, the `pid` line, and `(never exited)`-style values.
// The label is the one in the header, the plist path is the `path =` line: never derive either from the plist's file name.

/** What `launchctl print` printed for a loaded job. `pid` is null (no line) unless given. */
export function aLaunchctlPrint({ uid = 501, label, plist, wrapper, root, state = 'not running', runs = 0, lastExitCode = 0, pid = null, indent = '        ', hour = 5, minute = 30 } = {}) {
  const i1 = indent;
  const i2 = indent.repeat(2);
  const i3 = indent.repeat(3);
  const i4 = indent.repeat(4);
  const exit = lastExitCode === null ? '(never exited)' : String(lastExitCode);
  const lines = [
    `gui/${uid}/${label} = {`,
    `${i1}active count = 0`,
    `${i1}path = ${plist}`,
    `${i1}type = LaunchAgent`,
    `${i1}state = ${state}`,
    '',
    `${i1}program = /bin/sh`,
    `${i1}arguments = {`,
    `${i2}/bin/sh`,
    `${i2}${wrapper}`,
    `${i1}}`,
    '',
    `${i1}working directory = ${root}`,
    '',
    `${i1}stdout path = ${root}/.cache/logs/update.out.log`,
    `${i1}stderr path = ${root}/.cache/logs/update.err.log`,
    `${i1}default environment = {`,
    `${i2}PATH => /usr/bin:/bin:/usr/sbin:/sbin`,
    `${i1}}`,
    '',
    `${i1}environment = {`,
    `${i2}OSLogRateLimit => 64`,
    `${i2}XPC_SERVICE_NAME => ${label}`,
    `${i1}}`,
    '',
    `${i1}domain = gui/${uid} [100023]`,
    `${i1}asid = 100023`,
    `${i1}minimum runtime = 10`,
    `${i1}exit timeout = 5`,
    `${i1}runs = ${runs}`,
    ...(pid === null ? [] : [`${i1}pid = ${pid}`]),
    `${i1}last exit code = ${exit}`,
    '',
    `${i1}event triggers = {`,
    `${i2}${label}.268435502 => {`,
    `${i3}keepalive = 0`,
    `${i3}service = ${label}`,
    `${i3}stream = com.apple.launchd.calendarinterval`,
    `${i3}descriptor = {`,
    `${i4}"Minute" => ${minute}`,
    `${i4}"Hour" => ${hour}`,
    `${i3}}`,
    `${i2}}`,
    `${i1}}`,
    '',
    `${i1}spawn type = daemon (3)`,
    `${i1}properties = inferred program`,
    '}',
    '',
  ];
  return lines.join('\n');
}

/** Text that is not `key = value` lines at all: what a changed format could look like to the reader. */
export const AN_UNRECOGNISABLE_PRINT = 'Service cannot load in requested session\nunrecognised format 2027\n';
/** A format that kept one known line and dropped the rest. */
export const aPrintWithOnlyTheState = (state = 'running') => `gui/501/job = {\n\tstate = ${state}\n}\n`;
