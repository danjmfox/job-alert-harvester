---
id: DR-0006
status: accepted
dateCreated: 2026-08-01
domain: job-alert-harvester
changelog:
  - date: 2026-08-01
    version: 0.1.0
    note: Encodes SPIKE finding F1 (all LinkedIn alerts are digests) structurally
  - date: 2026-08-03
    version: 1.0.0
    note: Accepted after review

---

# Source registry: descriptors are data, extractors return arrays

## Context

This iteration harvests LinkedIn only. Seven more sources are queued — Welcome to the Jungle,
Jobs/Redefined, Google alerts, BBC jobs2web, Built In, cord, LinkedIn `jobs-noreply`. The constraint
is to build the seam now so that adding them is not a rewrite, without building the adapters.

SPIKE finding F1 is the sharp edge here. The subject line of a LinkedIn alert names one job; the body
carried three. **Every LinkedIn alert is a digest**, and subject-only parsing would have silently
lost about two thirds of all jobs. The natural next step after that discovery is to add a
`shape: 'digest' | 'single'` field to a source descriptor — and that is exactly the mistake, because
it recreates the branch that caused the loss and invites every future source to guess its own shape.

Two other findings shape the seam. Dedup keys are per-source: LinkedIn exposes `/jobs/view/(\d+)`
(F2), and sources without a canonical id need the fuzzy `hash(company|title|location)` fallback.
Search terms are recoverable from the body (F4), so the Sources tab is derived, but the line that
carries them (`Your job alert for …`) is LinkedIn-specific.

## Options Considered

### Option 1: No registry yet — keep the LinkedIn parser wired directly, generalise on source two

- **Advantage:** zero speculative structure; the second source teaches you what the abstraction
  should be.
- **Disadvantage:** the constraint explicitly asks for the seam now, and the seam is roughly fifteen
  lines. More importantly, the F1 lesson is *live* — it should be encoded while the reason for it is
  fresh, not rediscovered by whoever adds source two.
- **Verdict:** rejected, narrowly. Ordinarily this would be the right call.

### Option 2: A parser base class or interface with a `shape` discriminator

- **Advantage:** familiar; explicit about how each source is laid out.
- **Disadvantage:** the discriminator is the F1 bug in structural form. It also imports class-based
  inheritance into a codebase that has neither classes nor mutation in its core.
- **Verdict:** rejected.

### Option 3: Descriptors are plain data; extractors always return arrays — *chosen*

- **What:**
  ```
  SourceDescriptor = {
    id:        'linkedin',
    label:     'LinkedIn',
    matches:   (message) => boolean,        // sender / subject predicate
    extract:   (message) => RawJobRow[],    // pure; ALWAYS an array
    dedupKey:  (rawJob)  => string,         // canonical id, or fuzzyKey(...)
  }
  ```
  The registry is an array of descriptors. `selectSource(message, registry)` returns the first match.
- **Advantage:** there is no shape field because there is nowhere to put one — a single-job source is
  simply a source whose extractor returns an array of length one. The F1 bug becomes unrepresentable
  rather than documented. Descriptors are data, so the registry is testable without I/O and a new
  source is one file plus one array entry.
- **Disadvantage:** a source that genuinely benefits from streaming (none foreseeable at ~1k
  messages/year) would have to be materialised.

## Decision

**A source is a plain-data descriptor. `extract` always returns an array. There is no source shape.**

```
src/core/sources/
  registry.mjs      selectSource(message, registry); the registry array
  linkedin.mjs      the LinkedIn descriptor — wraps the existing parse-linkedin.mjs unchanged
src/core/dedup.mjs  canonicalKey(prefix, id) and fuzzyKey(company, title, location)
```

### Rules

1. **`extract` returns an array, always.** No source declares a shape.
2. **Unmatched messages are captured, never dropped.** A message matching no descriptor is recorded
   in an `Unmatched` bucket with its id and sender, and reported. The capture-everything constraint
   applies to messages as much as to jobs; a silently skipped message is the F1 failure at a
   different scale.
3. **Dedup key strategy is the descriptor's.** `canonicalKey('linkedin', jobId)` where the source
   exposes a stable id; `fuzzyKey(...)` — normalised case, collapsed whitespace, stripped
   punctuation — only where it does not. Keys are namespaced by source id so two sources can never
   collide, and a job seen on two sources is deliberately two rows: the same role advertised by an
   agency and by the employer is genuinely two adverts.
4. **Search-term extraction is the descriptor's business.** The Sources tab consumes whatever
   `extract` attaches to a row; sources that expose no search term leave it null and simply produce
   no Sources rows.
5. **`core/harvest.mjs` becomes source-agnostic.** Its `const SOURCE = 'LinkedIn'` is replaced by the
   descriptor's label. Dedup, upsert, and tab assembly are unchanged — they already key on a
   `dedupKey` field the extractor supplies, which is why this generalises without touching the
   collapse logic at all.

### Consequences

- `parse-linkedin.mjs` moves behind a descriptor with **no change to its logic**. The salary-smearing
  fix, the noise-line filter and the canonical-link reconstruction all stay exactly as tested.
- Adding a source is: one descriptor file, one registry entry, fixtures, and an acceptance test. No
  existing module changes.
- The two known parser gaps — the fit scorer under-rating *"Agile Delivery, Scrum and Coaching"*
  (Capgemini Invent, scores 1), and untested salary-range parsing — are **not fixed here**. They live
  in `fit.mjs` and `parse-linkedin.mjs` and are unaffected by this decision. They are carried forward
  as known defects.
- `Source Type` classification (`classify.mjs`) stays global rather than per-source: recruiters appear
  across every source and one list is better than eight.

## Exceptions

Revisit if:

- **A source needs stateful or cross-message extraction** (a job split across two emails). `extract`
  is per-message by design and would need to become corpus-level.
- **Two sources need genuinely different row schemas.** Today all sources produce the same `RawJobRow`.
  A source carrying materially different fields would push toward per-source columns.
- **The registry passes roughly a dozen sources.** First-match-wins ordering becomes a subtle
  dependency at that size and would want explicit priority.
