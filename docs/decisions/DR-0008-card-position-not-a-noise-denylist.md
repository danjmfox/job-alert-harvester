---
id: DR-0008
status: accepted
dateCreated: 2026-09-17
domain: job-alert-harvester
changelog:
  - date: 2026-09-17
    version: 1.1.0
    note: >-
      Amended on implementation. A fifth block shape exists that the 198-card corpus
      measurement did not contain: the search-term header glued to the first card with
      no blank line between them. The rule stands; the run-grouping input needed one
      more boundary. See "The fifth shape" below.
  - date: 2026-09-17
    version: 1.0.0
    note: >-
      Schedules the structural alternative the fix-linkedin-header-shift RCA (2026-09-14)
      named and explicitly left "not attempted and is not scheduled". Accepted directly
      per user instruction ("Fix the denylist properly").

---

# Card position, not a noise denylist

## Context

`src/core/parse-linkedin.mjs` extracts each job's title/company/location by anchoring on the
`/jobs/view/{id}` link and walking backward, skipping lines that match `TRAILING_NOISE_LINE` — a
hand-authored denylist. Over 2026-09-14 that denylist leaked three times in one afternoon, each a
separate committed bugfix:

| Step | Leak | Rows affected |
|---|---|---|
| 01-02 (`c23b4a4`) | unfiltered preamble lines before the first card | 45 of 146 |
| 01-03 (`ba9b2d5`) | LinkedIn's singular `1 company alum` vs. the pattern's `alumni` | 7 |
| 01-04 (`6ead290`) | a per-card `£59K-£78K / year` line taken as the location | 3 |

Every one was found by rebuilding the workbook and auditing output against real mail, never by a
fixture. Step 01-02 also *regressed* 9 previously-correct rows before 01-03/01-04 restored them:
anchoring on the link made extraction walk backward past lines the denylist did not list, and one
of the two hazards this record addresses is exactly that shape — a syntactically valid, semantically
wrong row that no schema check catches, the same failure class DR-0003 (couriers carry paths, not
records) was written about in a different layer.

`docs/feature/fix-linkedin-header-shift/rca.md` § Post-Fix Verification names the root cause
directly: "The denylist shape of `TRAILING_NOISE_LINE` is the real finding... A fourth [leak] is
likely. The structural alternative... was not attempted and is not scheduled." This record schedules
it.

The user's instruction, 2026-09-17: *"Fix the denylist properly."*

### The measured alternative

A positional rule using **zero** denylist patterns for the triple. Split the block into runs of
consecutive non-blank lines. Find the run holding the job link. Let `prefix` be that run's lines
before the link line.

- If `prefix.length >= 3`, the card is `prefix`.
- Otherwise the card is the immediately preceding run.
- The triple is the card's first three lines. Fewer than three available → no row.

**Verified across the full live corpus: 198 job cards, 198 agreements with the current three-patch
parser, 0 disagreements.** It reproduces every row the accumulated denylist produces, without any of
the patterns.

The invariant it rests on: LinkedIn renders each card as an adjacent block of lines next to its
link, and both preamble and trailing social-proof lines fall on the far side of a blank line — or,
where they do not, they sit *after* the triple inside the same run, so a first-three rule skips them.

Four block shapes are observed in the corpus, all satisfied:

1. Triple and link in one run, no noise — `prefix` is exactly the triple (e.g. Speedy Freight /
   Knutsford).
2. Triple in its own run, noise in the link's run — `prefix` is 1–2 noise lines, so the preceding
   run wins (e.g. Worldpay, `1 company alum`).
3. Triple plus extras in its own run — the preceding run wins and first-three trims the salary line
   (e.g. Leonardo, `£59K-£78K / year`).
4. Preamble in the preceding run, triple at the head of the link's run — `prefix` has ≥3 lines so it
   wins and the preamble is never consulted (e.g. DESIGNSCAPES, `New jobs match your preferences.`).

