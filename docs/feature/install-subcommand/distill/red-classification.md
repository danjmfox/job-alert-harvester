# RED classification: install-subcommand DISTILL

Every scenario was run once with `RED_GATE=1` against the RED scaffolds `src/core/{launch-agent,install-plan,launchd-print}.mjs` and the unchanged existing modules (nothing else in `src/` was touched; `harvest.mjs` does not know `install`, `uninstall` or `status` and imports no scaffold). One line per scenario. `RED MISSING_FUNCTIONALITY` is the correct RED: an assertion reached by a well-formed test (`assert`: against a CLI that has no such subcommand, so the rebuild form refuses it) or a scaffold throw (`scaffold`). `GREEN_TODAY` pins behaviour that already holds. `INFRA_GREEN` tests the builders, shims, oracles and generators, run unskipped, and exercise no scenario. No scenario failed on an import, fixture or setup error (zero BROKEN): every failure message was classified as an `AssertionError` or the `RED scaffold` throw, and none is a `TypeError`, `ReferenceError`, `SyntaxError`, `ENOENT` or timeout.

Totals (excluding the 31 infrastructure tests): 246 scenarios, 240 RED (23 reach a scaffold throw, 217 assert), 6 GREEN_TODAY, 0 BROKEN. Many subprocess scenarios fail at their Given (`anInstallationThatHasBeenDone` asserts the install exited 0) because install does not exist; that is still the missing behaviour, raised as an `AssertionError`.

GREEN_TODAY (6): the three new core modules import only sibling core modules, declare no class and never name `process` (unskipped, always run); nothing in `src` names an absolute path to `launchctl` or `osascript`; `update --wat` is still refused by update's own table; a first word `installx` is still the rebuild form. Each is a guard that must keep holding.

A throw-away reference implementation in a scratch copy outside the repository (deleted after) passed all 277 tests in this directory (246 scenarios and 31 infrastructure tests). The only existing test it turned red is `tests/regression/job-alert-harvester/unknown-options-refused.test.mjs:275` (the exact list of option tables), which DELIVER extends with `install`, `status` and `uninstall` as ratified. Four deliberate mutations each failed scenarios: bootstrap without a prior bootout (4), `--dry-run` writing files (2), the notification text spliced into the script (19), shell quoting without escaping the single quote (2). So the scenarios can pass and can fail.


## acceptance/install-subcommand/install-branch-guard.test.mjs

- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a feature branch is refused as install.not-on-main, naming the branch, and nothing is written
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a branch named master is not main: install refuses it as install.not-on-main
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a branch named develop is not main: install refuses it as install.not-on-main
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a branch named main2 is not main: install refuses it as install.not-on-main
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a branch named mainline is not main: install refuses it as install.not-on-main
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a branch named feature/main is not main: install refuses it as install.not-on-main
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a detached HEAD is refused as install.not-on-main, saying the checkout is detached
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a directory that is not a git checkout is refused as install.not-on-main, saying so
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a machine where git cannot be run is treated as "cannot confirm main", never as main: install.not-on-main
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error the guard comes before the plan: off main with a hand-made plist is install.not-on-main, not install.foreign-plist
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a preview off main is refused as a real run would be
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --load off main is refused before any launchctl call
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --allow-any-branch on a feature branch installs, and the output names that branch
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --allow-any-branch on a detached HEAD installs, and the output names the commit
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --allow-any-branch on a directory that is not a git checkout installs
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --allow-any-branch where git cannot be run installs
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): install names the checkout, its short commit and its branch, and says the job runs whatever the checkout holds
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): install never says the job is pinned to a commit, in stdout or stderr
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error uncommitted edits do not stop install: the job runs them too, and the guard does not look
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error status works on a feature branch: it reports and reads only
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error uninstall works on a feature branch: with nothing installed it says so and exits 0

## acceptance/install-subcommand/install-core-properties.test.mjs

