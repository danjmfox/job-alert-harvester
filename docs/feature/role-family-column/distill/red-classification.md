# RED classification: role-family-column DISTILL

Every scenario was run once with `RED_GATE=1` against the RED scaffold `src/core/role-families.mjs` and the unchanged existing modules (nothing else in `src/` was touched). One line per scenario. `RED MISSING_FUNCTIONALITY` is the correct RED: an assertion, or the scaffold's throw, reached by a well-formed test. `GREEN_TODAY` pins behaviour that already holds. `INFRA_GREEN` tests the builders and the golden table, run unskipped, and exercise no scenario. No scenario failed on an import, fixture or setup error (zero BROKEN).

Totals (excluding the infrastructure tests): 164 scenarios, 163 RED (94 reach a scaffold throw, 19 fail the table pin because the scaffold's table is empty, 50 assert against an existing module that lacks the behaviour), 1 GREEN_TODAY, 0 BROKEN; 7 infrastructure tests green.

The one GREEN_TODAY scenario is the S9 column-agreement drift guard (Dedup Key plus harvester-owned plus human-owned equals the Jobs header, as sets): it holds today and must keep holding. Absence scenarios (no tuning view when every advert has a family) were made non-vacuous by asserting the families first, so each fails today for the missing column. The same scenarios were also run against a throw-away reference implementation in a scratch copy of the repository (not committed): all 164 passed there, and two deliberate mutations of it (swapping two descriptors; breaking whitespace handling) failed 13 and 108 scenarios, so the scenarios can pass and can fail.

## acceptance/role-family-column/role-family-build-sheets.test.mjs

- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @walking_skeleton @driving_adapter @real-io Operator builds into their Google Sheet and finds every advert grouped under a role family, their notes untouched
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the grid is exactly as wide as the old header, so the build widens it and writes the header at the old width
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a column the operator added lies between the old header and the new one, so Role Family goes after it, widening the grid
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a Sheet with a spare column needs no widening: the header cell is written in the first free column
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the whole change is one batch, every request is one of the four allowed kinds, and the only column it writes is Role Family
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error about 3,050 adverts are written in one batch within the limit, and none is refused as too large
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the first population is not itemised: stdout counts the appended column, stderr says no derived corrections, the report holds nothing about it
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a later re-classification is itemised, one line per changed advert, and only those cells are written
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a Role Family column the operator created by hand, and moved beside Status, is filled where it stands: nothing appended, each filled cell itemised
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a second build sends no batch at all and changes nothing
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the preview names the column it would append, prints the tuning view, and the fake records no write request
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a Sheet naming Role Family twice is refused as a duplicate header, and nothing is written
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a build prints the tuning view on stderr only, and the report stays empty when the Sheet was already up to date
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the view says nothing when every advert has a family

## acceptance/role-family-column/role-family-build-workbook.test.mjs

- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @golden @real-io every golden agile coach title carries agile coach in the Role Family column
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @golden @real-io every golden scrum master title carries scrum master in the Role Family column
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @golden @real-io every golden AI transformation title carries AI transformation in the Role Family column
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @golden @real-io every golden transformation/change title carries transformation/change in the Role Family column
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @golden @real-io every golden engineering/delivery manager title carries engineering/delivery manager in the Role Family column
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @golden @real-io every golden product/product ops title carries product/product ops in the Role Family column
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @golden @real-io @error every golden other title carries other in the Role Family column
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @golden @contested the nine contested cases and the double-qualifier titles land where the human ratified
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @golden the header carries Role Family immediately after Fit Reason, and every row has its family
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @real-io a rebuild from a directory of cached alerts carries the column too
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error company and saved search never influence the family: a title with no pattern stays other whatever surrounds it
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error one advert surfaced by two saved searches is one row with one family, whichever alert arrived first
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error an advert retitled between sightings takes its family from the first sighting, as the row does, across the whole cache (DR-0009)
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error reposts under new job ids with an identical title are separate rows with the same family
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error case, punctuation, spacing, accent and symbol variants of a title all reach their family
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a title of only punctuation, and a title in a script no pattern uses, are other
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a very long title is classified and written, whichever family it lands in
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @driving_adapter @real-io the column is appended at the far right, every advert is filled, and the operator's own cells and tabs are untouched
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a row the operator added by hand, with no Dedup Key, is neither classified nor touched
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the first population is not itemised as corrections: stdout counts the appended column, stderr says no derived corrections, the report holds nothing about it
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a later re-classification is itemised, one line per changed advert, and the unchanged adverts are not mentioned
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a family the operator typed over the harvester's is overwritten, and itemised: the column is harvester-owned
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a Role Family column the operator created by hand becomes harvester-owned: the preview appends nothing, and the build fills it where it stands
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a second build changes nothing: no cell written, no correction, no column appended
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the preview names the column it would append and the cell changes, and the workspace is byte-identical afterwards
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a preview with no tracker plans every advert as a new row, tells which fell through, and writes no file
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a merge prints how many adverts fell through, the titles that fell most often grouped by normalised title, and the count per family, on stderr only
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a preview shows the same view, lists at most fifteen titles by count then title, and cuts the rest
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the view says nothing when every advert has a family
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error a title that falls through is shown from the very first preview of a tracker that lacks the column, and the tracker is not written
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): @error the view never enters the report file, so an empty report still means nothing changed

