// PURE. Parses a LinkedIn job-alert email into raw job rows.
// No fs, no clock, no randomness — same message in, same rows out.

const BLOCK_SEPARATOR = /^-{20,}$/m;
const JOB_ID_IN_URL = /\/jobs\/view\/(\d+)/;
const SEARCH_TERM_LINE = /^Your job alert for (.+)$/m;

// The card-level salary line (e.g. "£59K-£78K / year") is recognised in order
// to be read, never in order to be skipped — DR-0008 makes triple extraction
// positional, so no denylist is needed to protect the triple from this line.
// Only an annual figure is captured onto the row; hourly/day-rate lines are
// deliberately excluded — DR-0004 keeps `Min Salary (hourly)` and `Day Rate`
// as human-owned columns until a parser earns its own `(derived)` sibling.
const CARD_SALARY_AMOUNT_LINE =
  /^(up to\s*)?£\s*([\d.,]+)\s*([KkMm])?(?:\s*-\s*£\s*([\d.,]+)\s*([KkMm])?)?\s*\/\s*year$/;

const ANNUAL_UNIT = 'year';

/** The saved search that produced this alert, e.g. "scrum master in England". */
export function parseSearchTerm(plaintextBody) {
  const match = plaintextBody.match(SEARCH_TERM_LINE);
  return match ? match[1].trim() : null;
}

function toAnnualAmount(digits, magnitude) {
  const value = Number(digits.replace(/,/g, ''));
  if (Number.isNaN(value)) return null;
  if (/[Kk]/.test(magnitude ?? '')) return value * 1000;
  if (/[Mm]/.test(magnitude ?? '')) return value * 1000000;
  return value;
}

/**
 * Shared by subject-line and per-card salary parsing: a low bound, an optional
 * high bound, or an "up to" ceiling — plus the rate and its unit, always
 * returned so a caller can route a non-annual rate without re-parsing. Annual
 * (min, max) are populated only when unit is "year"; any other unit files no
 * annual salary at all (DR-0004: hourly/day figures are human-owned columns).
 */
function salaryRange(upTo, lowDigits, lowMagnitude, highDigits, highMagnitude, unit = ANNUAL_UNIT) {
  const low = toAnnualAmount(lowDigits, lowMagnitude);
  const high = highDigits ? toAnnualAmount(highDigits, highMagnitude) : low;
  const rateMin = highDigits ? low : upTo ? null : low;
  const rate = { min: rateMin, max: high, unit };

  const isAnnual = unit === ANNUAL_UNIT;
  return { min: isAnnual ? rate.min : null, max: isAnnual ? rate.max : null, rate };
}

/**
 * Salary lives ONLY in the subject line, and therefore belongs ONLY to the
 * headline job the subject names — never to the rest of the digest.
 *   ": up to £75K/year"        -> { min: null,  max: 75000 }
 *   ": £55K-£70K / year salary" -> { min: 55000, max: 70000 }
 *   ": £70K/year"               -> { min: 70000, max: 70000 }
 */
export function parseSalaryFromSubject(subject) {
  const match = subject.match(
    /:\s*(up to\s*)?£\s*([\d.,]+)\s*([KkMm])?(?:\s*-\s*£\s*([\d.,]+)\s*([KkMm])?)?(?:\s*\/\s*(year|hour|day))?/,
  );
  if (!match) return { min: null, max: null, rate: null };

  const [, upTo, lowDigits, lowMagnitude, highDigits, highMagnitude, unit] = match;
  return salaryRange(upTo, lowDigits, lowMagnitude, highDigits, highMagnitude, unit ?? ANNUAL_UNIT);
}

/** A per-card annual salary line (e.g. "£59K-£78K / year"), or null if the line isn't one. */
function parseCardSalaryLine(line) {
  const match = line.match(CARD_SALARY_AMOUNT_LINE);
  if (!match) return null;

  const [, upTo, lowDigits, lowMagnitude, highDigits, highMagnitude] = match;
  return salaryRange(upTo, lowDigits, lowMagnitude, highDigits, highMagnitude);
}

/**
 * Groups a block's lines into runs of consecutive non-blank, trimmed lines —
 * LinkedIn renders each card as one such run next to its link (DR-0008). The
 * message-level search-term header (already anchored by its own permanent
 * pattern, SEARCH_TERM_LINE, and parsed separately) is treated as a run
 * boundary rather than card content when it sits flush against a card with no
 * blank line between them. Each entry keeps its original line index so a run
 * can be matched back to the link line found elsewhere in the block.
 */
