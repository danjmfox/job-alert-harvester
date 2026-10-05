---
id: DR-0015
status: accepted
dateCreated: 2026-10-05
domain: job-alert-harvester
refines: DR-0014
relatedTo: [DR-0001, DR-0009, DR-0013]
changelog:
  - date: 2026-10-05
    version: 1.0.0
    note: Accepted by the human together with the nine DESIGN open questions of search-yield-summary, taken as recommended (OQ-6 resolved to "write this record"; OQ-10, title-match share, deferred)
---

# Search yield is derived inside harvest() and printed to stderr, never stored

## Context

The harvester reads LinkedIn job-alert emails. Each email belongs to one saved search, named by the search term on its first line. The operator runs about a dozen saved searches and wants to tighten the noisy ones. An analysis of the cache showed that search quality varies widely: some searches return 6% adverts classified `other` (the Role Family fallback of DR-0014) and some 49%, and a few broad searches find most of the on-target adverts. That analysis needed one-off scripts, so the operator cannot see the effect of editing an alert without asking for another script.

The harvester already holds the facts. `harvest()` parses every message into one row per sighting, each carrying the search term, the advert's dedupKey, the title and the sighting date. It then collapses sightings to one Jobs row per advert, which discards which searches found which advert. Nothing downstream of `harvest()` can recover that, and the three places that print build output (merge, Sheets and `--dry-run`) only see the collapsed rows.

Four earlier records bear on the choice. DR-0001 says to persist only what cannot be re-derived. DR-0009 says `build` derives every row from the whole cache. DR-0013 says `src/core` is pure and imports no `node:` builtin. DR-0014 says an advert's Role Family comes from the title of its first sighting. The operator decided the content before this record: for each saved search, the adverts found, the share classified `other`, and the on-target adverts only that search found, shown on stderr beside the role-family tuning view. This record captures where the figures are computed and why, because adding a key to the object `harvest()` returns changes a core interface.

## Options Considered

### Option A: A pure core function called from `harvest()`, returned as `model.searchYield`, printed by the shell (chosen)

- **What:** a new pure module takes the sighting rows and the collapsed adverts and returns the per-search figures. `harvest()` adds the result to its return value under a new key. The shell prints it to stderr at the three build call sites.
- **Advantage:** `harvest()` is the only place holding both the per-search sightings and each advert's first-sighting title, so the figures agree with the Role Family column by construction. The existing merge path ignores keys it does not know (it plans only the tabs it finds in the model), so the extra key changes nothing else.
- **Disadvantage:** the return value of `harvest()` grows a key that the tracker never writes.

### Option B: The command-line shell re-parses the cached messages to rebuild the figures

- **What:** the shell reads the messages again and derives the per-search figures itself.
- **Advantage:** `harvest()` stays unchanged.
- **Disadvantage:** two parses of the same cache can disagree, and the shell would hold derivation logic that belongs in the core. It would break the rule that `src/cli` composes and does not compute.
- **Verdict:** rejected.

### Option C: Persist the figures as new columns on the Sources tab

- **What:** write adverts found, `other` share and unique count into harvester-owned columns of the Sources tab.
- **Advantage:** the figures would live in the Sheet.
- **Disadvantage:** unique contribution depends on which other searches exist and on the window counted, so the stored value would change every day and would have to be rewritten each run. It adds columns to a tab that existing trackers must gain (DR-0004) and breaks DR-0001, which keeps derived values out of storage unless they cannot be re-derived.
- **Verdict:** rejected.

## Decision

**Search yield is derived inside `harvest()` by a pure function, returned as an additive `searchYield` key, and printed to stderr by `build`. It is never stored.**

1. **Where.** A new pure module in `src/core` computes it from the sighting rows and the collapsed adverts. `harvest()` returns it as `model.searchYield`. The tracker writers and the merge planners do not read the key.
2. **Agreement.** An advert's family is the classification of its first-sighting title, as in the Role Family column. For a named search, the adverts-found figure equals the Sources tab's `Jobs Found`.
3. **Definitions.** On-target means any family except `other`. Unique means on-target and found by no other named search within the scope counted. Sightings with no parsable search term form one labelled row that is excluded from the unique figures.
4. **Scopes.** Two blocks: every cached alert, and the 28 calendar dates ending at the latest sighting date in the cache, not at the clock, so the output does not vary with the day it is run. No new command-line option is added.
5. **Output.** Stderr only, after the role-family view, at the same three build sites. Never stdout and never the `--report` file, so an empty report still means nothing changed. A block with fewer than two named searches is omitted. At most 20 named searches are shown, and long search terms are truncated to a fixed width.
6. **Nothing is persisted.** The figures come from the whole cache on every build (DR-0001, DR-0009). A partial cache under-counts and can overstate unique.

## Exceptions

Revisit if:

- **The operator needs a window that is not fixed.** A `--since` option would add an entry to the option tables and the unknown-option guard of `src/core/cli-options.mjs`, so it needs its own decision.
- **The figures belong in the tracker.** If the operator wants them in the Sheet beside each search, Option C returns and the storage and rewrite costs have to be accepted.
- **Title match share is wanted.** The share of adverts whose title contains the search phrase would separate LinkedIn's related-results padding from keyword quality, but it needs a heuristic to extract the phrase from free-form boolean search text. It was deferred, not rejected.
