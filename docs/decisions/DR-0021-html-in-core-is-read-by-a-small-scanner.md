---
id: DR-0021
status: accepted
dateCreated: 2026-10-26
domain: job-alert-harvester
relatedTo: [DR-0006, DR-0013, DR-0019, DR-0020]
changelog:
  - date: 2026-10-26
    version: 0.1.0
    note: Drafted by the DESIGN wave of welcome-to-the-jungle-source. Frames a new-dependency question; awaits the human's decision. Not accepted.
  - date: 2026-10-27
    version: 1.0.0
    note: Accepted by the human on 2026-10-27 as the DESIGN architect recommended it.
---

# HTML in `src/core` is read by a small scanner for known templates, not a library

## Context

`src/core` is pure: no classes, no mutation, no `node:` builtins (DR-0013). Nothing in `src/` reads HTML today, and `package.json` has one runtime dependency, `xlsx`, imported only by two adapters. The Welcome to the Jungle alert is a Stripo-generated document: each advert is a table wrapped in an anchor, and the company, tagline, title and optional salary and location sit in fixed paragraph positions.

The dependency-cruiser rules forbid `node:` builtins in core but do not forbid npm packages, and none is imported there now.

Standing practice is to treat a new library as a cognitive load tax. The process also holds Gmail and Sheets credentials, and the HTML comes from a third party.

## Options Considered

### Option A: a small scanner in `src/core` for known templates (proposed)

A total function from an HTML string to an element tree, or to a refusal. It ignores comments (including Outlook conditional comments) and style bodies, decodes entities from a closed table, and refuses on an unknown entity or unbalanced tags. No selector engine: the card reader walks the tree.

- Advantage: no new dependency; fails loudly on anything unfamiliar; testable with the existing `fast-check`.
- Disadvantage: the project owns tokenizer edge cases. A missed entity (for example a pound sign written as an entity) would otherwise silently blank a salary, which is why unknown entities refuse.

### Option B: a library such as `parse5` or `htmlparser2`

I believe both are MIT-licensed and actively maintained; I could not verify this (no shell).

- Advantage: correct on malformed HTML; less owned code.
- Disadvantage: a second runtime dependency in the credential-holding process, a new API to learn, and an unguarded door into core until a rule is added.

### Option C: parse at the adapter edge and cache the result

- Advantage: keeps core free of a scanner.
- Disadvantage: still needs a parser, and forces the structured cache that DR-0020 argues against.
- Verdict: rejected.

## Decision

Proposed: Option A, with a stated trigger to move to Option B.

1. The scanner lives in `src/core/html-scan.mjs`; the card reader in `src/core/parse-wttj.mjs` uses it.
2. A new dependency-cruiser rule forbids `src/core` from importing any npm package, with a fixture in the layering test that proves the rule reports (as DR-0013 does for the others).
3. A property over the descriptor: whatever the sender's screen accepts, the extractor reads without error.
4. Trigger to revisit: a second HTML-only sender, or the first scanner defect found in dogfood. Adopting a library then means changing rule 2 to an allow-list.

## Exceptions

Revisit if the scanner grows beyond what one template needs, if a defect reaches the Sheet, or if a verified, dependency-free library offers a smaller owned surface.