- RED MISSING_FUNCTIONALITY (scaffold throw): every valid minute of the day reads as its hour and minute
- RED MISSING_FUNCTIONALITY (scaffold throw): @property @error for any text, parseAt gives the hour and minute exactly when the text is HH:MM, and the install.invalid-time refusal otherwise, and never throws
- RED MISSING_FUNCTIONALITY (scaffold throw): the default time is 05:30 and reads as 5 hours 30 minutes
- RED MISSING_FUNCTIONALITY (scaffold throw): @property for any paths and any time the plist is well-formed property-list XML
- RED MISSING_FUNCTIONALITY (scaffold throw): @property the plist carries the label, the shell and wrapper, the checkout, both log files, and the hour and minute as integers
- RED MISSING_FUNCTIONALITY (scaffold throw): @property the plist holds exactly one comment, and it is the same text whatever the paths and the time
- RED MISSING_FUNCTIONALITY (scaffold throw): a root holding every XML metacharacter and a quote survives, as a pinned example
- RED MISSING_FUNCTIONALITY (scaffold throw): @property xmlEscape gives text a reader gets back unchanged, with no raw < and no & that starts no entity
- RED MISSING_FUNCTIONALITY (scaffold throw): @property shellQuote gives one sh word that a real shell reads back as exactly the text
- RED MISSING_FUNCTIONALITY (scaffold throw): @property for any two sets of paths the wrapper is the same text once its single-quoted words are masked: no path character can reach the script outside quotes
- RED MISSING_FUNCTIONALITY (scaffold throw): @property the wrapper embeds the checkout and the node path each as one shellQuote word
- RED MISSING_FUNCTIONALITY (scaffold throw): @property the wrapper and the plist are the same text every time for the same spec
- RED MISSING_FUNCTIONALITY (scaffold throw): @property every path is derived from the checkout and the home directory, the same way for any of them
- RED MISSING_FUNCTIONALITY (scaffold throw): @property it is the first PATH entry whose real path is the running binary, else the running binary's own path
- RED MISSING_FUNCTIONALITY (scaffold throw): with no PATH entry at all the running binary is chosen
- RED MISSING_FUNCTIONALITY (scaffold throw): the four fields are read from the sanitised real sample indented with eight spaces per level, as observed, whatever the label and plist name are
- RED MISSING_FUNCTIONALITY (scaffold throw): the four fields are read from the sanitised real sample indented with a tab per level, whatever the label and plist name are
- RED MISSING_FUNCTIONALITY (scaffold throw): @property for any text at all it never throws and gives exactly the four fields, each as text
- RED MISSING_FUNCTIONALITY (scaffold throw): @property lines that hold no = change nothing: junk between the sample's lines leaves what is read as it was
- RED MISSING_FUNCTIONALITY (scaffold throw): @unconfirmed-format the four fields are read as printed, for a running job with a pid (the running state text and the pid line are not in the real sample)
- RED MISSING_FUNCTIONALITY (scaffold throw): @error a field that is absent reads as unknown: no pid when the job is not running
- RED MISSING_FUNCTIONALITY (scaffold throw): @error text with no recognised field reads as four unknowns, and so does no text at all
- RED MISSING_FUNCTIONALITY (scaffold throw): @error a format that kept only the state line reads that and three unknowns

## acceptance/install-subcommand/install-load.test.mjs

- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): --load on a machine where the job is not loaded: check the session, ask about the job, bootstrap it, ask again; the job is loaded and the output says so
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @unconfirmed-behaviour --load on a loaded job: it is booted out before it is bootstrapped, and ends loaded
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @unconfirmed-behaviour a second install --load with nothing changed reloads the job the same way: bootout, then bootstrap, exit 0
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): both files are written before the first launchctl call
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): install --load touches only its own job: only print, bootstrap and bootout, only this session and this label, never kickstart
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a session that launchd does not offer (an SSH login) is install.launchctl-failed naming the domain; the files stay and nothing is bootstrapped
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a bootstrap that fails is install.launchctl-failed; the files stay and the job is not loaded
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a bootout that fails stops the reload: no bootstrap is attempted, the files stay, the old job is still loaded
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @unconfirmed-behaviour @error running install --load again once launchd works finishes the job: the files are unchanged and the job loads
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a hand-made plist with --load is refused before any launchctl call, and the loaded job is left as it was

## acceptance/install-subcommand/install-options.test.mjs

- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error install --wat is refused as cli.unknown-option, naming "is not an option of install", and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error install --help is refused as cli.unknown-option, naming "is not an option of install", and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error install --dry-run --lode is refused as cli.unknown-option, naming "did you mean --load", and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error install --at=06:00 is refused as cli.unknown-option, naming "write --at <value>", and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error install --at is refused as cli.missing-value, naming "--at needs a value", and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error install --at --dry-run is refused as cli.missing-value, naming "--at needs a value", and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error install --at 06:00 --at 07:00 is refused as cli.duplicate-option, naming "--at is given more than once", and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error install --dry-run --dry-run is refused as cli.duplicate-option, naming "--dry-run is given more than once", and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error install --load --load is refused as cli.duplicate-option, naming "--load is given more than once", and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error install --force --force is refused as cli.duplicate-option, naming "--force is given more than once", and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error install --allow-any-branch --allow-any-branch is refused as cli.duplicate-option, naming "--allow-any-branch is given more than once", and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error install now is refused as cli.unexpected-argument, naming "install takes options only", and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error uninstall --at 06:00 is refused as cli.unknown-option, naming "is not an option of uninstall", and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error uninstall --load is refused as cli.unknown-option, naming "is not an option of uninstall", and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error uninstall --allow-any-branch is refused as cli.unknown-option, naming "is not an option of uninstall", and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error uninstall --dry-run --dry-run is refused as cli.duplicate-option, naming "--dry-run is given more than once", and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error uninstall --force --force is refused as cli.duplicate-option, naming "--force is given more than once", and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error uninstall now is refused as cli.unexpected-argument, naming "uninstall takes options only", and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error status --dry-run is refused as cli.unknown-option, naming "is not an option of status", and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error status --force is refused as cli.unknown-option, naming "is not an option of status", and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error status --at 05:30 is refused as cli.unknown-option, naming "is not an option of status", and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error status --wat is refused as cli.unknown-option, naming "is not an option of status", and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error status now is refused as cli.unexpected-argument, naming "status takes options only", and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error the option table is read before the platform: off macOS an unknown option is still cli.unknown-option
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): every command line ends with exit 0 when it produced a plan or report and exit 1 when it was refused: never 2, never anything else
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error warnings go to stderr and never to stdout
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a refusal never leaves anything on stdout, and its code leads the last stderr line
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): the usage line names install, uninstall and status beside the other subcommands
- GREEN_TODAY: @error update still refuses an option it does not list, by its own table
- GREEN_TODAY: @error a first word that merely starts like a subcommand is still the rebuild form, refused as an unexpected argument

## acceptance/install-subcommand/install-refusals.test.mjs

- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): --at 00:00 schedules the job for 0 hours 0 minutes: the plist carries both as integers
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): --at 05:30 schedules the job for 5 hours 30 minutes: the plist carries both as integers
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): --at 09:07 schedules the job for 9 hours 7 minutes: the plist carries both as integers
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): --at 12:05 schedules the job for 12 hours 5 minutes: the plist carries both as integers
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): --at 23:59 schedules the job for 23 hours 59 minutes: the plist carries both as integers
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --at "5:30" is refused as install.invalid-time, and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --at "05:3" is refused as install.invalid-time, and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --at "24:00" is refused as install.invalid-time, and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --at "05:60" is refused as install.invalid-time, and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --at "0530" is refused as install.invalid-time, and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --at "05.30" is refused as install.invalid-time, and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --at "05:30:00" is refused as install.invalid-time, and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --at " 05:30" is refused as install.invalid-time, and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --at "05:30 " is refused as install.invalid-time, and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --at "noon" is refused as install.invalid-time, and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --at "" is refused as install.invalid-time, and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --at "-1:00" is refused as install.invalid-time, and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --at "+5:30" is refused as install.invalid-time, and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --at "٠٥:٣٠" is refused as install.invalid-time, and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --at "05:30pm" is refused as install.invalid-time, and nothing is read, written or called
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error an invalid time wins over every later refusal: off main, with a hand-made plist and a ledger that cannot be read, it is still install.invalid-time
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error the platform is checked before the time: off macOS an invalid --at is install.unsupported-platform
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error install on linux is refused as install.unsupported-platform, ahead of every other check, and reaches no launchctl
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error install on freebsd is refused as install.unsupported-platform, ahead of every other check, and reaches no launchctl
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error uninstall on linux is refused as install.unsupported-platform, ahead of every other check, and reaches no launchctl
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error uninstall on freebsd is refused as install.unsupported-platform, ahead of every other check, and reaches no launchctl
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error status on linux is refused as install.unsupported-platform, ahead of every other check, and reaches no launchctl
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error status on freebsd is refused as install.unsupported-platform, ahead of every other check, and reaches no launchctl
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a directory whose src/cli/harvest.mjs is another file is install.wrong-directory: the job would run a different checkout
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a subdirectory of the checkout is install.wrong-directory: .cache/ would be resolved against it
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a checkout directory name with a newline is refused as install.unsafe-path and nothing is written
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a checkout directory name with a control character is refused as install.unsafe-path and nothing is written
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a checkout directory name with a tab is refused as install.unsafe-path and nothing is written
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a node path with a newline in its directory name is refused as install.unsafe-path and nothing is written
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): a checkout directory named "with space" installs, and the plist names exactly that directory; nothing in the name is run
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): a checkout directory named "it's here" installs, and the plist names exactly that directory; nothing in the name is run
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): a checkout directory named "say \"hi\"" installs, and the plist names exactly that directory; nothing in the name is run
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): a checkout directory named "a&b<c>d" installs, and the plist names exactly that directory; nothing in the name is run
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): a checkout directory named "dollar $HOME and ${PATH}" installs, and the plist names exactly that directory; nothing in the name is run
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): a checkout directory named "tick `touch SENTINEL` tick" installs, and the plist names exactly that directory; nothing in the name is run
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): a checkout directory named "sub $(touch SENTINEL) sub" installs, and the plist names exactly that directory; nothing in the name is run
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): a checkout directory named "semi; touch SENTINEL; done" installs, and the plist names exactly that directory; nothing in the name is run
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): a checkout directory named "back\\slash" installs, and the plist names exactly that directory; nothing in the name is run
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): a checkout directory named "unicode é — 日本" installs, and the plist names exactly that directory; nothing in the name is run
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @real-io the plist for a checkout named "a&b<c>d" passes plutil -lint
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @real-io the plist for a checkout named "say \"hi\"" passes plutil -lint
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @real-io the plist for a checkout named "it's here" passes plutil -lint
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @real-io the plist for a checkout named "unicode é — 日本" passes plutil -lint
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a LaunchAgents folder the operator cannot write to is install.not-writable, and not even the wrapper is written
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a Library/LaunchAgents that is a file is install.not-writable, and the checkout is not touched
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a .cache that is a file is install.not-writable, and no plist is written to HOME
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a ledger that holds no interval: install warns on stderr that update would refuse update.no-baseline, and still writes both files
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a ledger that covers only another source: install warns on stderr that update would refuse update.no-baseline, and still writes both files
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a ledger that does not exist, and neither does .cache/: install warns on stderr that update would refuse update.no-baseline, and still writes both files
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a stable PATH entry that is the running binary is pinned in preference to the versioned path, with no warning
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a node reached only by a versioned path is pinned as it is, with a warning that names the path and that it holds a version
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a node on PATH that is not the running binary is not pinned: the running binary's own path is
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error @unconfirmed-behaviour a checkout under ~/Documents installs but warns that a launchd job may not be allowed to read it

## acceptance/install-subcommand/install-structure.test.mjs

- GREEN_TODAY: @structural src/core/launch-agent.mjs exists, imports only sibling core modules, declares no class and never touches process
- GREEN_TODAY: @structural src/core/install-plan.mjs exists, imports only sibling core modules, declares no class and never touches process
- GREEN_TODAY: @structural src/core/launchd-print.mjs exists, imports only sibling core modules, declares no class and never touches process
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @structural only src/adapters/launchctl.mjs and src/adapters/git-checkout.mjs import child_process
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @structural the launchctl adapter spawns the bare name launchctl, never a path to it
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @structural the git adapter spawns the bare name git, never a path to it
- GREEN_TODAY: @structural nothing in src names an absolute path to launchctl or osascript

## acceptance/install-subcommand/install-wrapper.test.mjs

- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @real-io the wrapper runs the pinned node once, with the checkout's harvest script and the one word update
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @real-io the wrapper changes to the checkout first, even when launchd starts it somewhere else
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @real-io a good run passes node's stdout through and replays its stderr, shows no notification, and exits 0
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a failed update exits with node's own status, replays its stderr to the log, and shows one notification holding the last stderr line
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a last stderr line with double quotes reaches osascript as one argument, equal to the line, and is never spliced into script text
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a last stderr line with a backslash before a quote reaches osascript as one argument, equal to the line, and is never spliced into script text
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a last stderr line with backticks reaches osascript as one argument, equal to the line, and is never spliced into script text
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a last stderr line with a command substitution reaches osascript as one argument, equal to the line, and is never spliced into script text
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a last stderr line with a shell break-out reaches osascript as one argument, equal to the line, and is never spliced into script text
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a last stderr line with an AppleScript break-out reaches osascript as one argument, equal to the line, and is never spliced into script text
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a last stderr line with a leading dash that looks like an option reaches osascript as one argument, equal to the line, and is never spliced into script text
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a last stderr line with percent signs and braces reaches osascript as one argument, equal to the line, and is never spliced into script text
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a last stderr line with single quotes reaches osascript as one argument, equal to the line, and is never spliced into script text
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a last stderr line with non-ASCII text reaches osascript as one argument, equal to the line, and is never spliced into script text
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error control characters in the line are removed from the notification
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error the line used is the last non-empty one: trailing blank lines are skipped
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a very long line is cut: the argument is a prefix of the line, at least 60 characters and at most 1000
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error empty stderr: the notification says exit status 3
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error only blank lines on stderr: the notification says exit status 9
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error empty stderr and status 70: the notification says exit status 70
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a node that exits 1 makes the wrapper exit 1 with one notification
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a node that exits 2 makes the wrapper exit 2 with one notification
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a node that exits 3 makes the wrapper exit 3 with one notification
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a node that exits 70 makes the wrapper exit 70 with one notification
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a node that exits 127 makes the wrapper exit 127 with one notification
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a node that exits 255 makes the wrapper exit 255 with one notification
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a node file that is not executable: exit 127, one notification telling the operator to run harvest install again, node never run
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a node file that is gone (the operator upgraded node): exit 127 and the same notification
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a checkout that is gone: the wrapper exits non-zero, shows one notification, and never runs node
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error an osascript that fails leaves the wrapper's exit status as node's
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error no osascript at all leaves the wrapper's exit status as node's
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error no osascript and no node: the wrapper still exits 127
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error after a good run the temporary directory is empty and the checkout's .cache is as it was
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error after a failed run the temporary directory is empty and the checkout's .cache is as it was
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error after a failed run with no osascript the temporary directory is empty and the checkout's .cache is as it was
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error after a node that is gone the temporary directory is empty and the checkout's .cache is as it was
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @real-io a checkout and a node binary both in directories named "with space": the wrapper changes into the first and runs the second, and nothing in the names is run
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @real-io a checkout and a node binary both in directories named "it's here": the wrapper changes into the first and runs the second, and nothing in the names is run
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @real-io a checkout and a node binary both in directories named "say \"hi\"": the wrapper changes into the first and runs the second, and nothing in the names is run
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @real-io a checkout and a node binary both in directories named "a&b<c>d": the wrapper changes into the first and runs the second, and nothing in the names is run
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @real-io a checkout and a node binary both in directories named "dollar $HOME and ${PATH}": the wrapper changes into the first and runs the second, and nothing in the names is run
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @real-io a checkout and a node binary both in directories named "tick `touch SENTINEL` tick": the wrapper changes into the first and runs the second, and nothing in the names is run
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @real-io a checkout and a node binary both in directories named "sub $(touch SENTINEL) sub": the wrapper changes into the first and runs the second, and nothing in the names is run
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @real-io a checkout and a node binary both in directories named "semi; touch SENTINEL; done": the wrapper changes into the first and runs the second, and nothing in the names is run
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @real-io a checkout and a node binary both in directories named "back\\slash": the wrapper changes into the first and runs the second, and nothing in the names is run
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @real-io a checkout and a node binary both in directories named "unicode é — 日本": the wrapper changes into the first and runs the second, and nothing in the names is run

## acceptance/install-subcommand/install-writes-files.test.mjs

- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @walking_skeleton @driving_adapter @real-io Operator runs install and gets the daily update job written for this checkout, with the exact command that loads it, and no launchctl call made
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): the load command names the operator's own user id, not a fixed one
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): a clean install says nothing on stderr and prints nothing that is a refusal
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): the plist carries the label, the shell and wrapper, the checkout as working directory, 05:30 and both log files, in the how-to's order
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): the plist carries one constant generated marker as an XML comment, and a hand-made plist has none
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @real-io the plist passes plutil -lint
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): the wrapper is executable, the plist is not, and the wrapper is valid shell
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): the wrapper pins the node path and the checkout, single-quoted, and sets no PATH of its own
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --dry-run writes nothing and calls nothing: the machine is exactly as it was, and each file is named as one that would be created
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --dry-run prints the full text of both files, and it is the text a real install then writes
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --dry-run with --load prints the load command and runs no launchctl
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --dry-run refuses a hand-made plist as a real run would, and changes nothing
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a second install straight after a good one changes nothing: both files unchanged, not rewritten, no launchctl
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a changed --at replaces the job's own plist and leaves the wrapper alone; the reload commands are printed, bootout first
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error the plist is replaced atomically: a second name for the old file still holds the old text, and no temporary file is left
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a node binary that moved replaces the wrapper and leaves the plist alone
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a hand-made plist is refused without --force: exit 1, install.foreign-plist, stdout empty, the plist byte for byte as it was, and no wrapper written
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --force replaces a hand-made plist with the generated one and writes the wrapper
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a job installed from another checkout is refused as install.other-checkout, and left running that checkout's update
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --force moves the job to the second checkout: the plist now works in that directory and its wrapper exists
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error an existing LaunchAgents folder is used as it is: only the plist is added to HOME

## acceptance/install-subcommand/status.test.mjs

- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): the job is installed and loaded: status reports the schedule, that it is loaded, its state, runs and last exit code, that nothing has drifted and the node file is there
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @unconfirmed-format a job that is running reports its state and process id
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a job whose last run failed is still a report, exit 0, with the exit code shown
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error an installed job that launchd does not hold is reported as not loaded, exit 0
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error nothing installed is a report, not a refusal: not installed, not loaded, exit 0, stderr empty, and only reads
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error "loaded" is the exit status of launchctl print, not its text: staged text with the job not loaded is still not loaded
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a launchctl print that fails for any reason reads as not loaded, and status still reports and exits 0
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a wrapper edited by hand is drift, naming the wrapper
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a plist whose log path was edited by hand is drift naming the plist
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a schedule chosen with --at is the plist's own, and is not drift
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a hand-made plist is reported as installed and foreign, with its own schedule
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a node file that is gone is flagged as missing, naming the path, and the report still exits 0
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a wrapper that is gone (the operator deleted .cache) is flagged as missing, exit 0
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error the logs' modification times and the last output line stand in for a last run time
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error logs that do not exist yet read as none
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a loaded job whose print text has no recognised field is install.unrecognised-output, the raw text on stderr, stdout empty
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a loaded job whose print text keeps only one known field reports that field, the others unknown, one stderr line naming the command, exit 0

## acceptance/install-subcommand/uninstall.test.mjs

- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @driving_adapter @real-io Operator runs uninstall and the loaded daily job is gone: booted out first, with both files still there at that moment, then both files removed
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a job that is installed but not loaded is not booted out: only the two files go
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error logs, the cache, the ledger and the credentials are never touched
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a job loaded from files that are already gone is still booted out
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a plist whose wrapper is already gone is removed; so is a wrapper whose plist is already gone
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error nothing installed: it says there is nothing to remove, exits 0, and only reads
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a second uninstall straight after a good one is the same report
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a hand-made plist is refused as install.foreign-plist, with the plist kept and no bootout
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error --force removes a hand-made plist, booting the job out first
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error uninstall --dry-run of a hand-made plist is refused as a real run would be
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error a bootout that fails is install.launchctl-failed: both files stay and the job stays loaded
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @error the plist goes before the wrapper: when the wrapper cannot be removed, the plist is already gone, and the exit is 1
- RED MISSING_FUNCTIONALITY (assertion on absent subcommand): @unconfirmed-behaviour @error a preview names both files and the bootout, and changes nothing
