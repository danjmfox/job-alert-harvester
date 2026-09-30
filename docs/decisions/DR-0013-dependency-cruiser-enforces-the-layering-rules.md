---
id: DR-0013
status: accepted
dateCreated: 2026-09-30
domain: job-alert-harvester
realises: D-20 in docs/feature/job-alert-harvester/feature-delta.md
changelog:
  - date: 2026-09-30
    version: 1.0.0
    note: Accepted by the human on the day the gap was found; adopts dependency-cruiser and pins it with a test

---

# dependency-cruiser enforces the layering rules, run by the test suite

## Context

The first feature locked a decision (D-20 in its feature-delta): "dependency-cruiser enforces core purity in CI". It was never implemented. The tool is not in `package.json`, there is no `.dependency-cruiser.cjs`, and there is no CI. The brief's section 9 described the tool as if it were running.

The gap was found on 2026-09-30 while reviewing the Sheets feature, when a reviewer cited the tool as enforcing the rules and it turned out not to exist. Until then the rules were held by convention, review, and two per-feature structural tests (`probe-presence` in the Gmail and Sheets features).

The rules that matter, from the brief and the two shipped features:

- `src/core/**` imports no `node:` builtin.
- `src/core/**` imports nothing from `src/adapters/**` or `src/cli/**`.
- `src/adapters/**` imports no other adapter.
- No circular dependency anywhere in `src/`.
- `gmail-api-source`, `sheets-target` and `sheet-provisioner` import no `node:` module (they receive capabilities as arguments).

## Options Considered

### Option 1: Retire D-20 and rely on convention and the structural tests

No new dependency. The rules stay checkable only for the modules a test names, and a new adapter can break a rule without any test failing.

### Option 2: Adopt dependency-cruiser, run by the test suite (chosen)

One dev-only dependency. The import-graph rules become a single configuration file. There is still no CI, so enforcement has to live where the operator already runs checks: a vitest test runs the tool over `src/` and fails on any violation, and a `pretest` script runs it first.

### Option 3: Adopt it and add CI at the same time

The right long-term shape, but CI is a separate decision with its own cost, so it is not bundled here.

## Decision

Adopt **dependency-cruiser** as a dev dependency, with the rules above in `.dependency-cruiser.cjs`.

- **The rules bite.** A vitest test runs the tool against `src/` and fails on any violation. A second test runs it against a small fixture tree that deliberately breaks each rule and asserts that each rule reports. Without the second test a misconfigured rule would pass silently.
- **`npm run check:arch`** runs the tool on its own, and **`pretest`** runs it before `npm test`.
- **What it cannot check** stays with tests: that only the credential stores touch `~/.config` (a path, not an import), that every stateful adapter exports a `probe`, and that the Gmail and Sheets source adapters cannot construct a non-GET or write-class request.
- Cognitive Load Tax: one dev dependency with one configuration file. Accepted by the human.

## Consequences

- A change that breaks a layering rule fails `npx vitest run`, not just review.
- The brief's section 9 is true again; the notes added on 2026-09-30 saying the tool is not installed are removed.
- The tool's own rule syntax is a new thing to learn when a rule needs changing.
- CI remains absent; this record does not add it.

## Exceptions

Revisit if the tool produces false positives that cost more than they save, if it stops being maintained, or when CI is added (the `pretest` script and the test then run there too).
