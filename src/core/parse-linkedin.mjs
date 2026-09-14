// PURE. Parses a LinkedIn job-alert email into raw job rows.
// No fs, no clock, no randomness — same message in, same rows out.

const BLOCK_SEPARATOR = /^-{20,}$/m;
const JOB_ID_IN_URL = /\/jobs\/view\/(\d+)/;
const SEARCH_TERM_LINE = /^Your job alert for (.+)$/m;

// Interstitials LinkedIn sprinkles between the job link and its title/company/
// location triple. Closed set — anchoring on the job link makes widening this
// unnecessary; a line outside this set is assumed to carry a triple field.
const TRAILING_NOISE_LINE = [
  /^This company is actively hiring$/,
  /^Apply with resume(?: & profile)?$/,
  /^\d+ connections?$/,
  /^\d+ company alum(?:ni)?$/,
  /^\d+ school alum(?:ni)?$/,
  /^Promoted$/,
  /^Easy Apply$/,
  /^Actively recruiting$/,
  /^(?:up to\s*)?£[\d.,]+[KkMm]?(?:\s*-\s*£[\d.,]+[KkMm]?)?\s*\/\s*(?:year|hour|day)$/,
];

// Only an annual card salary is captured onto the row. Hourly/day-rate lines
// still match TRAILING_NOISE_LINE above (so they cannot shift the triple) but
// are deliberately excluded here — DR-0004 keeps `Min Salary (hourly)` and
// `Day Rate` as human-owned columns until a parser earns its own `(derived)` sibling.
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

function isTrailingNoise(line) {
  return line === '' || TRAILING_NOISE_LINE.some((pattern) => pattern.test(line));
}

/**
 * Walk backward from a job link, skipping trailing noise, and take the next
 * three meaningful lines as [location, company, title] — closest to the link
 * first. Returns them reordered as [title, company, location], plus any
 * per-card annual salary found among the skipped noise (or null).
 */
function cardAbove(lines, linkLineIndex) {
  const collected = [];
  let cardSalary = null;
  for (let i = linkLineIndex - 1; i >= 0 && collected.length < 3; i -= 1) {
    const line = lines[i].trim();
    if (isTrailingNoise(line)) {
      cardSalary = cardSalary ?? parseCardSalaryLine(line);
      continue;
    }
    collected.push(line);
  }
  const [location, company, title] = collected;
  return { title: title ?? null, company: company ?? null, location: location ?? null, cardSalary };
}

/** A job card for one `/jobs/view/{id}` link, or null if the link or its triple is incomplete. */
function jobAtLine(lines, rawLine, index) {
  const jobIdMatch = rawLine.match(JOB_ID_IN_URL);
  if (!jobIdMatch) return null;

  const { title, company, location, cardSalary } = cardAbove(lines, index);
  if (!title || !company) return null;

  const jobId = jobIdMatch[1];
  return {
    dedupKey: `linkedin:${jobId}`,
    title,
    company,
    location,
    cardSalary,
    // Canonical link: every tracking parameter discarded.
    advertLink: `https://www.linkedin.com/jobs/view/${jobId}/`,
  };
}

/** Every `/jobs/view/{id}` occurrence in a block anchors its own card — a block may carry several. */
function parseBlockJobs(block) {
  const lines = block.split('\n');
  return lines.map((rawLine, index) => jobAtLine(lines, rawLine, index)).filter(Boolean);
}

/** Blocks split on a run of 20+ dashes. */
function parseBlocks(plaintextBody) {
  return plaintextBody.split(BLOCK_SEPARATOR).flatMap(parseBlockJobs);
}

/**
 * One message -> the job rows it advertises. A job's own card salary always
 * wins (it is the more specific figure); otherwise the first block — the
 * headline job named in the subject — inherits the subject's salary.
 */
export function extractJobs(message) {
  const searchTerm = parseSearchTerm(message.plaintextBody);
  const subjectSalary = parseSalaryFromSubject(message.subject);

  return parseBlocks(message.plaintextBody).map(({ cardSalary, ...job }, index) => {
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
