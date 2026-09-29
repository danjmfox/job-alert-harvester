# Next: `gmail-api-source`

Give the CLI its own Gmail credential so fetching runs without an agent in the data path.

This is the successor DR-0003 (the agent couriers paths, not records) named on day one: *"Every agent-mediated port in this project ships with its named API successor."* `MessageSource` was specified with two adapters — `raw-spill-source` (interim, agent in the loop) and `gmail-api-source` (target, agent absent) — so the swap should touch no core module and no CLI subcommand beyond wiring.

## Why now

Fetching is the only step that still needs a Claude session. Everything else — parse, dedup, merge, report — is plain `node` and costs nothing. Closing this makes the harvest runnable on a schedule.

## State to resume from

- Coverage: `2026-09-01 … 2026-09-15`, one interval, 64 messages cached
- `plan-fetch` next offers `2026-09-16`; roughly 13 days and ~40 messages outstanding as of 2026-09-29
- The whole cache is merged into the tracker: 164 jobs, 114 companies, 10 saved searches
- Nothing is half-done: the interim skill stops cleanly between windows
- Already built and green without the credential: `gmailWindowQuery` (window to Gmail
  query, `src/core/gmail-query.mjs`) and `runFetchLoop` (the credential-owning loop,
  `src/cli/fetch-loop.mjs`). What is left is the HTTP adapter behind `MessageSource`
  and a `fetch` subcommand that wires these three together.

## What the user provides

1. A Google Cloud project with the Gmail API enabled.
2. Either a service account with domain-wide delegation, or an OAuth client plus a one-off consent to mint a refresh token.
3. The credential kept outside the repo — `.cache/` is gitignored, or an env var. **Never committed**; the repo is public.

## What to build

- `src/adapters/gmail-api-source.mjs` implementing the same `MessageSource` port as `raw-spill-source.mjs`, including its `probe()` contract (DR-0003): credentials resolve, the label/query resolves, quota is not already exhausted.
- A `fetch` subcommand wiring it in `src/cli/harvest.mjs`, so the loop becomes one command:
  `node src/cli/harvest.mjs fetch --source linkedin --from <d> --to <d>`
- Keep the window discipline: `plan-fetch` hands out at most one UTC day (DR-0002), and coverage commits only when the count check passes — the fail-closed guarantees must not weaken just because the agent is gone.

## Constraints that still bind

- `src/core/` stays pure; all I/O in `src/adapters/`.
- `build` derives from the whole cache, never a window (DR-0009) — unchanged by this work.
- New dependency required (`googleapis` or equivalent): the first since `xlsx` and `vitest`. Weigh it deliberately, and note it here.
- Acceptance tests first, as everything else in this project: the adapter's probe contract and the fetch loop's fail-closed behaviour are the things worth pinning, not the HTTP calls.

## Worth doing at the same time

DR-0005 (the target sheet is a plan-executing port) notes the Sheets API adapter shares this credential work, and that doing both together is cheaper than either alone. That one would remove the manual download/upload step, and with it the stale-upload hazard the warning currently only makes visible.
