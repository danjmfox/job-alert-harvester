# Upstream changes from DESIGN — welcome-to-the-jungle-source

Doc type: Reference. For the product owner to review. No DISCUSS file was edited. Each row quotes the original assumption verbatim with its path and line, then gives the new assumption and the reason. Every new assumption is PROPOSED until the human accepts it.

Two sources of change: the spike (`spike/findings.md`, verdict PARTIAL) and the DESIGN reading of the code. Where a DISCUSS statement and the code disagree, the code is current truth and the row cites file and line.

## U-1 Spike: the messages have no plain text

**Original** (`slices/slice-01-digest-to-rows.md:12`): "Disproves: that the plain-text rendering is enough to recover, per card, the employer alone, the title, and the location. If the employer arrives fused to its tagline, or the title fuses to the location, the fuzzy dedup key is unstable and every resend duplicates. Failure means the HTML must be read, the cache record shape widens (OQ-02, cache holds HTML?), and this slice is redone."

**New:** the failure case already holds. All 100 sampled messages are a single `text/html` part with no `text/plain` part, and `toMessage` refuses them (`src/core/gmail-message.mjs:37-41`). The plain text read earlier was the Gmail connector's own conversion. The slice is not redone; it starts from HTML. Proposed hypothesis: the card fields are positionally fixed in the HTML, so company, title and location can be read separately and the fuzzy key from them is stable across resends.

## U-2 US-01 acceptance criteria and examples assume the plain-text method

**Original** (`feature-delta.md:256`): "AC-2: Company holds the employer only (pending OQ-01, HTML spike, for the method)."

**New:** the method is known. Paragraph 1 of the card holds the employer in a `<strong>` element; the tagline is paragraph 2 and is dropped. AC-2 can lose its "pending" mark. The wording stays behavioural.

**Original** (`feature-delta.md:213`, example 1): "`[ Northwind Analytics Open-source dashboards for product teams | Technical Product Lead Salary above your minimum Remote (within the UK) ]`"

**New:** this fused line is the connector's rendering and does not exist in the cache. The example should show three separate fields per card. The three invented companies and titles stay valid.

**Original** (`feature-delta.md:215`, example 3): "a card whose title ends in a bracket, "(AI Platform)", both keep their full title; the bracket is not read as a location."

**New:** the ambiguity no longer exists, since the location is its own element. Keep the scenario as a regression guard only.

**Original** (`feature-delta.md:264`, KPI 1): "100% of cards (3 of 3 in the sample; 0% today)"

**New:** the sample was the connector's text. The measure should name the synthetic fixture and Dan's dogfood run.

## U-3 Slice 05 reads salary "from the plain text"

**Original** (`slices/slice-05-salary-where-stated.md:12`): "Disproves: that the four observed salary forms can be told apart reliably from the plain text."

**New:** salary is always its own `<em>` line, never fused with the location. A card with two lines has salary first and location second; a card with one line has location only. There are six forms (absent, "Salary above your minimum", `$`, `£` range, `£` single, `€`). The slice gets smaller (about 0.25 to 0.5 day).

**Original** (`feature-delta.md:517`): "A title/salary/location run on one plain-text line makes this the second consumer of the same boundary question as US-01 (OQ-01, HTML spike)."

**New:** there is no shared boundary question. Delete the sentence; the dependency on US-01 stays because the card reader comes from it.

**Original** (`slices/slice-05-salary-where-stated.md:9`): "It shares the title, salary and location boundary with slice 01, so it is cheaper after that boundary is understood."

**New:** it is cheaper because salary is a separate element, not because of a shared boundary.

## U-4 Contradiction C-2 (no HTML parser needed)

**Original** (`feature-delta.md:577`): "| C-2 | Spike finding F5 (plain text is the parse target) | no HTML parser needed | true for LinkedIn; unverified for this sender, whose plain text merges fields (OQ-01) |"

**New:** F5 does not carry over. This sender needs an HTML read path and a way to scan HTML in `src/core` (decisions DR-0019 on the HTML read path and DR-0021 on HTML scanning, both proposed). Also the paragraph at `feature-delta.md:61` ("Whether F5 carries over is the riskiest unknown in the feature. It is OQ-01 (HTML spike).") is answered: it does not.

## U-5 OQ-01 (HTML spike)

**Original** (`feature-delta.md:88`): "Is the plain text enough to split company from tagline and title from location, and does the HTML hold a job id or a direct advert link? Only one body was read, plain text only."

**New:** answered by the spike. Plain text does not exist. The HTML separates the fields positionally. It holds no job id and no direct link; the link is an opaque click-tracking token. The row is answered and closed.

## U-6 OQ-02 (cache holds HTML?)

**Original** (`feature-delta.md:89`): "Decide only after OQ-01. Prefer a structured form over raw HTML if the spike allows." and "Keep raw HTML (about 60 to 73 KB a message, roughly 1 to 2 MB a year at this volume; the personal-data cost is the larger concern)."

**New:** DESIGN proposes raw HTML (DR-0020 on the cache form, proposed), against both the DISCUSS preference and the spike's lean, because a structured form cannot be re-derived (DR-0001) and two spike unknowns (logo hash stability, older templates) need the raw markup. The size figures change: the spike measured 42,984 to 64,847 characters per message, not 60 to 73 KB. The yearly figure depends on volume, which is unreconciled (U-12). Still the human's decision.

## U-7 OQ-04 (Advert Link)

**Original** (`feature-delta.md:91`): "Store whatever link the card carries, so the row is actionable. Never commit it. Re-check after OQ-01."

