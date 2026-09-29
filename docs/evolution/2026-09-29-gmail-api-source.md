# gmail-api-source — Evolution Record

**Type**: Explanation. **Finalized**: 2026-09-29. **Workspace**: `docs/feature/gmail-api-source/` (kept as delivery history; `deliver/roadmap.json` and `deliver/execution-log.json` committed).

## What shipped

The CLI now owns its Gmail credential, so the agent leaves the data path. `MessageSource` is unchanged; `gmail-api-source` is its second adapter.

- **Subcommands**: `auth` (one-off consent) and `fetch` (`--source --from --to`) in `src/cli/`.
- **Adapters**: `gmail-api-source`, `credential-store` (mode-0600 files under `~/.config/job-alert-harvester/`), `google-token-source`, `oauth-loopback` (one-shot `127.0.0.1` listener).
- **Pure core**: `oauth` (consent URL, PKCE, token forms, base64url), `retry-policy` (incl. `Retry-After` parsing), `endpoints` (loopback-only override), `gmail-message` (Gmail resource to cache record).
- **Async fetch loop**: `runFetchLoop` awaits the source; coverage still commits fail-closed per UTC day.
- **Settled-day clamp**: `clampToSettledDays` in `core/coverage.mjs` caps `--to` at yesterday UTC.

Full suite at close: 39 files, 383 tests green. 13/13 steps traced by `des-verify-integrity`. Adversarial review: approved, 0 findings.

## Decisions and where they live

- DR-0011 (Gmail credential: internal OAuth, read-only) v0.4.0, status **`proposed`**: `docs/decisions/DR-0011-gmail-credential-is-internal-oauth-readonly.md`.
- `docs/feature/gmail-api-source/feature-delta.md`: Design Decisions (GD-01..GD-12), Open Questions (async loop, HTTP test seam, retry policy, settled-day clamp, Sheets deferral, DR-0011 wording), and the DR-0011 flags list.
- Product-level summary: `docs/product/architecture/brief.md` section 12.

## Process facts worth keeping

- DISCUSS was skipped by instruction; DEVOPS is `NOT_APPLICABLE` (local CLI, one operator).
- Two human-approved test edits, both in `tests/acceptance/job-alert-harvester/fetch-loop.test.mjs`: the two `toThrowError` assertions became `rejects.toThrowError`, plus four `async`/`await` call-site edits. Assertions unchanged in meaning.
- The walking-skeleton ledger expectation was amended to the merged interval, because the ledger merges day-adjacent coverage. Human-approved.
- The DISTILL scenario count table was corrected after the fact.
- Step 02-03 was logged RED without the failure being observed; DISTILL had already classified those scenarios RED for the right reason (`distill/red-classification.md`).
- Mutation testing skipped per the project's `nightly-delta` strategy. Refactor pass: 2 commits.

## Not done

- **Real-response parity check** (`scripts/gmail-parity-check.mjs`): run on 2026-09-29 against all 64 cached messages with the operator's credential. Sender, subject, date and snippet matched throughout. One message differed at the job level (a title with an inner double space; the API preserves source whitespace, the connector had collapsed it); fixed in the parser by `fix(parse-linkedin): collapse inner whitespace` and re-checked, after which `extractJobs` matches. The `plaintextBody` still differs by design: the API text carries CRLF and indentation, and the connector text had corrupted some tracking-URL characters (an `=d5` parameter became a replacement character); the API side is the faithful one. DESIGN flag 6 (sender and body parity) is closed at the parse-output level; the script treats the body as informational. Only the one message was re-run after the fix; the other 63 passed before it and the fix is a no-op on single-spaced text.
- **Sheets adapter**: deferred; needs a wider scope, a second consent and its own decision record.
- **DR-0011 not ratified**: still `proposed`, not `accepted`.
- **`xlsx` advisories** and **CI**: unchanged project-level open items.
