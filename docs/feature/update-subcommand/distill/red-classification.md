# RED classification: update-subcommand DISTILL

Every scenario was run once with `RED_GATE=1` against the RED scaffold `src/core/update-plan.mjs` and the unchanged existing modules (nothing else in `src/` was touched; `harvest.mjs` does not know the `update` subcommand and does not import the scaffold). One line per scenario. `RED MISSING_FUNCTIONALITY` is the correct RED: an assertion, or the scaffold throw, reached by a well-formed test. `GREEN_TODAY` pins behaviour that already holds. `INFRA_GREEN` tests the builders, the composed fake, the scripted faults, the lock helpers, the oracle and the generators, run unskipped, and exercise no scenario. No scenario failed on an import, fixture or setup error (zero BROKEN): the failure text of all 99 failing scenarios was scanned for `TypeError`, `ReferenceError`, `SyntaxError`, `Cannot find`, `ENOENT` and timeouts, and none appears.

Totals (excluding the infrastructure tests): 100 scenarios, 99 RED (42 reach a scaffold throw, 57 assert against the CLI that has no `update` subcommand: 12 of them pass the exit-status check today because the rebuild form already exits 1 for an unknown first word, and fail on the next assertion, the missing `update.*` line or lock), 1 GREEN_TODAY, 0 BROKEN; 22 infrastructure tests green.

The one GREEN_TODAY scenario is a guard that holds today and must keep holding: `update-plan.mjs` imports only `./` modules, uses no `node:` builtin, declares no class and reads no clock. The scenario "a bare word after update" was GREEN today by coincidence (the rebuild form also refuses a bare word with the same code), so it now also asserts the refusal names `now`, which only the `update` option table will do.

The same scenarios were also run against a throw-away reference implementation in a scratch copy of the repository (not committed): all 122 tests in the directory passed there (100 scenarios and 22 infrastructure tests). The existing suite stayed green around them except one existing test, which pins the exact list of option tables (`tests/regression/job-alert-harvester/unknown-options-refused.test.mjs:275`, "has a table for the rebuild form and every subcommand") and goes red when `update` joins `OPTION_TABLES`; DELIVER extends that list with `update`, an addition the feature requires and not a weakening. Seven deliberate mutations of it each failed scenarios: building after a failed fetch (5), dropping the nothing-new line (6), never releasing the lock (8), taking the latest covered day as the default start (2), letting the preview fetch (3), never recovering a stale lock (1), and an inverted range for a future `--from` (5). So the scenarios can pass and can fail.

## acceptance/update-subcommand/update-sequence.test.mjs

- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @walking_skeleton @driving_adapter @real-io Operator runs update and finds yesterday's alerts fetched and their Google Sheet brought up to date, both stages named on stdout
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error nothing new: every day is already covered, so update says so in one line, asks Gmail nothing and still builds
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error a quiet day is progress, not nothing new: the day with no mail is fetched and covered, and the build still runs
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error a second update straight after a good one is quiet: nothing new, no Gmail request, no further data batch, nothing changed
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error update fetches every uncovered day up to yesterday in order, and the summary counts them
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error update never fetches today: mail that arrived today waits for the next run
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error the new adverts reach the Sheet as rows appended after the ones it already held, and the existing rows are not rewritten
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error progress and the closing line are on stdout; refusals and the build's role-family and search-yield views are on stderr
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error the hour of the day does not matter: the same week run at 23:30 instead of 07:30 fetches the same days and prints the same lines

## acceptance/update-subcommand/update-fails-closed.test.mjs

- RED MISSING_FUNCTIONALITY (an assertion on update behaviour; the CLI already exits 1 for an unknown subcommand, so the exit check alone is not what fails): @error a fetch that hits Gmail's quota stops the update: no build, not one request to Sheets, exit 1, the fetch named with gmail.quota-exhausted
- RED MISSING_FUNCTIONALITY (an assertion on update behaviour; the CLI already exits 1 for an unknown subcommand, so the exit check alone is not what fails): @error a Gmail credential that needs authorising again stops the update with gmail.reauth-required and the command to run, as the last stderr line
- RED MISSING_FUNCTIONALITY (an assertion on update behaviour; the CLI already exits 1 for an unknown subcommand, so the exit check alone is not what fails): @error a Gmail refusal that is not a rate limit stops the update the same way: gmail.unauthorized, no build
- RED MISSING_FUNCTIONALITY (an assertion on update behaviour; the CLI already exits 1 for an unknown subcommand, so the exit check alone is not what fails): @error a Gmail credential that is missing stops the update at the fetch before any request is made
- RED MISSING_FUNCTIONALITY (an assertion on update behaviour; the CLI already exits 1 for an unknown subcommand, so the exit check alone is not what fails): @error a fetch that stops partway keeps the days it covered and builds nothing; the next update resumes from the first uncovered day and builds
- RED MISSING_FUNCTIONALITY (an assertion on update behaviour; the CLI already exits 1 for an unknown subcommand, so the exit check alone is not what fails): @error a build that fails after a good fetch says the fetch is kept: the new days stay cached and covered, the Sheet is untouched, exit 1
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error the same failure heals on the next run: update fetches nothing, says so, builds, and the Sheet catches up
- RED MISSING_FUNCTIONALITY (an assertion on update behaviour; the CLI already exits 1 for an unknown subcommand, so the exit check alone is not what fails): @error a Sheet that needs authorising again stops the build, keeps the fetch, and names the command to run
- RED MISSING_FUNCTIONALITY (an assertion on update behaviour; the CLI already exits 1 for an unknown subcommand, so the exit check alone is not what fails): @error an operator who has not imported a tracker yet gets the build's refusal after a good fetch, with the fetch kept
- RED MISSING_FUNCTIONALITY (an assertion on update behaviour; the CLI already exits 1 for an unknown subcommand, so the exit check alone is not what fails): @error a failure never reaches stdout: stdout holds the progress made, stderr holds the one refusal line

