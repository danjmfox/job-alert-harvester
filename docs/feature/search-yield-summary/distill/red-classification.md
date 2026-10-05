# RED classification: search-yield-summary DISTILL

Every scenario was run once with `RED_GATE=1` against the RED scaffold `src/core/search-yield.mjs` and the unchanged existing modules (nothing else in `src/` was touched; `harvest()` and the CLI do not call the scaffold). One line per scenario. `RED MISSING_FUNCTIONALITY` is the correct RED: an assertion, or the scaffold's throw, reached by a well-formed test. `GREEN_TODAY` pins behaviour that already holds. `INFRA_GREEN` tests the builders, vocabulary, oracle and generators, run unskipped, and exercise no scenario. No scenario failed on an import, fixture or setup error (zero BROKEN): the 48 that assert against an existing module first assert that the new behaviour is present, so a missing `searchYield` or yield block is an assertion failure, not a TypeError.

Totals (excluding the infrastructure tests): 110 scenarios, 107 RED (59 reach a scaffold throw, 48 assert against an existing module that lacks the behaviour: 40 through the real CLI, 8 through `harvest()`), 3 GREEN_TODAY, 0 BROKEN; 19 infrastructure tests green.

The three GREEN_TODAY scenarios are guards that hold today and must keep holding: `build` refuses `--since` as an unknown option, `build` and the rebuild form accept exactly their current options, and `search-yield.mjs` imports only `./` modules with no `node:` builtin, class or clock read. Every absence scenario (no yield on the create path, one named search, empty cache) is chained to a step that makes the yield appear, so each fails today for the missing feature rather than passing vacuously.

The same scenarios were also run against a throw-away reference implementation in a scratch copy of the repository (not committed): all 129 new tests (110 scenarios and 19 infrastructure tests) passed there, and the 1,040 existing tests stayed green. Three deliberate mutations of it failed scenarios: a window one date too wide failed 15, counting the unparsed bucket as a rival search in unique failed 32, and taking the family from the latest sighting instead of the first failed 8. So the scenarios can pass and can fail.

## acceptance/search-yield-summary/search-yield-build-sheets.test.mjs

- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @walking_skeleton @driving_adapter @real-io Operator builds into their Google Sheet and sees which saved searches earn their place: found, other, on-target and unique, all-time and the last 28 days
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the yield is derived from the cache alone: a Sheet holding everything already and an empty one give the same lines
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error an empty report still means nothing changed: a Sheet that already holds everything is built into with the yield printed, no data batch sent, and an empty report
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the Sheet holds nothing the yield added: every request that wrote is inside the four allowed kinds, and only the declared columns were written
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a second build into the Sheet prints the same yield, sends no further data batch and changes nothing
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error one named search prints nothing, and once a second search has sent an advert the next build prints both
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error an empty cache prints no yield: the build refuses as it always did and writes nothing, and once alerts arrive the next build prints it
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the preview prints the yield on stderr after its own plan, and the fake records no write request and no change
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the preview shows exactly the yield the build then prints
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a preview against an empty cache prints no yield and sends no write request, and once alerts arrive the preview prints it

## acceptance/search-yield-summary/search-yield-build-workbook.test.mjs

- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @real-io the merge prints the all-time yield per saved search: found, other, on-target and unique, ordered by found then search, in whole percentages
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error stdout and the --report file never carry a yield line, whatever the run changes
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error an empty report still means nothing changed: a build into a tracker that already holds everything prints the yield and writes an empty report
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the tracker is cell for cell what it was: a tracker already holding the cache is identical after a merge that prints the yield
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the merge adds only the three declared tabs and their declared columns: no yield tab, column or cell appears in the tracker
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the yield comes after the change summary and the role-family view, since adverts fell through to other
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a second merge prints the same yield and changes nothing: the figures come from the cache, not from the run before
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the yield does not depend on what the tracker holds: an empty tracker and one the operator has filled in and extended give the same lines
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a preview against a tracker prints the yield on stderr, the plan on stdout, and the workspace is byte-identical afterwards
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a preview with no tracker prints the yield too, and creates no file
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a preview shows exactly the yield the build then prints, and the build leaves nothing more behind than the tracker
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the preview prints the yield after its own plan summary and role-family view
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error creating a new workbook prints no yield and neither does the rebuild form, and a merge into the new workbook then does
- GREEN_TODAY (pins what already holds): @error build refuses an option the yield might have wanted: there is no --since, and nothing is written
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error found equals the Sources tab Jobs Found for every named search, and the total row matches the Jobs tab
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error an advert two searches found counts under both for found, other and on-target, and under neither for unique
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error an advert one search resends on five days counts once, and a repost under a new job id counts twice, as the Jobs tab holds two rows for it
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error an advert first sighted as Scrum Master and later titled Data Analyst counts as scrum master under both searches, as its Jobs row does
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error an advert first sighted as Data Analyst and later titled Scrum Master counts as other under both searches, as its Jobs row does
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error alerts that name no search form the (no search term) row with unique shown as -, and never reduce another search's unique count
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a search name that is only blank space is no search term, and its adverts join the (no search term) row
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error one named search prints nothing, until a second search joins the cache and the next merge prints both
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a cache whose alerts all name no search prints nothing, until two named searches arrive
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error an empty cache prints no yield: the merge refuses as it always did, the preview prints no yield, and once alerts arrive both print
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a cache that fits inside 28 dates prints only the all-time block; one date more and the recent block appears
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @real-io a cache spread over two months prints both blocks: the recent heading names the end date, and the figures are the window's
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the window ends at the latest sighting date, not at the clock: the same cache merged on two different days prints the same lines
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a stale cache shows its own end date, so an old cache is visibly old
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a label over 40 characters is cut to 37 plus ..., a label of exactly 40 is printed whole, and the lines are the DESIGN's
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error twenty-three saved searches print twenty rows and "... and 3 more search(es) not shown", the total still counts every advert, and the tracker still lists all twenty-three
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error exactly twenty saved searches print every row and no "more not shown" line

## acceptance/search-yield-summary/search-yield-summary.test.mjs

- RED MISSING_FUNCTIONALITY (scaffold reached): the cohort gives each search its found, other, on-target and unique figures, ordered by found then search, with the unparsed row and the total
- RED MISSING_FUNCTIONALITY (scaffold reached): @error an advert found by two searches counts under both for found and on-target, and under neither for unique
- RED MISSING_FUNCTIONALITY (scaffold reached): @error an advert resent by the same search again and again counts once
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a repost under a new advert id is a second advert, counted twice
- RED MISSING_FUNCTIONALITY (scaffold reached): @error the family counted is the first sighting's title, whatever a later sighting is called, and it holds under every search that found the advert
- RED MISSING_FUNCTIONALITY (scaffold reached): @error an advert first sighted as other stays other under every search, even when a later sighting is titled as a family
- RED MISSING_FUNCTIONALITY (scaffold reached): @error the total counts distinct adverts, not the sum of the searches that found them
- RED MISSING_FUNCTIONALITY (scaffold reached): @error the unparsed bucket is a row of its own, never a rival search: an advert found by one search and an unparsed alert is still unique to that search
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a search name that is empty counts as no search term, the same as a missing one
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a block needs two named searches: one named search, or none, gives no block
- RED MISSING_FUNCTIONALITY (scaffold reached): @error an empty cache gives no block at all, and does not throw
- RED MISSING_FUNCTIONALITY (scaffold reached): @error it never changes the sightings or the adverts it is handed
- RED MISSING_FUNCTIONALITY (scaffold reached): the spread cohort gives a recent block ending at its latest sighting date, with figures that differ from all-time
- RED MISSING_FUNCTIONALITY (scaffold reached): @error the window is inclusive at both ends: the 27th day before the latest counts, the 28th does not
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a cache that fits inside the window prints no recent block: exactly 28 dates fit, 29 do not
- RED MISSING_FUNCTIONALITY (scaffold reached): @error the window ends at the latest sighting date, not at the clock: the same cache gives the same blocks on any day it is read
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a recent window holding fewer than two named searches gives no recent block, though all-time has several
- RED MISSING_FUNCTIONALITY (scaffold reached): @error unique is counted inside the scope: an advert two searches found, one of them before the window, is unique to the later search in the recent block only
- RED MISSING_FUNCTIONALITY (scaffold reached): @error an advert first seen long ago and resent in the window counts under the resending search, with its original family
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a search that appears only inside the window has the same found in both blocks
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a sighting whose date cannot be read is counted all-time, is outside the window, and never throws
- RED MISSING_FUNCTIONALITY (scaffold reached): @error the unparsed row is counted in a scope too, and omitted from the recent block when no sighting there lacks a term
- RED MISSING_FUNCTIONALITY (scaffold reached): @error the cohort and the spread cohort equal what the oracle restates from the DESIGN
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @driving_port harvest() returns searchYield as a fourth key beside sources, companies and jobs, and the tabs keep their columns
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error found equals the Sources tab Jobs Found for every named search, all-time
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the total counts the Jobs rows and the other figure counts the Jobs rows whose Role Family is other, in the all-time block
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the family harvest counts is the one the Jobs row carries, for an advert retitled between sightings
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error harvest of no messages has no blocks and three empty tabs
- RED MISSING_FUNCTIONALITY (scaffold reached): the cohort prints heading, column header, one row per search, the unparsed row and the total, in fixed widths
- RED MISSING_FUNCTIONALITY (scaffold reached): the spread cohort prints both blocks, the recent heading naming the end date and the window
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a label of exactly 40 characters is printed whole and one of 41 is cut to its first 37 characters then ...
- RED MISSING_FUNCTIONALITY (scaffold reached): @error exactly twenty named searches print no more-line; twenty-one print one more; twenty-three print three more; the total still counts them all
- RED MISSING_FUNCTIONALITY (scaffold reached): @error the unparsed row and the total row stay after the cap line, and the unparsed row is absent when every sighting named its search
- RED MISSING_FUNCTIONALITY (scaffold reached): @error nothing is printed when both blocks are omitted
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a figure wider than its column is printed in full, never cut
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a search with every advert other shows 100%, and one with none shows 0%
- RED MISSING_FUNCTIONALITY (scaffold reached): @error 1 other of 8 found shows 13%, rounded half up to a whole number
- RED MISSING_FUNCTIONALITY (scaffold reached): @error 3 other of 8 found shows 38%, rounded half up to a whole number
- RED MISSING_FUNCTIONALITY (scaffold reached): @error 1 other of 3 found shows 33%, rounded half up to a whole number
- RED MISSING_FUNCTIONALITY (scaffold reached): @error 2 other of 3 found shows 67%, rounded half up to a whole number
- RED MISSING_FUNCTIONALITY (scaffold reached): @error 1 other of 6 found shows 17%, rounded half up to a whole number
- RED MISSING_FUNCTIONALITY (scaffold reached): @error 5 other of 6 found shows 83%, rounded half up to a whole number
- RED MISSING_FUNCTIONALITY (scaffold reached): @error 1 other of 200 found shows 1%, rounded half up to a whole number
- RED MISSING_FUNCTIONALITY (scaffold reached): @error the printed lines equal the oracle's for the cohorts
- GREEN_TODAY (pins what already holds): @structural search-yield.mjs imports only core modules, uses no node: builtin and declares no class
- GREEN_TODAY (pins what already holds): @structural build still accepts exactly its five options: this feature adds none

