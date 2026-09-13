---
id: DR-0007
status: accepted
dateCreated: 2026-09-13
domain: job-alert-harvester
refines: DR-0003
changelog:
  - date: 2026-09-13
    version: 1.0.0
    note: Emerged from use — a live harness probe showed the spill contract assumed by DISTILL does not exist
---

# The spill contract is what the harness actually writes

## Context

DR-0003 (agent couriers paths, never records) moves Gmail data from the connector to the CLI by
filesystem: the harness spills each large tool result to disk, and `harvest ingest --raw <dir>` globs
that directory. Its fragility assessment was explicit that this couples to harness behaviour "that is
not a published contract".

DISTILL modelled that behaviour with a synthetic builder, `aSpillPayload()`, returning
`{ result: <message> }` and written to files named `*.json`. `raw-spill-source` and `slim` were built
to that shape, and all 63 passing tests passed against it.

On 2026-09-13 one real LinkedIn alert was fetched and the harness's own spill file run through the
committed CLI:

| Probe | Input | Result |
|---|---|---|
| A | spill file exactly as the harness wrote it | `spill.count-mismatch: expected 1, found 0` — exit 1 |
| B | renamed to `.json`, content unchanged | `spill.missing-plaintext-body` — exit 1, although the body is present (6,107 chars) |
| C | renamed to `.json` **and** wrapped in `{result: …}` | exit 0; 1 message cached; one coverage interval committed |

Observed harness contract (2.1.220 (Claude Code)):

- **File name:** `mcp-<connector-id>-get_message-<epoch-ms>.txt` — `.txt`, not `.json`
- **Directory:** the session's `tool-results/` directory, **shared with unrelated tool output** — a
  non-Gmail `bzw5n4z7j.txt` sat beside the message
- **Payload:** a flat JSON message object with no wrapper, keys `date, historyId, htmlBody, id,
  internalDate, labelIds, plaintextBody, sender, sizeEstimate, snippet, subject, threadId, toRecipients`

Both failures refused and wrote nothing, as DR-0003 designed. The design held. The test model of the
harness was invented — in the one place DR-0003 had already named as fragile.

## Options Considered

### Option 1: Adapter reads the real shape — *chosen*

- **What:** select files by the harness's spill name, read flat JSON, rebuild the test model from a real
  spill file.
- **Advantage:** the tests describe what the harness produces, so a green suite means the real path works.
- **Disadvantage:** tests that passed against the invented shape go RED until the adapter follows.

### Option 2: Accept both shapes

- **Advantage:** smallest change; nothing currently green breaks.
- **Disadvantage:** the invented shape stays in the contract permanently — supported, tested, and never
  produced by anything. Drift with a passing test attached.
- **Verdict:** rejected.

### Option 3: The skill normalises spill files

- **Disadvantage:** the agent would open and rewrite record content, and the skill would carry format
  knowledge it could drift from.
- **Verdict:** rejected by DR-0003 Rule 1 (data moves by filesystem, never through context).

## Decision

**`MessageSource` reads what the harness writes, and the tests are built from what the harness writes.**

1. **Selection.** Only files matching `mcp-*-get_message-*.txt` are candidates. Every other file in the
   directory is ignored and does not count toward `--expect`. The connector id is matched by wildcard,
   never hard-coded.
2. **Payload.** A candidate file's JSON is the message itself. There is no wrapper.
3. **Refusals name the file and say what is actually wrong:**
   - not JSON → `not-json`
   - JSON without the message envelope (`id`, `date`, `sender`) → `not-a-message`
   - a message whose `plaintextBody` is absent or empty → `missing-plaintext-body`

   Probe B — reporting a missing body that was present — is the misattribution this ordering removes.
4. **Extra keys are expected and dropped.** `slim` keeps exactly `date, id, plaintextBody, sender,
   snippet, subject`; the cached record shape is unchanged (DR-0002 fixture parity).
5. **The test model is copied, not composed.** The spill fixture is a real spill file copied from disk by
   script — `htmlBody` truncated, recipient redacted, nothing else edited. Builders derive from it rather
   than describing the harness from memory.
6. **DR-0003 Rule 2 is unchanged.** The filename's connector id and timestamp are never keys; records are
   keyed by the `id` inside the payload.

## Consequences

- `src/adapters/raw-spill-source.mjs` and `src/core/slim.mjs` change; the CLI does not.
- Acceptance and adapter integration tests built on the invented shape change to the real one. Those
  that passed against the invention go RED until the adapter follows — an intended RED, because the
  previous GREEN was measuring fiction.
- The probe above (fetch one message, run A–C) is the re-validation procedure for any harness upgrade.

## Exceptions

Revisit if:

- **The harness renames, relocates or re-wraps spill files.** Expected to fail closed with
  `count-mismatch` or `not-a-message`; re-run the probe and amend this record.
- **A message stops spilling.** Results under the harness's size threshold come back inline instead of
  being written to disk. LinkedIn alerts fetched with `FULL_CONTENT` carry 50 KB+ of HTML and have always
  spilled, but a small one would land in the agent's context — a DR-0003 Rule 1 breach — and leave no
  file, so ingest refuses on count. The skill must not work around that by transcribing.
- **The Gmail API adapter lands** (DR-0003's named successor). The spill contract retires with the
  raw-spill adapter.