## acceptance/update-subcommand/update-options.test.mjs

- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error by default update starts at the earliest covered day, so a gap before it is not noticed
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error --from reaches back before the earliest covered day: the gap is fetched, covered and built
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error --from inside the covered range changes nothing about the fetch: covered days are skipped, so only the uncovered day is asked for
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error --from today has nothing settled to fetch: update says nothing new, makes no Gmail request and still builds
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error --from tomorrow has nothing settled to fetch: update says nothing new, makes no Gmail request and still builds
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error --from a year ahead has nothing settled to fetch: update says nothing new, makes no Gmail request and still builds
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error --from 2026-02-30 is refused as cli.invalid-date, and nothing is read, fetched or written
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error --from 2026-13-01 is refused as cli.invalid-date, and nothing is read, fetched or written
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error --from yesterday is refused as cli.invalid-date, and nothing is read, fetched or written
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error --from 10/09/2026 is refused as cli.invalid-date, and nothing is read, fetched or written
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error --from 2026-9-1 is refused as cli.invalid-date, and nothing is read, fetched or written
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error --from with nothing after it is refused as cli.missing-value
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error --from followed by another option is refused as cli.missing-value, not read as a date
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error --from given twice is refused as cli.duplicate-option
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error --dry-run given twice is refused as cli.duplicate-option
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error --to is not an option of update: refused as cli.unknown-option, and nothing is read, fetched or written
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error --source is not an option of update: refused as cli.unknown-option, and nothing is read, fetched or written
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error --report is not an option of update: refused as cli.unknown-option, and nothing is read, fetched or written
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error --target is not an option of update: refused as cli.unknown-option, and nothing is read, fetched or written
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error --wat is not an option of update: refused as cli.unknown-option, and nothing is read, fetched or written
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error a misspelt --dry-run is refused as cli.unknown-option and the refusal suggests --dry-run
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error a bare word after update is refused as cli.unexpected-argument
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error with no ledger at all update refuses update.no-baseline, points to fetch --from, and reaches no service
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error a ledger that exists and is empty refuses the same way
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error a ledger that covers only another source gives linkedin no baseline
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error a preview refuses the same way: update --dry-run with an empty ledger is update.no-baseline
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error once the operator has backfilled with fetch --from, update has a baseline and runs
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error --dry-run prints the range a run would fetch and its uncovered days, then the build's own preview, and makes no Gmail request and no write
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error --dry-run prints the build's role-family and search-yield views on stderr, as the build does
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error --dry-run --from counts every uncovered day from that start to yesterday: 1 September on a ledger covering 5th to 8th is five days
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error --dry-run on a ledger that already covers yesterday says zero uncovered days
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error the real run does what the preview said: one uncovered day previewed, one day fetched, and the preview left the cache alone

## acceptance/update-subcommand/update-lock.test.mjs

- RED MISSING_FUNCTIONALITY (an assertion on update behaviour; the CLI already exits 1 for an unknown subcommand, so the exit check alone is not what fails): @error a second update while one is running refuses update.already-running, reaches no service, and leaves the running update's lock alone
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error a lock left by a process that has died is recovered: update runs to the end and the lock is gone
- RED MISSING_FUNCTIONALITY (the update subcommand is absent): @error while update runs its lock names a live process, and the lock is removed when the run ends
- RED MISSING_FUNCTIONALITY (an assertion on update behaviour; the CLI already exits 1 for an unknown subcommand, so the exit check alone is not what fails): @error a failed update releases its lock, so the next run gets as far as the fetch again instead of refusing
- RED MISSING_FUNCTIONALITY (an assertion on update behaviour; the CLI already exits 1 for an unknown subcommand, so the exit check alone is not what fails): @error an update that is refused for its command line takes no lock and leaves none