## acceptance/search-yield-summary/search-yield-properties.test.mjs

- RED MISSING_FUNCTIONALITY (scaffold reached): @property P1 other plus on-target is found, for every search, the unparsed row and the total, in both blocks
- RED MISSING_FUNCTIONALITY (scaffold reached): @property P2 unique is at most on-target, which is at most found; every figure is a non-negative whole number
- RED MISSING_FUNCTIONALITY (scaffold reached): @property every named search in a block has at least one advert, and the total is at least the largest search
- RED MISSING_FUNCTIONALITY (scaffold reached): @property the searches are ordered by found descending, then by search ascending in code-unit order
- RED MISSING_FUNCTIONALITY (scaffold reached): @property P3 the sum of found over the named searches is the number of distinct (advert, search) pairs; the total is the number of distinct adverts
- RED MISSING_FUNCTIONALITY (scaffold reached): @property a block is present exactly when the scope holds two or more named searches
- RED MISSING_FUNCTIONALITY (scaffold reached): @property an advert counts as unique to a search only when that search alone sent it and its title is on-target
- RED MISSING_FUNCTIONALITY (scaffold reached): @property @error sightings that name no search never change any named search's found or unique
- RED MISSING_FUNCTIONALITY (scaffold reached): @property P5 per search, and in total, the recent found is at most the all-time found; every recent search is an all-time search
- RED MISSING_FUNCTIONALITY (scaffold reached): @property the recent block ends at the latest sighting date, and exists only when the cache spans more than 28 dates
- RED MISSING_FUNCTIONALITY (scaffold reached): @property @error moving every sighting by the same number of days never changes a figure: only the window's end date moves with them
- RED MISSING_FUNCTIONALITY (scaffold reached): @property every figure of both blocks equals what the oracle derives from the sightings
- RED MISSING_FUNCTIONALITY (scaffold reached): @property the same sightings give the same summary, and the order of the sightings never changes it
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @property P4 shuffling the messages leaves harvest().searchYield unchanged (every alert at a distinct minute: the DESIGN's generator constraint)
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @property harvest().searchYield equals the oracle for generated alerts, adverts retitled between sightings included: the family is the first sighting's
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @property found equals the Sources tab Jobs Found for every named search, and the all-time total equals the Jobs row count
- RED MISSING_FUNCTIONALITY (scaffold reached): @property P6 any sightings, null or empty terms, unreadable dates and odd titles included, give a summary and never throw
- RED MISSING_FUNCTIONALITY (scaffold reached): @property P6 an empty list of sightings gives no block
- RED MISSING_FUNCTIONALITY (scaffold reached): @property the lines equal the oracle's for generated sightings, labels at and beyond 40 characters included
- RED MISSING_FUNCTIONALITY (scaffold reached): @property with up to 26 searches at most twenty are listed, the rest are counted in one line, and the total still counts every advert
- RED MISSING_FUNCTIONALITY (scaffold reached): @property P7 the share of a search is a whole number from 0 to 100, rounded half up, 100 when every advert is other and 0 when none is
- RED MISSING_FUNCTIONALITY (scaffold reached): @property @error a search whose every advert is other shows 100%, and one with none shows 0%
- RED MISSING_FUNCTIONALITY (scaffold reached): @property every table line has the same width and no label is wider than the column

## acceptance/search-yield-summary/support-builders.test.mjs

- INFRA_GREEN (builders, vocabulary, oracle, generators; unskipped): names the families the production classifier gives: on-target titles are never other, other titles always are
- INFRA_GREEN (builders, vocabulary, oracle, generators; unskipped): keeps its constants equal to the production constants, so a renamed value is a recorded decision
- INFRA_GREEN (builders, vocabulary, oracle, generators; unskipped): gives the figures worked out by hand for the cohort, and the exact lines the DESIGN rule prints for them
- INFRA_GREEN (builders, vocabulary, oracle, generators; unskipped): gives the figures worked out by hand for the spread cohort in both scopes
- INFRA_GREEN (builders, vocabulary, oracle, generators; unskipped): rounds half up, cuts a 41-character label to 37 plus ..., and leaves a 40-character label whole
- INFRA_GREEN (builders, vocabulary, oracle, generators; unskipped): prints at most twenty named searches and says how many more there are, keeping the total row last
- INFRA_GREEN (builders, vocabulary, oracle, generators; unskipped): reads its own rendering back: the figures an observer takes from a printed block equal the oracle's
- INFRA_GREEN (builders, vocabulary, oracle, generators; unskipped): cache the cohort so that the real parser reads every sighting back: the term, the advert and the day
- INFRA_GREEN (builders, vocabulary, oracle, generators; unskipped): hand the parser an alert naming no search as a null term, a blank search as an empty term, and still yield its adverts
- INFRA_GREEN (builders, vocabulary, oracle, generators; unskipped): give every alert a distinct arrival time, in plan order, so the first sighting of an advert is never a tie
- INFRA_GREEN (builders, vocabulary, oracle, generators; unskipped): write the plan where the harvest reads it, and the harvest derives eleven adverts and the Sources figures the DESIGN reconciles to
- INFRA_GREEN (builders, vocabulary, oracle, generators; unskipped): hand the pure summary the rows the real parser gives, with the collapsed adverts titled by their first sighting
- INFRA_GREEN (builders, vocabulary, oracle, generators; unskipped): build numbered searches whose names sort in number order, all under the column width
- INFRA_GREEN (builders, vocabulary, oracle, generators; unskipped): shape a tracker that matches what the harvest derives, so a merge into it changes no cell
- INFRA_GREEN (builders, vocabulary, oracle, generators; unskipped): shape a tracker that holds only headers, so a merge appends every advert
- INFRA_GREEN (builders, vocabulary, oracle, generators; unskipped): shape a Sheet that matches what the harvest derives, so a build into it sends no data batch
- INFRA_GREEN (builders, vocabulary, oracle, generators; unskipped): run the real command with an empty HOME and no credential, and stop the clock when asked
- INFRA_GREEN (builders, vocabulary, oracle, generators; unskipped): read a workspace as digests, so a preview that writes nothing can be proved byte-identical
- INFRA_GREEN (builders, vocabulary, oracle, generators; unskipped): reach the interesting cases: two or more named searches, a recent block, more than twenty searches, retitled adverts