## acceptance/role-family-column/role-family-classifier.test.mjs

- RED MISSING_FUNCTIONALITY (scaffold reached): @golden "Enterprise Agile Coach" is classified agile coach
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden "Senior Agile Coach (6 month contract)" is classified agile coach
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden "Business Agility Lead" is classified agile coach
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden "Agile Transformation Coach" is classified agile coach
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @double-qualifier "Lead Agile Coach / Transformation Lead" is classified agile coach
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @double-qualifier "Scrum Master / Agile Coach" is classified agile coach
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden "Scrum Master" is classified scrum master
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden "Senior Scrum Master (Contract)" is classified scrum master
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden "Artificial Intelligence Transformation Manager" is classified AI transformation
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden "Head of AI Transformation" is classified AI transformation
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden "Transformation Director" is classified transformation/change
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden "Digital Transformation Lead" is classified transformation/change
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden "Change Manager" is classified transformation/change
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden "Change Lead (Technology)" is classified transformation/change
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @error @whole-word "Rail Transformation Lead" is classified transformation/change
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden "Delivery Manager" is classified engineering/delivery manager
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden "Delivery Lead" is classified engineering/delivery manager
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden "Engineering Manager" is classified engineering/delivery manager
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden "Project Manager" is classified engineering/delivery manager
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden "Technical Delivery Manager" is classified engineering/delivery manager
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden "Product Manager" is classified product/product ops
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden "Product Operations Manager" is classified product/product ops
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden "Product Ops Lead" is classified product/product ops
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden "Senior Product Owner (Payments)" is classified product/product ops
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @contested "Agile Coach" is classified agile coach
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @contested "Scrum Master / Agile Delivery Lead" is classified scrum master
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @contested "AI Transformation Lead" is classified AI transformation
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @contested "Business Change Manager" is classified transformation/change
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @contested "Head of Delivery" is classified engineering/delivery manager
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @contested "Programme Manager" is classified engineering/delivery manager
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @contested "Senior Engineering Manager" is classified engineering/delivery manager
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @contested "Product Owner" is classified product/product ops
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @contested "Technical Product Manager" is classified product/product ops
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @double-qualifier "Product Delivery Manager" is classified engineering/delivery manager
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @double-qualifier "Transformation Delivery Manager" is classified transformation/change
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @error @fallback "Data Analyst" is classified other
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @error @fallback "Java Developer" is classified other
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @error @fallback "Marketing Executive" is classified other
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @error @fallback "Customer Support Advisor" is classified other
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @error @fallback "Chief Financial Officer" is classified other
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @error @fallback "Warehouse Operative" is classified other
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @error @fallback "Registered Nurse" is classified other
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @error @fallback "Software Engineer" is classified other
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @error @fallback "Business Analyst" is classified other
- RED MISSING_FUNCTIONALITY (scaffold reached): @golden @error @fallback "Office Administrator" is classified other
- RED MISSING_FUNCTIONALITY (scaffold reached): @error @variant "SCRUM MASTER (contract)" is classified scrum master
- RED MISSING_FUNCTIONALITY (scaffold reached): @error @variant "Scrum-Master" is classified scrum master
- RED MISSING_FUNCTIONALITY (scaffold reached): @error @variant "scrum    master" is classified scrum master
- RED MISSING_FUNCTIONALITY (scaffold reached): @error @variant "Scrum Master - London" is classified scrum master
- RED MISSING_FUNCTIONALITY (scaffold reached): @error @variant "AGILE COACH." is classified agile coach
- RED MISSING_FUNCTIONALITY (scaffold reached): @error @variant "agile coach!!" is classified agile coach
- RED MISSING_FUNCTIONALITY (scaffold reached): @error @variant "  Product   Owner  " is classified product/product ops
- RED MISSING_FUNCTIONALITY (scaffold reached): @error @variant "Programme-Manager" is classified engineering/delivery manager
- RED MISSING_FUNCTIONALITY (scaffold reached): @error @variant "Scrüm Mästér" is classified scrum master
- RED MISSING_FUNCTIONALITY (scaffold reached): @error @variant "Scrum Master 🚀" is classified scrum master
- RED MISSING_FUNCTIONALITY (scaffold reached): @priority "Agile Coach / Scrum Master" is classified agile coach: agile coach is ranked before scrum master
- RED MISSING_FUNCTIONALITY (scaffold reached): @priority "Scrum Master / Delivery Lead" is classified scrum master: scrum master is ranked before delivery lead
- RED MISSING_FUNCTIONALITY (scaffold reached): @priority "AI Transformation Delivery Manager" is classified AI transformation: AI transformation is ranked before delivery manager
- RED MISSING_FUNCTIONALITY (scaffold reached): @priority "Transformation Product Manager" is classified transformation/change: transformation is ranked before product manager
- RED MISSING_FUNCTIONALITY (scaffold reached): @priority "Product Manager (Delivery Lead)" is classified engineering/delivery manager: delivery lead is ranked before product manager
- RED MISSING_FUNCTIONALITY (scaffold reached): @priority "Agile Transformation Coach (AI Transformation)" is classified agile coach: agile coach is ranked before AI transformation
- RED MISSING_FUNCTIONALITY (scaffold reached): @error an empty title, a blank title and a title of only punctuation fall back to other
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a missing title, and anything that is not text, falls back to other without throwing
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a title in a script with no letters a pattern could match falls back to other
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a very long title carrying a pattern is still classified by it
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a very long title carrying no pattern falls back to other
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a pattern never matches inside a longer word
- RED MISSING_FUNCTIONALITY (scaffold reached): the same title always yields the same family
- RED MISSING_FUNCTIONALITY (scaffold reached): @normalise "Scrum  Master" reads as "scrum master"
- RED MISSING_FUNCTIONALITY (scaffold reached): @normalise "  Agile—Coach!!  " reads as "agile coach"
- RED MISSING_FUNCTIONALITY (scaffold reached): @normalise "Scrum-Master (Contract)" reads as "scrum master contract"
- RED MISSING_FUNCTIONALITY (scaffold reached): @normalise "AI/ML Lead" reads as "ai ml lead"
- RED MISSING_FUNCTIONALITY (scaffold reached): @normalise "Café Manager" reads as "cafe manager"
- RED MISSING_FUNCTIONALITY (scaffold reached): @normalise "Scrüm Mästér" reads as "scrum master"
- RED MISSING_FUNCTIONALITY (scaffold reached): @normalise "Product Owner 2" reads as "product owner 2"
- RED MISSING_FUNCTIONALITY (scaffold reached): @normalise "" reads as ""
- RED MISSING_FUNCTIONALITY (scaffold reached): @normalise "!!!" reads as ""
- RED MISSING_FUNCTIONALITY (scaffold reached): @normalise "   " reads as ""
- RED MISSING_FUNCTIONALITY (scaffold reached): @error a title that is not text normalises to the empty string without throwing
- RED MISSING_FUNCTIONALITY (scaffold reached): @summary it totals the adverts, counts them by family, and lists the most frequent other titles by count then title
- RED MISSING_FUNCTIONALITY (scaffold reached): @summary it groups titles that differ only in case, punctuation and spacing, and shows the normalised form
- RED MISSING_FUNCTIONALITY (scaffold reached): @summary equal counts are ordered by title, ascending
- RED MISSING_FUNCTIONALITY (scaffold reached): @summary it shows at most the limit, keeping the most frequent
- RED MISSING_FUNCTIONALITY (scaffold reached): @error @summary a title of a family other than other never appears in the tuning list
- RED MISSING_FUNCTIONALITY (scaffold reached): @error @summary no adverts at all is a summary of nothing, not a failure
- RED MISSING_FUNCTIONALITY (scaffold reached): @error @summary a limit of zero lists no titles but still counts
- RED MISSING_FUNCTIONALITY (scaffold reached): @error @summary adverts that all have a family give an empty tuning list
- RED MISSING_FUNCTIONALITY (scaffold reached): @error @summary the rows it is handed are left exactly as they were

