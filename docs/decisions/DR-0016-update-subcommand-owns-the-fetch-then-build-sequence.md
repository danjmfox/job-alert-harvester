---
id: DR-0016
status: accepted
dateCreated: 2026-10-05
domain: job-alert-harvester
relatedTo: [DR-0001, DR-0009, DR-0012, DR-0013, DR-0015]
changelog:
  - date: 2026-10-05
    version: 1.2.0
    note: Amended by the human after the adversarial review (a preview that cannot read the ledger fails at a plan stage; the stale-lock race is accepted and recorded in Exceptions)
  - date: 2026-10-05
    version: 1.1.0
    note: Amended by the human during DELIVER with four rulings on cases DESIGN left open (override rescues an empty ledger, a preview ignores the lock, an unreadable lock, ledger or cache is a stage failure) and one reversal (the nothing-new line stays before a failing build, because it precedes the build's output)
  - date: 2026-10-05
    version: 1.0.0
    note: Accepted by the human together with the eleven DESIGN open questions of update-subcommand (Q-a to Q-k), taken as recommended
---

# `harvest update` owns the fetch-then-build sequence and fails closed

## Context

The harvester keeps a local cache of LinkedIn job-alert mail. `harvest fetch` pulls new mail from Gmail into the cache and records the covered UTC days in a coverage ledger. `harvest build --target sheets` derives the tracker from the whole cache and writes it to the operator's Google Sheet (DR-0009). The operator brings the tracker up to date with two commands and a date worked out by hand: `fetch --source linkedin --from <first day> --to "$(date -u +%F)"`, then `build --target sheets`.

The operator wants to run this on a schedule. Two facts make that safe. A fetch over an already-covered range prints "already covered", exits 0 and makes no Gmail call, so a fixed `--from` is idempotent. `fetch` clamps `--to` to settled UTC days, so passing today's date is safe. Two facts make it risky. A build after a failed or partial fetch writes a tracker from a cache known to have a gap. A Sheets build is a write: a human sort, insert or delete during that write can misdirect a harvester-owned column (DR-0012), so the schedule has to avoid the operator's working time.

The decision adds a command contract (a new subcommand, new refusal codes, a sequencing rule) and changes the return value of an existing stage, `runFetch`. `src/core` must stay pure and free of `node:` builtins (DR-0013), so the sequencing logic and the clock-dependent range choice need a home that respects that.

## Options Considered

### Option A: A `harvest update` subcommand with pure planning in core and the effects injected by the shell (chosen)

- **What:** `harvest update [--from <d>] [--dry-run]` plans the range from the ledger and the clock, runs the fetch stage, decides from its result whether to build, runs the build stage, and summarises. A pure core module chooses the range, decides the next step and maps the outcome to an exit status. A shell module in `src/cli` receives the fetch and build stages as functions.
- **Advantage:** the sequencing and date arithmetic live in one tested place, are testable through the existing Gmail and Sheets loopback fakes, and run identically by hand and under a scheduler.
- **Disadvantage:** `runFetch` must return a result (`windowsCommitted`), and the shell cannot import `harvest.mjs` because it dispatches at top level, so the stages are injected.

### Option B: A wrapper script that runs the two commands

- **What:** a shell script computes the date and runs `fetch && build`.
- **Advantage:** no change to the CLI.
- **Disadvantage:** the sequencing and the date arithmetic stay untested, and each operator re-derives them. Rejected by the human on 2026-10-05.

### Option C: Make `build --target sheets` fetch first

- **What:** add a `--fetch` flag to `build`.
- **Advantage:** no new subcommand.
- **Disadvantage:** `build` is a pure derivation of the cache (DR-0009) and would gain a network side effect and a second failure mode. Rejected.

## Decision

**A new subcommand `harvest update [--from <d>] [--dry-run]` runs fetch and then, only if the fetch succeeded, `build --target sheets`. A failure at either stage exits 1.**

1. **Sequence.** Plan (pure), fetch (effect), decide (pure), build (effect), summarise (pure). Core holds plan, decide and summarise in `src/core/update-plan.mjs`. The shell in `src/cli/update.mjs` takes the two stages as injected functions. `--to` is the clock's today (UTC); the fetch stage clamps it to settled days. The option table gains `update: { from: VALUE, 'dry-run': FLAG }`, with `--from` validated like `fetch`. There is no `--to`, `--source` or `--report`.
2. **Codes (Q-a).** Every failure exits 1. One code, `update.stage-failed`, names the stage and carries the inner code in its detail. A build failure after a good fetch says the fetch is kept and to run `update` again. Two further codes: `update.no-baseline` (Q-g) and `update.already-running` (Q-f).
3. **Nothing new (Q-b).** Print one line, `harvest update: nothing new from Gmail`, and continue; exit 0. The line precedes the build's own output and stays when the build then fails: it is true of the fetch, and the failure follows on stderr as the `update.stage-failed` line.
4. **Build after a quiet fetch (Q-c).** Always build after a successful fetch, even if it committed no window, so a build that failed on an earlier run heals on the next. A no-change build sends no data batch and does not enter the DR-0012 window.
5. **Partial fetch (Q-i).** Fail closed: no build and exit 1. Committed days are kept and the next run resumes.
6. **Range (Q-g).** `--from` defaults to the earliest covered day for the source in the ledger. An empty ledger refuses with `update.no-baseline` and points to `fetch --from <d>`. `--from <d>` overrides, and an override also rescues an empty ledger: the planner needs only a start day. A gap before the earliest covered day is not noticed by the default; `--from` covers it.
7. **`--dry-run` (Q-h).** Plans the range, counts uncovered days from the ledger and runs `build --target sheets --dry-run`. It holds no fetch capability, so it makes no Gmail call and no write. A preview ignores the run lock: it never takes the lock and is never refused because one is held.
8. **Lock (Q-f).** An exclusive-create `.cache/update.lock` holding the pid. A stale lock is recovered by a liveness check on that pid. Contention refuses with `update.already-running`. The lock is the only new adapter and imports `node:fs` only. An unreadable lock file, ledger or `.cache/` is a stage failure like any other: it exits 1 through `update.stage-failed` naming the stage that met it, with the inner code. A real run names the ledger's stage `fetch`; a preview, which never fetches, names it `plan`.
9. **Logging (Q-d).** No harvester code. The how-to points launchd's `StandardOutPath` and `StandardErrorPath` at `.cache/logs/`, which is already gitignored, and includes a `mkdir -p`.
10. **Notification (Q-e).** No harvester code. A short `sh` wrapper in the how-to runs `update` and, on a non-zero exit, calls `osascript` with the last stderr line. Nothing darwin-specific enters `src/`.
11. **Reauth (Q-k).** No special handling. `gmail.reauth-required` already says to run `harvest auth`; it reaches the last stderr line through `update.stage-failed` and then the notification.
12. **Scheduler (Q-j).** A how-to documents a macOS LaunchAgent, not cron: absolute paths to `node` and to `harvest.mjs`, `WorkingDirectory` set to the repository root (`.cache/` resolves against it), a `StartCalendarInterval` example of 05:30 chosen for being outside the operator's Sheet time, and `launchctl bootstrap` and `kickstart` for loading and testing. Paths and the label are placeholders.
13. **Output streams.** stdout carries stage progress and a final summary line. stderr carries refusals and the build's existing role-family and search-yield views (DR-0015).

## Exceptions

Revisit if:

- **A scheduler needs to branch on the failing stage without parsing text.** Distinct exit codes per stage (Q-a option B) would then be worth a second exit-code vocabulary.
- **Manual runs need logs too.** A harvester-owned log adapter (Q-d option B) would replace the launchd redirect.
- **Notification needs to be uniform across platforms or tested.** An `--notify` flag and an adapter (Q-e option B) would replace the wrapper.
- **A second source is added.** `--source` would then need its own option-table entry and the range default would be chosen per source.
- **The lock proves unnecessary or insufficient.** The design called it the weakest recommendation; a single operator on a quiet schedule can run without it, and a lock around the build only would leave the fetch race.
- **The stale-lock takeover needs to be race-free.** Two runs that find the same stale lock in the same instant can each remove the other's fresh lock after retaking it, and an empty lock file read while its holder is between creating it and writing its pid reads as `lock.unreadable`. Both need two runs to start within microseconds, which a single operator on a daily schedule does not produce, so the human accepted them on 2026-10-05. A takeover by atomic rename to a unique name, with the pid written before the lock becomes visible, would close both. A recycled pid can also make a stale lock look live; no fix is planned.