Shapes 2/3 and shape 4 pull in opposite directions: in 2/3 the preceding run must win over a short
`prefix`; in 4 the link's own run must win over a longer one. That is precisely why the `>= 3`
discriminator exists rather than a simpler "prefer the preceding run" or "prefer the link's run"
rule — a reader who tries to collapse it to either will reintroduce one of the two failure shapes it
was built to separate.

## Options Considered

### Option 1: Keep extending the denylist per leak

- **Advantage:** cheap per fix — one new pattern, one new fixture line.
- **Disadvantage:** unbounded. Three leaks surfaced in one afternoon from one three-week corpus, the
  RCA calls a fourth "likely", and every miss is a silent wrong row, not a loud failure. The set the
  denylist has to cover is LinkedIn's free-text preamble copy, which is outside LinkedIn's control or
  any contract and has no closed form.
- **Verdict:** rejected.

### Option 2: Positional rule, no denylist for the triple — *chosen*

- **Advantage:** 198/198 measured against the full live corpus, reproducing the accumulated
  three-patch denylist exactly with zero vocabulary patterns. The bug class "unfiltered line shifts
  the triple" becomes structurally unrepresentable rather than something each new LinkedIn wording
  has to be individually denylisted against.
- **Disadvantage:** the `>= 3` discriminator is a less obvious rule than "first three lines" or "skip
  known noise" — it needs the shape-2/3-vs-shape-4 tension explained once, which a denylist entry
  never required.
- **Verdict:** chosen.

### Option 3: Parse the HTML body instead of the plaintext

- **Advantage:** structured markup would be a more robust anchor than either text rule — no line-
  adjacency inference needed at all. This is the honest long-term successor.
- **Disadvantage:** LinkedIn sends both bodies, but `src/core/slim.mjs` deliberately discards
  `htmlBody` at cache time, per DR-0001 (persist what cannot be re-derived)'s storage argument — the
  ~7.5 MB/year figure in that record's measured evidence depends on that discard. Adopting this now
  means re-fetching a year of mail the cache was built specifically not to hold, to get a shape the
  cache is not keyed to carry.
- **Verdict:** deferred, not rejected. Revisit when the HTML body becomes available (see Exceptions).

### Option 4: Keep the denylist as a secondary filter behind the positional rule

- **Advantage:** belt-and-braces — a second check in case the positional rule is ever wrong.
- **Disadvantage:** reintroduces the exact thing being removed, and worse: a denylist running behind
  a positional rule would silently mask a positional miss (by quietly trimming a noise line the
  position rule got wrong) rather than surfacing it as the loud "fewer than three lines" failure the
  positional rule is designed to produce on its own.
- **Verdict:** rejected.

## Decision

**Extraction of the title/company/location triple is positional. There is no noise denylist for it.**

### Rules

1. **Extraction is positional.** The triple is derived from the card's position relative to its
   `/jobs/view/{id}` link — the run-and-prefix rule above — never from matching or skipping a list of
   known noise phrases.
2. **`TRAILING_NOISE_LINE` is deleted, not retained-but-unused.** A dormant denylist invites re-use
   under the next time-pressured leak and implies the positional rule is not fully trusted. It goes.
3. **The salary pattern is the one exception, and it is a different mechanism.** The per-card salary
   (step 01-05, `bf200e6` — per-card salary capture) must still be recognised wherever it falls
   relative to the triple, or that capture breaks. What is retained is a rule that *reads* the salary
   line's value, not a denylist entry whose job is to *discard* the line. Recognising a line in order
   to capture it is not the same mechanism as listing it in order to skip it, and only the former
   survives this decision.
4. **A card yielding fewer than three lines produces no row.** This directly contradicts DR-0006
   (source registry: descriptors are data) rule 2 — "unmatched input is captured, never dropped,"
   which mandates an `Unmatched` bucket rather than a silent drop. That contradiction is recorded here
   as an **open item**, not resolved: it never fires on the current 198-card corpus, so it is
   unexercised rather than demonstrated safe.

### Consequences

- Three bugfix commits' worth of patterns (01-02, 01-03, 01-04) collapse into one rule; the noise
  set stops being a maintenance surface that grows by one committed fix per leak.