## acceptance/update-subcommand/update-plan.test.mjs

- RED MISSING_FUNCTIONALITY (scaffold reached): the range starts at the earliest covered day and ends today
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a ledger with a gap starts at its first interval, not after the gap
- RED MISSING_FUNCTIONALITY (scaffold reached): @error only the named source's coverage counts: another source's earlier interval is ignored
- RED MISSING_FUNCTIONALITY (scaffold reached): @error an empty ledger has no baseline: the plan is the refusal, not a guess
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a ledger that covers only another source has no baseline for this one
- RED MISSING_FUNCTIONALITY (scaffold reached): --from overrides the baseline when it is earlier than the first covered day
- RED MISSING_FUNCTIONALITY (scaffold reached): @error --from overrides the baseline when it is later than the first covered day too
- RED MISSING_FUNCTIONALITY (scaffold reached): @error the end is today's UTC day at the first second and at the last second of the day
- RED MISSING_FUNCTIONALITY (scaffold reached): @error the end crosses a month, a year and a leap day correctly
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a --from later than today is a one-day range that the fetch will clamp away, never an inverted one
- RED MISSING_FUNCTIONALITY (scaffold reached): @error the plan clamps to settled days: nothing later than yesterday is fetched
- RED MISSING_FUNCTIONALITY (scaffold reached): @error it never changes the ledger it is handed, whatever the clock says
- RED MISSING_FUNCTIONALITY (scaffold reached): a fetch that covered days is followed by the build
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a fetch that covered no window is still followed by the build, so a build that failed last time heals
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a fetch that failed stops the update
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a fetch that failed partway stops the update even though it committed days
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a failure that carries no code stops the update too
- RED MISSING_FUNCTIONALITY (scaffold reached): both stages succeeded: status 0, a closing line on stdout counting the days fetched, nothing on stderr
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a fetch that covered nothing and a build that succeeded: still status 0, closing line says zero days
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a fetch that failed: status 1, the last stderr line names the fetch and the inner code, nothing mentions the build
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a fetch refusal that carries guidance keeps it in the line
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a fetch failure with no inner code still gives one stage-failed line carrying the detail
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a build that failed after a good fetch: status 1, the line names the build and the inner code, says the fetch is kept and to run update again
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a build failure that carries guidance keeps it in the line
- RED MISSING_FUNCTIONALITY (scaffold reached): @error it never changes the outcome it is handed
- GREEN_TODAY (pins what already holds): @structural update-plan.mjs imports only core modules, uses no node: builtin and declares no class
- RED MISSING_FUNCTIONALITY (an assertion on update behaviour; the CLI already exits 1 for an unknown subcommand, so the exit check alone is not what fails): @structural update accepts exactly --from and --dry-run: no --to, --source or --report

## acceptance/update-subcommand/update-plan-properties.test.mjs

- RED MISSING_FUNCTIONALITY (scaffold reached): @property for any ledger, clock and override the plan is a range with from <= to or the no-baseline refusal, and never throws
- RED MISSING_FUNCTIONALITY (scaffold reached): @property @error the plan is the refusal exactly when there is no override and the ledger holds nothing for the source
- RED MISSING_FUNCTIONALITY (scaffold reached): @property the start is the override when there is one, otherwise the earliest day the ledger covers for the source
- RED MISSING_FUNCTIONALITY (scaffold reached): @property the end is the UTC day of the clock, and never earlier than the start
- RED MISSING_FUNCTIONALITY (scaffold reached): @property the plan clamped to settled days ends no later than the last settled day, or is empty
- RED MISSING_FUNCTIONALITY (scaffold reached): @property @error the order of the intervals never changes the plan
- RED MISSING_FUNCTIONALITY (scaffold reached): @property @error intervals of other sources never change the plan
- RED MISSING_FUNCTIONALITY (scaffold reached): @property @error moving the ledger, the clock and the override by the same number of days moves the plan by that number
- RED MISSING_FUNCTIONALITY (scaffold reached): @property it never changes the ledger it is handed
- RED MISSING_FUNCTIONALITY (scaffold reached): @property the decision is build for every successful fetch, including one that covered no window
- RED MISSING_FUNCTIONALITY (scaffold reached): @property @error the decision is stop for every failed fetch, whatever it committed before failing
- RED MISSING_FUNCTIONALITY (scaffold reached): @property the decision is build exactly when the fetch succeeded
- RED MISSING_FUNCTIONALITY (scaffold reached): @property the status is 0 only for an outcome whose fetch and build both succeeded, and 1 for every other
- RED MISSING_FUNCTIONALITY (scaffold reached): @property @error every failed outcome ends its stderr with one stage-failed line naming the stage that failed, and carries the inner code when there is one
- RED MISSING_FUNCTIONALITY (scaffold reached): @property a successful outcome has an empty stderr and ends its stdout with exactly one closing line counting the days fetched
- RED MISSING_FUNCTIONALITY (scaffold reached): @property @error a failed outcome never prints a closing line on stdout
- RED MISSING_FUNCTIONALITY (scaffold reached): @property it never throws and always gives a status of 0 or 1 with lines of text