## acceptance/role-family-column/role-family-properties.test.mjs

- RED MISSING_FUNCTIONALITY (table pin: the scaffold table is empty): @property every string, and anything that is not a string, yields exactly one family of the closed set and never throws
- RED MISSING_FUNCTIONALITY (table pin: the scaffold table is empty): @property the same input always yields the same family
- RED MISSING_FUNCTIONALITY (table pin: the scaffold table is empty): @property a very long title is classified, whatever its length
- RED MISSING_FUNCTIONALITY (scaffold reached): @property normalising twice is normalising once
- RED MISSING_FUNCTIONALITY (scaffold reached): @property a normalised title holds only lower-case letters and digits, single-spaced, with no space at either end
- RED MISSING_FUNCTIONALITY (table pin: the scaffold table is empty): @property case, repeated whitespace, separators and trailing punctuation never change the family of a golden title
- RED MISSING_FUNCTIONALITY (table pin: the scaffold table is empty): @property accents on vowels never change the family of a golden title
- RED MISSING_FUNCTIONALITY (table pin: the scaffold table is empty): @property a title holding a phrase of two descriptors takes the earlier descriptor, never the later
- RED MISSING_FUNCTIONALITY (table pin: the scaffold table is empty): @property classification equals first-matching-descriptor on whole words, for titles built from the table and from noise
- RED MISSING_FUNCTIONALITY (table pin: the scaffold table is empty): @property @error gluing letters onto a pattern word stops it matching: only whole words count
- RED MISSING_FUNCTIONALITY (table pin: the scaffold table is empty): @property @error a title of noise words alone is other
- RED MISSING_FUNCTIONALITY (table pin: the scaffold table is empty): @property @error a title with no letters or digits is other
- RED MISSING_FUNCTIONALITY (table pin: the scaffold table is empty): @property a title that is a pattern, with noise either side, is classified into that pattern's own family
- RED MISSING_FUNCTIONALITY (scaffold reached): @property the family counts add up to the total, and the other count is the number of other adverts
- RED MISSING_FUNCTIONALITY (scaffold reached): @property the tuning list holds at most the limit, is ordered by count then title, and never counts more adverts than fell through
- RED MISSING_FUNCTIONALITY (scaffold reached): @property with room for every title the list accounts for every advert that fell through
- RED MISSING_FUNCTIONALITY (scaffold reached): @property the order of the adverts never changes the summary

