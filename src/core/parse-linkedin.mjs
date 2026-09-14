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
];

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
 * Salary lives ONLY in the subject line, and therefore belongs ONLY to the
 * headline job the subject names — never to the rest of the digest.
 *   ": up to £75K/year"        -> { min: null,  max: 75000 }
 *   ": £55K-£70K / year salary" -> { min: 55000, max: 70000 }
 *   ": £70K/year"               -> { min: 70000, max: 70000 }
 */
export function parseSalaryFromSubject(subject) {
  const match = subject.match(
    /:\s*(up to\s*)?£\s*([\d.,]+)\s*([KkMm])?(?:\s*-\s*£\s*([\d.,]+)\s*([KkMm])?)?/,
  );
  if (!match) return { min: null, max: null };

  const [, upTo, lowDigits, lowMagnitude, highDigits, highMagnitude] = match;
  const low = toAnnualAmount(lowDigits, lowMagnitude);
  if (highDigits) return { min: low, max: toAnnualAmount(highDigits, highMagnitude) };
  if (upTo) return { min: null, max: low };
  return { min: low, max: low };
}

function isTrailingNoise(line) {
  return line === '' || TRAILING_NOISE_LINE.some((pattern) => pattern.test(line));
}

/**
 * Walk backward from a job link, skipping trailing noise, and take the next
 * three meaningful lines as [location, company, title] — closest to the link
 * first. Returns them reordered as [title, company, location].
 */
function tripleAbove(lines, linkLineIndex) {
  const collected = [];
  for (let i = linkLineIndex - 1; i >= 0 && collected.length < 3; i -= 1) {
    const line = lines[i].trim();
    if (isTrailingNoise(line)) continue;
    collected.push(line);
  }
  const [location, company, title] = collected;
  return { title: title ?? null, company: company ?? null, location: location ?? null };
}

/** A job card for one `/jobs/view/{id}` link, or null if the link or its triple is incomplete. */
function jobAtLine(lines, rawLine, index) {
  const jobIdMatch = rawLine.match(JOB_ID_IN_URL);
  if (!jobIdMatch) return null;

  const { title, company, location } = tripleAbove(lines, index);
  if (!title || !company) return null;

  const jobId = jobIdMatch[1];
  return {
    dedupKey: `linkedin:${jobId}`,
    title,
    company,
    location,
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
 * One message -> the job rows it advertises. The first block is the headline
 * job named in the subject, so it alone inherits the subject's salary.
 */
export function extractJobs(message) {
  const searchTerm = parseSearchTerm(message.plaintextBody);
  const salary = parseSalaryFromSubject(message.subject);

  return parseBlocks(message.plaintextBody).map((job, index) => ({
    ...job,
    minSalary: index === 0 ? salary.min : null,
    maxSalary: index === 0 ? salary.max : null,
    searchTerm,
    seenAt: message.date,
    messageId: message.id,
    sender: message.sender,
  }));
}