## acceptance/update-subcommand/support-builders.test.mjs

- INFRA_GREEN (builders, the composed fake, faults, lock helpers, oracle, generators; unskipped): sends /token to the fake whose refresh token the form carries, and every other path to the service it belongs to
- INFRA_GREEN (builders, the composed fake, faults, lock helpers, oracle, generators; unskipped): answers 404 to a path that belongs to neither service, traces it as none, and sends an unknown refresh token to Gmail, which refuses it
- INFRA_GREEN (builders, the composed fake, faults, lock helpers, oracle, generators; unskipped): keeps the two services' credentials apart: a Gmail access token is not accepted by Sheets
- INFRA_GREEN (builders, the composed fake, faults, lock helpers, oracle, generators; unskipped): serves a binary body unchanged, as the loopback server hands it over
- INFRA_GREEN (builders, the composed fake, faults, lock helpers, oracle, generators; unskipped): splits the plan into a cache and a mailbox with distinct message ids, and writes the ledger it is told to, counting the cached messages inside each interval
- INFRA_GREEN (builders, the composed fake, faults, lock helpers, oracle, generators; unskipped): leaves no ledger file for null, an empty ledger for an empty list, and another source's interval when told
- INFRA_GREEN (builders, the composed fake, faults, lock helpers, oracle, generators; unskipped): gives a Sheet that holds the cache by default, so a run with nothing new sends no data batch, and one with headers only when asked
- INFRA_GREEN (builders, the composed fake, faults, lock helpers, oracle, generators; unskipped): names the adverts of the waiting alerts as the dedup keys the Sheet will carry
- INFRA_GREEN (builders, the composed fake, faults, lock helpers, oracle, generators; unskipped): fetch reads Gmail and build --target sheets then writes the Sheet, both through the front, leaving what update must compose: the alert cached, the day covered, the adverts in the Sheet
- INFRA_GREEN (builders, the composed fake, faults, lock helpers, oracle, generators; unskipped): reports a covered range as already covered without contacting Gmail, and a day that has not ended as nothing settled
- INFRA_GREEN (builders, the composed fake, faults, lock helpers, oracle, generators; unskipped): stops the clock in the subprocess: the same fetch covers one more day an instant after midnight
- INFRA_GREEN (builders, the composed fake, faults, lock helpers, oracle, generators; unskipped): records the days Gmail was asked for, in order, from each listing's query
- INFRA_GREEN (builders, the composed fake, faults, lock helpers, oracle, generators; unskipped): refuses listings only from the day it is told, only while it is on, and a switched-off fault lets the same run succeed
- INFRA_GREEN (builders, the composed fake, faults, lock helpers, oracle, generators; unskipped): refuses the Sheet's data batch only while it is on, and the build then succeeds and writes
- INFRA_GREEN (builders, the composed fake, faults, lock helpers, oracle, generators; unskipped): finds a process id that really is dead, and knows the test's own is alive
- INFRA_GREEN (builders, the composed fake, faults, lock helpers, oracle, generators; unskipped): leaves the lock as a running update would: the pid as digits at .cache/update.lock, and nothing else under .cache/ changes
- INFRA_GREEN (builders, the composed fake, faults, lock helpers, oracle, generators; unskipped): reads a week's files as digests, so a run that changes nothing is provably byte-identical
- INFRA_GREEN (builders, the composed fake, faults, lock helpers, oracle, generators; unskipped): does day arithmetic across a month, a year and a leap day
- INFRA_GREEN (builders, the composed fake, faults, lock helpers, oracle, generators; unskipped): names the day of the stopped clock and the last day that has ended before it
- INFRA_GREEN (builders, the composed fake, faults, lock helpers, oracle, generators; unskipped): reach a ledger with no baseline, a baseline, an override, and an override later than today
- INFRA_GREEN (builders, the composed fake, faults, lock helpers, oracle, generators; unskipped): reach the first and the last millisecond of a day, a leap day and a year end
- INFRA_GREEN (builders, the composed fake, faults, lock helpers, oracle, generators; unskipped): reach every stage outcome: a good fetch with no windows, a good fetch with some, a failure with and without a code, a failure that committed days, and a failed build
