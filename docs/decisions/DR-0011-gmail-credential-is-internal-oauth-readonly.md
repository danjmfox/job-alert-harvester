---
id: DR-0011
status: proposed
dateCreated: 2026-09-29
domain: job-alert-harvester
refines: DR-0003
changelog:
  - date: 2026-09-29
    version: 0.1.0
    note: Initial draft — credential shape for the gmail-api-source adapter
  - date: 2026-09-29
    version: 0.2.0
    note: Token storage settled as a mode-0600 file under ~/.config/job-alert-harvester/
  - date: 2026-09-29
    version: 0.3.0
    note: >-
      DESIGN amendments — a third REST call (users/me/profile) for a wrong-mailbox check;
      the permission rule made precise (no group/other bits, 0700 directory)
---

# The CLI's Gmail credential is an Internal OAuth Desktop client, read-only, over native fetch

## Context

DR-0003 named `gmail-api-source` as the successor to the agent-mediated spill path: the CLI gets its
own Gmail credential so fetching runs with no agent in the data path. This record fixes the shape of
that credential. It does not change DR-0003's rules 1-3 or DR-0002's window discipline.

The constraints that shape the choice:

- The mailbox is `daniel@daedaluscoaching.com`, a Google Workspace account, and receiving job alerts is
  its primary purpose. One user, one mailbox, one machine.
- The repository is public. No secret may be committed, and `.cache/` holds personal history.
- The fetch is meant to run on a schedule, so a token that silently expires weekly is a defect.
- The project has held to `xlsx` as its only runtime dependency (Cognitive Load Tax).

## Options Considered

### Credential type

**Option 1: Service account with domain-wide delegation.**
No browser step, but it needs Workspace admin delegation and a long-lived key JSON that can
impersonate any user in the domain. Far more authority than reading one mailbox needs.
Rejected.

**Option 2: OAuth client, External audience.**
Works for any Google account. While in "Testing" the refresh token expires after 7 days; in
"In production" it does not, but the app shows an unverified-app warning and `gmail.readonly` is a
restricted scope. Workable, but pays costs the Workspace mailbox does not need to pay.

**Option 3: OAuth client, Internal audience, Desktop type. (chosen)**
Available because the project sits in the `daedaluscoaching.com` organisation. No verification, no
unverified-app warning, no 7-day expiry, no test-user list. One browser consent, then no browser.

### Scope

`gmail.readonly` only. Fetching needs no more. `gmail.modify` would let a bug or a leaked token
relabel or trash mail; read-only makes the worst case disclosure rather than damage. A Sheets scope
(DR-0005) is a separate consent, added when that adapter is built.

### Consent flow

Loopback redirect on `127.0.0.1` with a random port, PKCE (`S256`) and a `state` check. The
out-of-band flow is deprecated by Google, and the device flow does not permit Gmail scopes.

### Transport

**`googleapis` / `google-auth-library`:** large dependency trees for two operations: the token
exchange and `users.messages.list`/`get`. **Native `fetch` (Node 22):** a small hand-written token
exchange and three REST calls (`users.messages.list`, `users.messages.get`, and `users/me/profile`
to confirm the token belongs to the mailbox recorded at `auth`). **Chosen: native `fetch`**, keeping runtime dependencies at one. The
cost is that token refresh and error mapping are ours to write and test.

### Token storage

The client JSON and refresh token live **outside the repo**, never under version control, as
mode-`0600` files under `~/.config/job-alert-harvester/`. The keychain (`security`) is safer at rest,
but a file is simpler to fake in an acceptance test and keeps the adapter free of a macOS-only
dependency. The adapter refuses to read a credential file that carries any group or other permission bit, and
requires the directory to be `0700`.

## Decision

Use an **Internal-audience OAuth Desktop client** with the **`gmail.readonly`** scope, obtained by a
**loopback + PKCE** consent run through a new `auth` subcommand, and call the Gmail REST API with
**native `fetch`**. The refresh token is stored in a `0600` file under `~/.config/job-alert-harvester/`.

Behaviour the acceptance tests must pin, in the project's fail-closed style:

- `probe()` (DR-0003) refuses to start when credentials are missing, the token cannot refresh, or the
  query does not resolve. It does not half-finish.
- A token that belongs to a different mailbox than the one recorded at `auth` is a named refusal
  (`gmail.wrong-mailbox`).
- A revoked or expired refresh token (`invalid_grant`) surfaces as a named refusal telling the
  operator to re-run `auth`, never as a raw HTTP error or an empty fetch.
- An empty result is not a pass: coverage commits only when the count check passes (DR-0002), exactly
  as with the spill source.
- No credential value appears in output, logs, or the cache.

## Consequences

- One new subcommand (`auth`) and one new adapter; `src/core/` is untouched and stays pure.
- Runtime dependencies stay at one; the hand-written OAuth code becomes the project's responsibility.
- The token can still be revoked by a password change or an Admin action, so re-consent must be a
  clean, documented path rather than an incident.
- A Sheets adapter later needs a second consent for a wider scope; it does not reuse this token.

## Exceptions

Revisit this record if any of these hold:

- The alert mailbox moves to a personal Gmail account, or the project leaves the Workspace
  organisation (Internal is then unavailable; fall back to Option 2 in production mode).
- Fetching needs to write to the mailbox (labels, archive), which requires a wider scope and its own
  record.
- The hand-written token handling grows past the three operations above, at which point the dependency
  tradeoff should be reweighed.
- The harvester runs anywhere other than the operator's own machine, where a Desktop client and
  loopback consent no longer fit.
