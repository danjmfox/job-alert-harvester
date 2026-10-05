# role-family-column — Evolution Record

**Type**: Explanation. **Finalized**: 2026-10-02. **Workspace**: `docs/feature/role-family-column/` (kept as delivery history; `deliver/roadmap.json` and `deliver/execution-log.json` sit in it).

## What shipped

The Jobs tab has a new derived column, `Role Family`, that groups every advert under one of seven labels so the operator can pivot the tracker by kind of role. The label comes from the advert title alone, through an ordered table of phrases; the first family whose phrase appears as whole words in the normalised title wins, and anything unmatched is `other`. The harvester owns the column under DR-0004 (one owner per column), so a pattern edit rewrites every affected row on the next build.

- **Pure core**: new `src/core/role-families.mjs` holds `normaliseTitle`, `classifyRoleFamily`, `ROLE_FAMILIES` (six ordered families: `agile coach`, `scrum master`, `AI transformation`, `transformation/change`, `engineering/delivery manager`, `product/product ops`), `summariseRoleFamilies`, `formatTuningView` and `TUNING_LIMIT` (15).
- **Column declaration**: `Role Family` joins `JOBS_COLUMNS` (27 names, after `Fit Reason`) and `toJobsRow` in `core/harvest.mjs`, and `HARVESTER_COLUMNS` in `core/merge.mjs`.
- **Tuning view**: `printTuningView` in `cli/harvest.mjs` prints, to stderr only, how many adverts fell through to `other` and the most frequent normalised `other` titles. It runs at the three DESIGN call sites: a merge build, a Sheets build and `--dry-run`.
- **Unchanged on purpose**: `sheets-model`, `sheets-requests`, `import-check` and `changes`. Ownership derives from `HARVESTER_COLUMNS`, so the existing append, allow-list and correction paths cover the new column. Step 01-03 confirmed this: all 18 existing-tracker scenarios were green when activated, and two scratch mutations proved they were not vacuous.
- **Operator script**: `scripts/sheets-live-check.mjs` gained check `S1` (about 3,050 single-cell updates plus the appended header in one batch on a 26-column grid). Its offline self-test went from 35 to 38 checks.

Full suite at close: 68 files, 1,020 tests, all passing, none skipped (849 in 62 files before this feature's branch work). `npm run check:arch`: no violations across 48 modules. 6/6 steps traced by `des-verify-integrity` ("All 6 steps have complete DES traces"). Adversarial review: approved with one low finding.

## Decisions and where they live

- DR-0014 (Role Family is a derived column) status **`accepted`** on 2026-10-02: `docs/decisions/DR-0014-role-family-is-a-derived-column-classified-from-title-by-a-data-table.md`. DR-0004 (one owner per column) was updated to list the column.
- The ten DESIGN open questions (OQ-1 to OQ-10: family order, programme-manager placement, pattern representation, label spelling, tuning-view form, column position, scale check, hand-typed header, correction-line volume, sharing the table with `fit.mjs`) were ratified as recommended on 2026-10-02. The DISTILL pinned decisions (tuning-view format, `summariseRoleFamilies` shape, total normaliser, frozen table) were ratified the same day. Both are in `feature-delta.md`.
- Family labels are a contract with the operator's pivots: renaming one is a full rewrite of the column, reported as corrections (design decision SD-09, label strings are a contract).
- Product-level summary: `docs/product/architecture/brief.md` section 14.

## Process facts worth keeping

- DISCUSS was skipped by instruction and DEVOPS was `NOT_APPLICABLE` (local CLI, one operator), so there are no stories and acceptance criteria derive from the DESIGN hand-off.
- DISTILL wrote 164 pending scenarios plus 7 builder tests. DELIVER enabled them one step at a time and removed the red gate and the scaffold marker in step 03-02.
- The one edit to an existing test was `tests/acceptance/sheets-api-target/sheets-fake.test.mjs:55`, `columnCount` 26 to 27, because the fake's grid is built from the Jobs header. The human approved it on 2026-10-02. DISTILL had predicted it.
- The DISTILL acceptance and architecture reviewers (Haiku) approved. The architecture reviewer caught a stale status in the brief, which was fixed. The DELIVER roadmap reviewer approved.
- The refactor pass was empty: nothing was worth changing, which is a valid result.
- The adversarial reviewer approved with one low finding: `countBy` builds its result by spreading inside a reduce, which is quadratic in distinct keys. It is harmless at 3,050 rows and was left as it is.
- The adversarial reviewer's statement that the scale check was "verified live" is wrong. It had not been run live at that point (it was run on 2026-10-05; see Not done).
- Mutation testing skipped per the project's `nightly-delta` strategy.

## Real-use evidence

The operator ran the classifier over their own cache through a scratch workbook; nothing was written to their Sheet. The aggregates over 3,050 adverts:

| Family | Adverts |
|---|---|
| `engineering/delivery manager` | 1,143 |
| `other` | 982 (32.2%) |
| `scrum master` | 541 |
| `agile coach` | 215 |
| `transformation/change` | 94 |
| `product/product ops` | 73 |

The human then approved a round of pattern tuning (agile-coach variants, release-train and agile-team-lead titles under `scrum master`, director and head-of-engineering titles, program manager, delivery consultant, product consultant and lead titles). Re-measured on the same cache: `other` 759 (24.9%), `engineering/delivery manager` 1,251, `scrum master` 611, `agile coach` 241, `transformation/change` 94, `product/product ops` 92, `AI transformation` 2. Bare `scrum` was tried and dropped because it matched inside the contested case "Scrum Mastery Facilitator", which must stay `other`. Most of the remaining `other` is not a pattern gap: it is adverts that are not target roles (contracts, commissioning, construction and mechanical roles), which points at the saved searches.
| `AI transformation` | 2 |

A third of adverts fall through, so the first table is a starting point, not a finished one. The most frequent `other` titles show three gap classes: team-lead titles that carry an agile qualifier, release-train-engineer titles, and director or head-of-engineering titles. A fourth is a near-miss: an "agile coach" variant with a qualifier between the two words, which the `agile coach` phrase does not match because the phrase is matched as adjacent whole words. No titles or companies are recorded here, as they are personal data.

## Not done

- **First real build into the operator's Sheet.** Both pre-build checks are done (2026-10-05): the operator found no hand-typed `Role Family` header (OQ-8), and `S1` reported `WORKS` for 3,052 requests in one batch, HTTP 200, 0.5 MB (OQ-7). `build --target sheets --dry-run` planned `columns to append: 1 (Role Family)` and 3,050 cell changes, with the tuning view showing 759 of 3,050 adverts as `other`. The real build is not yet recorded here.
- **Further pattern tuning.** The first round cut `other` from 32.2% to 24.9%. More is a table edit plus golden rows and a matching edit to the oracle copy in `support-builders.test.mjs`; which families and patterns to add is the human's call. Tightening the saved searches would shrink `other` more than patterns can.
- **Create path and `--in` rebuild do not print the tuning view.** DESIGN did not pin them and DISTILL left presence unpinned either way.
- **Filters and pivots over an appended column are unverified.** Google's behaviour for an existing filter or pivot range when a column is appended is unknown; the Sheets fake does not model it.
- **CI**: unchanged project-level open item.
