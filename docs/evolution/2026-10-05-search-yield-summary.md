# search-yield-summary — Evolution Record

**Type**: Explanation. **Finalized**: 2026-10-05. **Workspace**: `docs/feature/search-yield-summary/` (kept as delivery history; `deliver/roadmap.json` and `deliver/execution-log.json` sit in it).

Assumed background: `build` derives the harvest model from the whole local message cache (DR-0009, build derives from the whole cache), merges it into a tracker and prints summaries to stderr. A saved search is the search term of a LinkedIn alert. A sighting is one advert card in one alert message; an advert is one distinct dedup key.

## What shipped

`build` now prints, per saved search, how many adverts it found, how many of those are `other` (the Role Family fallback, DR-0014: Role Family derived from title), how many are on-target (any other family) and how many on-target adverts no other named search found. The aim is to let the operator tighten noisy LinkedIn alerts and see the effect of each change.

- **Pure core**: new `src/core/search-yield.mjs` holds `summariseSearchYield`, `formatSearchYield` and six constants: `YIELD_WINDOW_DAYS` (28), `YIELD_NAMED_SEARCH_LIMIT` (20), `YIELD_LABEL_WIDTH` (40), `UNPARSED_SEARCH_LABEL` (`(no search term)`), `TOTAL_ROW_LABEL` (`all searches`) and `UNIQUE_NOT_SHOWN` (`-`).
- **Model**: `harvest()` returns the summary as a fourth key, `searchYield`, beside `sources`, `companies` and `jobs` (four changed lines).
- **Print**: `printSearchYield(model)` in `src/cli/harvest.mjs` runs after `printTuningView` at the three build sites: a merge build, a Sheets build and `--dry-run`. `reportDryRun` gained the model argument. It is stderr only, never on stdout or in `--report`, and the create path and `--in` rebuild print nothing.
- **Two blocks**: all cached alerts, and the 28 calendar dates ending at the latest sighting date in the cache (not the system clock, so the core stays pure and a stale cache shows in the printed end date).
- **Unchanged on purpose**: `merge.mjs`, both xlsx adapters and `cli-options.mjs`. The extra model key is ignored by them. The existing suite stayed green with no existing test edited, which confirms the design claim.

Full suite at close: 73 files, 1,169 tests passed, 0 skipped (1,040 on main before the feature; the 129 added are 110 scenarios and 19 builder tests). `npm run check:arch`: no violations across 49 modules. 5/5 steps traced by `des-verify-integrity` ("All 5 steps have complete DES traces"). Adversarial review: approved, no findings.

## Decisions and where they live

- DR-0015 (search yield is derived inside `harvest()` and printed to stderr, never stored) status **`accepted`** on 2026-10-05: `docs/decisions/DR-0015-search-yield-is-derived-in-harvest-and-printed-never-stored.md`.
- The nine DESIGN open questions were ratified as recommended on 2026-10-05. OQ-6 (decision record needed) was resolved to "write one". OQ-10 (title-match share) was raised and deferred. Both lists are in `feature-delta.md`.
- The DISTILL pinned decisions (export names, return shape, heading wording, column widths) were ratified by an instruction the human gave before the list was shown ("Ratify the pinned decisions, start DELIVER"). The orchestrator then listed the main choices and invited objections.
- Product-level summary: `docs/product/architecture/brief.md` section 15.

## Process facts worth keeping

- DISCUSS and DISCOVER were skipped by instruction and DEVOPS was `NOT_APPLICABLE` (local CLI, one operator), so acceptance criteria derive from the DESIGN hand-off.
- DISTILL wrote 110 pending scenarios plus 19 builder tests. DELIVER enabled them one step at a time and removed the red gate and the scaffold marker in step 03-01.
- No existing test was edited in any step.
- Two reviewers (the roadmap reviewer and Sentinel) each raised a false "blocker" or "high" from grep-based scenario counts, which miss `it.each` rows. The vitest listing gave 110 scenarios, 80 tagged `@error` and 23 tagged `@property`; both claims were rejected.
- Property P6 (totality) was owned by step 01-01 in the roadmap but calls the formatter, so it moved to step 01-02.
- Commit `510fd30` went in with one failing test because a piped test command hid the exit code. It was fixed forward in `95e85a6`; the branch was not pushed and history was left as it is. From step 01-02 each crafter was told to check the real exit code before every commit.
- Step 03-01's crafter logged COMMIT before the commit existed (the first `des-commit` call failed on quoting). The second call succeeded and the log's final state is correct.
- The DISTILL designer's suggestion to name scenarios across two files for the walking skeleton was followed, as in role-family-column.
- The refactor pass was empty: nothing was worth changing.
- Mutation testing skipped per the project's `nightly-delta` strategy.

## Real-use evidence

The operator ran the build over their own cache. Aggregates only; no search string, employer or title is recorded here, as they are personal data.

- 17 named searches, an unparsed row of 25 adverts, and an `all searches` row of 3,126 distinct adverts, of which 777 are `other` (25%).
- The all-time `other` share ranged from 6% to 77% by search.
- The two broad agile-coach searches found 1,278 and 831 adverts at 15% and 18% `other`, and carry most of the unique on-target adverts (674 and 339).
- The two contract engineering-manager searches were 49% and 39% `other` all-time, and 68% and 57% over the last 28 days to 2026-10-04.
- The two newest regional searches were 69% and 77% `other` on small samples (74 and 13 adverts).
- The last-28-days block held 342 distinct adverts, 121 of them `other` (35%).

The spread shows where tightening a search would pay: the broad searches earn their place, while the contract and newest regional searches mostly add off-target adverts. The recent block shows the contract searches getting worse, which the all-time block alone hides.

## Not done

- **Title-match share** (OQ-10). The share of adverts whose title contains the search phrase would separate LinkedIn's related-results padding from keyword quality. The human deferred it.
- **`update` subcommand.** Fetch, then `build --target sheets`, plus a launchd how-to. It is queued as the next feature.
- **No live Sheets build was run.** The print changes stderr only and adds no request, so none was needed.
- **Impossible dates.** A well-formed but impossible sighting date (for example 2026-02-30) is accepted as its own string and never throws. Real sighting dates come from Gmail and are valid.
- **Partial caches.** The summary does not read the coverage ledger. A gap in fetched days lowers `found` and can overstate `unique`, so read `unique` as an upper bound on a cache with gaps (DESIGN Q6).
- **CI**: unchanged project-level open item.