- A new LinkedIn template variant is now a **positional** risk, not a vocabulary risk: it breaks only
  if LinkedIn stops rendering the card adjacent to its link, which is a visible layout change, not a
  silent wording change a denylist could miss without anyone noticing.
- The 7 regression scenarios in `tests/regression/job-alert-harvester/linkedin-block-anchor.test.mjs`
  pin the three historical leaks (01-02, 01-03, 01-04) and must all stay green. They are the evidence
  that the positional rule subsumes the denylist, so they are not redundant once the denylist is gone
  and must not be deleted as such.
- The walking-skeleton acceptance test (8/8) pins the create-new path end to end and is unaffected.
- Per-card salary capture (step 01-05) and canonical link reconstruction are unaffected — neither
  depends on `TRAILING_NOISE_LINE`.

### Trade-offs accepted

- A subtler rule than either alternative it replaces. "First three lines" and "skip known noise" are
  both one-sentence explanations; the `>= 3` discriminator needs the shape-2/3-vs-shape-4 tension
  explained once before it reads as necessary rather than arbitrary.
- The DR-0006 rule 2 contradiction (rule 4 above) is accepted **unresolved**, on the strength of it
  being unexercised on the full measured corpus, not on the strength of a designed answer. It is a
  named open item, not a closed one.
- Option 3 (HTML parsing) is the more robust anchor and is explicitly not adopted now — this decision
  is a measured improvement on the current text-based approach, not the final answer to the parsing
  question.

## Exceptions

Revisit if:

- **LinkedIn changes card layout so the triple is no longer adjacent to its link.** The positional
  rule breaks, and it should break loudly — a card with fewer than three lines yields no row — not
  silently the way the denylist did.
- **A second source arrives whose cards are not line-adjacent to their link.** By DR-0006, extraction
  is a descriptor's own business; this rule is LinkedIn-descriptor-local, so a non-adjacent source is
  a new descriptor's problem, not a change here.
- **The HTML body becomes available** (Option 3, above). Both the positional rule and its
  predecessor denylist become legacy at that point, superseded by structured markup.

## The fifth shape (amendment, 2026-09-17)

The four shapes above were derived from the 198-card live corpus, where every message put a
blank line between the `Your job alert for …` header and the first card. **The committed
fixture corpus contains a message that does not** —
`fixtures/linkedin/19f98ad32f2cafa1.json`:

```
0: "Your job alert for agile coach in Exampleton"
1: "Agile Delivery Manager/Scrum Master Consultant"
2: "Stealth iT Consulting"
3: "United Kingdom"
4: ""
5: "This company is actively hiring"
6: "Apply with resume & profile"
7: "View job: https://www.linkedin.com/comm/jobs/view/4441092711/?..."
```

The link's own run has a 2-line prefix, so the preceding run wins — but that run is
`[header, title, company, location]`, and its first three lines are
`[header, title, company]`. A shifted row, from the same mechanism this record exists to
remove.

### Resolution

`runsOf` treats the search-term header as a **run boundary**, exactly as it treats a blank
line. It does not skip the line as noise.

That distinction is the whole point and must not erode:

| | Denylist (removed) | Run boundary (this) |
|---|---|---|
| Open or closed set? | Open — every unlisted variant is a silent wrong row | Closed — one line, one anchor |
| Already needed for another purpose? | No, it existed only to be skipped | Yes — `SEARCH_TERM_LINE` is parsed for the Sources tab |
| Failure mode if LinkedIn reworded it | Silent shift | The header stops being recognised anywhere, including the Sources tab, which is visible |

A reader tempted to add a second entry beside it should stop: that is the denylist growing
back, and the answer is a positional rule for whatever shape forced it, not a second anchor.

### What this says about the evidence

The 198/198 corpus agreement was real but **not sufficient** — the live cache happened to
contain only four of the five shapes, and the fifth was caught by the walking-skeleton
acceptance test rather than by analysis. Recorded because it is the substantive lesson:
corpus breadth is not corpus completeness, and the curated fixtures are not a subset of the
live cache. Any future claim of the form "N/N agreement on the corpus" should be read as
evidence about the corpus, not proof about the format.