**New:** re-checked. The HTML holds no direct link, only a per-card, probably per-recipient click-tracking URL of about 1,100 characters. DESIGN keeps the recommendation (store it) and ties it to the cache form: a structured cache without the link makes the cell blank. Requesting the link registers a click, so no code may fetch it. Still the human's decision.

## U-8 Slice 03 hypothesis and premise "facts that help": coverage is already per source

**Original** (`feature-delta.md:59`): "Facts that help: coverage intervals are already keyed by `source` (`fetch-loop.mjs:35,68`), `fetch --source` already resolves a descriptor (`harvest.mjs:169`), and the cache is keyed by message id, so two senders do not collide in it."

**Original** (`slices/slice-03-fetch-into-the-cache.md:12`): "Disproves: that a second sender can be fetched with the existing loop, ledger and cache unchanged."

**New:** disproved by reading the code. Coverage is keyed by `source` on reads and when stamping, but the ledger merge ignores `source`. `mergeIntervals` (`src/core/coverage.mjs:61-71`) joins any overlapping or adjacent intervals and `mergeTwo` (`:54-58`) keeps the first interval's `source` and adds the message counts. `commit` passes every source's intervals to it (`src/adapters/ledger-store.mjs:62`). A second source's interval that overlaps LinkedIn's is absorbed into LinkedIn's. One that is adjacent to LinkedIn's end extends LinkedIn's `to`, which would claim an unfetched LinkedIn day as covered. Not executed (no shell); a RED acceptance test comes first. The US-03 scenario "LinkedIn coverage is untouched" would fail today. See DR-0022 (coverage commit, proposed).

## U-9 P3 (quarantine commits the day) describes the wrong first failure

**Original** (`feature-delta.md:56`): "Fetching it today would log a quarantine line, cache nothing, and mark the day covered: silent loss with a clean ledger."

**New:** for the real messages the first failure comes earlier. `source.read` calls `toMessage`, which throws `gmail.missing-plaintext-body` (`src/core/gmail-message.mjs:40`, called from `src/adapters/gmail-api-source.mjs:131`), so the fetch stops with an error and commits nothing for that day. The underlying defect in P3 stands for any message that reaches `slim`: `fetch-loop.mjs:62-65` counts a quarantined id as satisfied and `:67-73` commits the day. Once the HTML read path exists, a quarantined message commits its day.

## U-10 US-03 acceptance criteria and scenario

**Original** (`feature-delta.md:385`): "AC-4: the truncation check is the descriptor's, not LinkedIn's (shape decided in DESIGN)."

**New:** the shape is a `screen` function on the descriptor: message in, quarantine reason or nothing out. For this sender it checks the card structure, not body length (the HTML is always over 1,024 characters).

**Original** (`feature-delta.md:384`, AC-3 of US-03): "AC-3: no day is committed as covered while one of its messages was set aside without being reported."

**New:** today a quarantine is reported (a log line, `fetch-loop.mjs:55`) and the day still commits. Proposed wording: "no day is committed as covered while any message listed for it is not in the cache". That restores DR-0002's own rule and applies to LinkedIn too, which is a behaviour change for LinkedIn fetching (not LinkedIn rows). Needs the human's yes.

## U-11 OQ-06, OQ-07, OQ-08 get design answers (proposals)

- OQ-06 (`feature-delta.md:93`, "DESIGN decides."): shared cache, coverage per source, plus the ledger merge fix of U-8.
- OQ-07 (`feature-delta.md:94`, "Contain it: report the message id as unparsed and keep building."): proposed as a coded refusal that the registry contains per message. LinkedIn's plain `Error` stays uncaught, so LinkedIn behaviour is unchanged. The fetch-time screen means a template change is normally caught at fetch, before the build.
- OQ-08 (`feature-delta.md:95`, "Loop over all sources with a fetch capability; seed the new source with an explicit `--from` once"): kept. The existing `update.no-baseline` text (`src/cli/update.mjs:5`) does not name a source and must.

## U-12 Volume and backfill

**Original** (`feature-delta.md:96`): "From the earliest Welcome to the Jungle message still in Gmail (about 45 days, about 10 messages, were seen)."

**New:** the spike re-read 100 messages (197 cards) from the same query. Either the mailbox reaches much further back than 45 days or the earlier count was a page limit. Unreconciled; it changes the cache size (100 messages is about 5 MB raw) and the backfill length.

## U-13 Fixture redaction

**Original** (`feature-delta.md:142`): "A committed fixture is made from a real message by: replacing every URL with `https://example.invalid/<n>`; removing unsubscribe and manage-notification tokens; replacing the recipient's first name in the greeting; ..."

**New:** the real HTML is 43 to 65 KB with tokens in hrefs, image sources and the footer. A regex redaction can miss one. Proposed: the committed fixture is a synthetic reconstruction of the card structure with invented text (three cards, plus one per salary form), never a redacted copy. The rule still bans real bodies, tokens and links.

## U-14 Slice list, order and size

**Original** (`feature-delta.md:78`, D-10): "Slices: five, in this order: US-01 digest to rows, US-02 yield stays truthful, US-03 fetch into the cache, US-04 morning update brings both, US-05 salary where stated"

**New:** seven slices, same story order. US-01 splits into 01a (registry routing) and 01b (HTML cards to rows). US-03 splits into 03a (coverage integrity) and 03b (HTML-only message fetched). See `feature-delta.md`, "Slice Impact". Total moves from about 5 days to about 5.5 to 7.5.

## U-15 Stale documentation to correct at delivery (not edited here)

Listed under "Open Questions" in `feature-delta.md` and in `docs/product/architecture/brief.md` section 18. The DISCUSS Definition of Done item 8 already names `docs/reference/cli.md`, `docs/how-to/run-update-on-a-schedule.md`, brief sections 1 and 5 and the README design table.