## acceptance/role-family-column/role-family-table.test.mjs

- RED MISSING_FUNCTIONALITY (table pin: the scaffold table is empty): the families are exactly the six the human ratified, in the order the human ratified, and other is not one of them
- RED MISSING_FUNCTIONALITY (table pin: the scaffold table is empty): @error no family name is repeated
- RED MISSING_FUNCTIONALITY (table pin: the scaffold table is empty): @error every descriptor has at least one pattern, and every pattern is a non-empty phrase already in normalised form
- RED MISSING_FUNCTIONALITY (table pin: the scaffold table is empty): @error no pattern is held by two descriptors, or twice by one
- RED MISSING_FUNCTIONALITY (table pin: the scaffold table is empty): @error no pattern of a later descriptor contains a pattern of an earlier one: it could never be reached
- RED MISSING_FUNCTIONALITY (table pin: the scaffold table is empty): @error every pattern, classified on its own, lands in the family that owns it
- RED MISSING_FUNCTIONALITY (table pin: the scaffold table is empty): every pattern is exercised by at least one golden title that lands in its family
- RED MISSING_FUNCTIONALITY (table pin: the scaffold table is empty): @error the table cannot be changed at run time
- GREEN_TODAY (pins what already holds): @error the Jobs header is the Dedup Key plus the harvester-owned columns plus the human-owned columns, as a set, with no column named twice
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): Role Family is in the Jobs header and is harvester-owned, never human-owned, never the key
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): Role Family sits immediately after Fit Reason in a new workbook header and in the harvester-owned list
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): the header a tracker had before the column is exactly the old 26 columns, so a new column needs a wider grid
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): a harvest carries Role Family in every Jobs row, under every declared Jobs column and none other
- RED MISSING_FUNCTIONALITY (existing module lacks the behaviour): a harvest fills Role Family from the title of the advert: the golden family for every golden title

## acceptance/role-family-column/support-builders.test.mjs

- INFRA_GREEN (builders and golden table; unskipped): has unique titles, every family at least once, and the nine contested cases
- INFRA_GREEN (builders and golden table; unskipped): agrees with the DESIGN's illustrative table, judged by an oracle independent of src/
- INFRA_GREEN (builders and golden table; unskipped): exercises every pattern of the DESIGN's illustrative table
- INFRA_GREEN (builders and golden table; unskipped): cache every golden title so that the real parser reads each back unchanged, one row per advert
- INFRA_GREEN (builders and golden table; unskipped): cache every title variant as its own advert, whitespace aside
- INFRA_GREEN (builders and golden table; unskipped): shape a tracker that never holds the answer: the rows of a tracker predating the column lack Role Family
- INFRA_GREEN (builders and golden table; unskipped): shape a tracker that matches what the harvest derives, so a merge into it changes no cell
