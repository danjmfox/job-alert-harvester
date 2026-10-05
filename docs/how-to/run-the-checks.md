# Run the checks

Doc type: How-To

Goal: run the automated test suite and the layering check before you change code, and run the operator-only live scripts when their triggers apply.

There is no continuous integration. These checks run only when you run them.

## Before you start

- Node 22 or later, and `npm install` done in the repository root.
- For the two live scripts only: the credentials from [Set up Google Cloud credentials](set-up-google-cloud.md).

## Run the automated checks

1. Run the suite:

   ```bash
   npm test
   ```

   `npm test` first runs `npm run check:arch` through the `pretest` script. If the layering check fails, the tests do not start.

2. Run the layering check alone when you only need that:

   ```bash
   npm run check:arch
   ```

3. Keep the tests running while you edit:

   ```bash
   npm run test:watch
   ```

4. Read a layering failure. It names the broken rule and the two files involved. Fix the import, not the rule.

## Add or change a fixture

1. Copy a real message record into `fixtures/`.

2. Replace names, home locations and every per-recipient tracking token (`otpToken`, `midToken`, `trk`, `lipi` and similar) with `REDACTED`.

3. Never restore realistic-looking values. The repository is public, and such values would put personal data back into it.

4. Never copy anything from `.cache/` into the repository. `.cache/` holds your personal job-search history and is gitignored.

## Run the live Sheets check

Run `scripts/sheets-live-check.mjs` when you need to re-verify what Google's Sheets and Drive APIs actually do, for example after changing the Sheets adapter, the request builder or the transport, or when Google's behaviour seems to have changed. It calls the real Google APIs, so it is never part of `npm test`.

1. Rehearse offline first. This needs no credential:

   ```bash
   node scripts/sheets-live-check.mjs --self-test
   ```

   The last line reads `self-test: <n> checks passed`.

2. Run the full check:

   ```bash
   node scripts/sheets-live-check.mjs
   ```

3. **Yours to do (browser):** Open the printed consent URL and approve `drive.file`.

4. Read the `| id | verdict | evidence |` table and the last two lines (`scratch Sheet deleted`, `fixtures written`).

5. To re-run only some probes, name them (assumption ids A1 to A19, ledger ids L01 to L20, and `S1`, the check that about 3,050 single-cell updates plus an appended header are accepted in one batch on a 26-column grid):

   ```bash
   node scripts/sheets-live-check.mjs --only A12,L13
   ```

   `S1` is the check to run before the first real build that adds the `Role Family` column. The loopback fake models no request-count ceiling, so its offline run proves only the code path.

6. Review `git status`. The script rewrites `docs/feature/sheets-api-target/deliver/live-fixtures.json`.

## Run the Gmail parity check

Run `scripts/gmail-parity-check.mjs` when you change how a Gmail API message becomes a cache record, or to confirm the API path yields the same record and the same extracted jobs as a message already in the cache. It calls the live Gmail API and never prints a token or a message body.

1. Confirm `node src/cli/harvest.mjs auth` has succeeded and the cache holds mail.

2. Run it on the first cached message, or name a message id:

   ```bash
   node scripts/gmail-parity-check.mjs
   node scripts/gmail-parity-check.mjs <message-id>
   ```

3. Read the per-field `same` or `DIFFERENT` lines. The last line is `parity: <id> matches` or `parity: <id> DIFFERS`. The `plaintextBody` field is informational; it does not decide the verdict.

## Why

**What the layering check enforces.** `.dependency-cruiser.cjs` holds six rules: `src/core` imports no `node:` builtin, no adapter and no CLI module; an adapter imports no other adapter; `gmail-api-source`, `sheets-target` and `sheet-provisioner` import no `node:` module; and nothing in `src/` is circular. A second test, `tests/architecture/layering.test.mjs`, checks each rule against a deliberately broken tree so a misconfigured rule cannot pass silently. See DR-0013 (dependency-cruiser enforces layering).

**What it cannot check.** That only the credential stores touch `~/.config`, that every stateful adapter exports a `probe`, and that the Gmail and Sheets adapters cannot build a write request. Ordinary tests cover those.

**Fixtures are redacted.** The rule protects a public repository from personal data.

## If it goes wrong

| You see | Do this |
|---|---|
| `dependency-cruiser did not run` in a test failure | Run `npm install`; the tool is missing from `node_modules`. |
| A layering rule name such as `core-imports-no-node-builtin` | Move the I/O into `src/adapters/` and pass it in as an argument. |
| `HINT: enable the Google Sheets API` (or `Drive API`) from the live check | Enable the API in the Google Cloud project, then run again. |
| `HINT: drive.file is missing from the consent screen` | Add the scope to the consent screen, then run again. |
| Live check prints `the scratch Sheet was NOT deleted` | Delete the file named `harvester-live-check-<timestamp>` from Drive by hand. |
| Live check exits with status 2 and a `usage:` line | Use only `--self-test` or `--only <ids>`. |
| `parity: no cached message ... under .cache/messages` (exit 2) | Fetch mail first, or pass an id that is in the cache. |
| `gmail.credential-missing` and similar from either script | See [Set up Google Cloud credentials](set-up-google-cloud.md). |