function runsOf(lines) {
  const grouped = lines.reduce(
    (acc, rawLine, index) => {
      const text = SEARCH_TERM_LINE.test(rawLine) ? '' : rawLine.trim();
      if (text === '') {
        return acc.current ? { runs: [...acc.runs, acc.current], current: null } : acc;
      }
      return { runs: acc.runs, current: [...(acc.current ?? []), { text, index }] };
    },
    { runs: [], current: null },
  );
  return grouped.current ? [...grouped.runs, grouped.current] : grouped.runs;
}

/** The run holding the given original line index, or -1 if none does. */
function runIndexContaining(runs, lineIndex) {
  return runs.findIndex((run) => run.some((entry) => entry.index === lineIndex));
}

/**
 * The card for a link found in `runs[linkRunIndex]` at `linkEntryIndex`
 * within that run (DR-0008 run-and-prefix rule): the run's lines before the
 * link when there are 3 or more of them, otherwise the immediately preceding
 * run. Returned as plain line text, closest-to-link-run first.
 */
function cardFor(runs, linkRunIndex, linkEntryIndex) {
  const prefix = runs[linkRunIndex].slice(0, linkEntryIndex).map((entry) => entry.text);
  if (prefix.length >= 3) return prefix;
  return (runs[linkRunIndex - 1] ?? []).map((entry) => entry.text);
}

/** The first recognisable annual salary line among a card's lines past the triple. */
function cardSalaryIn(card) {
  return card.slice(3).reduce((found, line) => found ?? parseCardSalaryLine(line), null);
}

/** A job card for one `/jobs/view/{id}` link, or null if the link or its triple is incomplete. */
function jobAtLine(runs, rawLine, index) {
  const jobIdMatch = rawLine.match(JOB_ID_IN_URL);
  if (!jobIdMatch) return null;

  const linkRunIndex = runIndexContaining(runs, index);
  const linkEntryIndex = runs[linkRunIndex].findIndex((entry) => entry.index === index);
  const card = cardFor(runs, linkRunIndex, linkEntryIndex);
  if (card.length < 3) return null;

  const [title, company, location] = card;
  const jobId = jobIdMatch[1];
  return {
    dedupKey: `linkedin:${jobId}`,
    title,
    company,
    location,
    cardSalary: cardSalaryIn(card),
    // Canonical link: every tracking parameter discarded.
    advertLink: `https://www.linkedin.com/jobs/view/${jobId}/`,
  };
}

/** Every `/jobs/view/{id}` occurrence in a block anchors its own card — a block may carry several. */
function parseBlockJobs(block) {
  const lines = block.split('\n');
  const runs = runsOf(lines);
  return lines.map((rawLine, index) => jobAtLine(runs, rawLine, index)).filter(Boolean);
}

/** Blocks split on a run of 20+ dashes. */
function parseBlocks(plaintextBody) {
  return plaintextBody.split(BLOCK_SEPARATOR).flatMap(parseBlockJobs);
}

/** Every line advertising a `/jobs/view/{id}` link, counted once per line (DR-0008/DR-0006). */
function countAdvertisedLinks(plaintextBody) {
  return plaintextBody.split('\n').filter((line) => JOB_ID_IN_URL.test(line)).length;
}

/**
 * One message -> the job rows it advertises. A job's own card salary always
 * wins (it is the more specific figure); otherwise the first block — the
 * headline job named in the subject — inherits the subject's salary.
 *
 * Every advertised link must yield a row: a card too short to read (DR-0008's
 * >= 3 discriminator failing) would otherwise vanish silently via
 * `.filter(Boolean)`. Refusing the whole message keeps that loss loud
 * (DR-0006 rule 2) — a rebuild from cache is cheap, a silently short sheet is not.
 */
export function extractJobs(message) {
  const searchTerm = parseSearchTerm(message.plaintextBody);
  const subjectSalary = parseSalaryFromSubject(message.subject);
  const jobs = parseBlocks(message.plaintextBody);

  const advertisedLinks = countAdvertisedLinks(message.plaintextBody);
  if (advertisedLinks !== jobs.length) {
    throw new Error(
      `linkedin: message ${message.id} advertises ${advertisedLinks} job links but yielded ${jobs.length} rows` +
        ` — refusing rather than dropping ${advertisedLinks - jobs.length} cards`,
    );
  }

  return jobs.map(({ cardSalary, ...job }, index) => {
    const salary = cardSalary ?? (index === 0 ? subjectSalary : { min: null, max: null, rate: null });
    return {
      ...job,
      minSalary: salary.min,
      maxSalary: salary.max,
      // The rate feeding minSalary/maxSalary, kept alongside them so a later
      // routing step (hourly/day-rate columns, DR-0004) need not re-parse.
      rate: salary.rate,
      searchTerm,
      seenAt: message.date,
      messageId: message.id,
      sender: message.sender,
    };
  });
}
