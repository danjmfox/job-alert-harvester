// PURE. Parses a LinkedIn job-alert email into raw job rows.
// No fs, no clock, no randomness — same message in, same rows out.

const BLOCK_SEPARATOR = /^-{20,}$/m;
const JOB_ID_IN_URL = /\/jobs\/view\/(\d+)/;
const SEARCH_TERM_LINE = /^Your job alert for (.+)$/m;

// Interstitials LinkedIn sprinkles between the title/company/location triple.
const NOISE_LINE = [
  /^Your job alert for /,
  /^View job:/,
  /^This company is actively hiring$/,
  /^Apply with resume/,
  /^See all jobs/,
  /^Manage your job alerts/,
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

function isNoise(line) {
  return NOISE_LINE.some((pattern) => pattern.test(line));
}

function meaningfulLines(block) {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !isNoise(line));
}

/** Blocks split on a run of 20+ dashes; only blocks carrying a job link count. */
function parseBlocks(plaintextBody) {
  const jobs = [];
  for (const block of plaintextBody.split(BLOCK_SEPARATOR)) {
    const jobIdMatch = block.match(JOB_ID_IN_URL);
    if (!jobIdMatch) continue;

    const [title, company, location] = meaningfulLines(block);
    if (!title || !company) continue;

    const jobId = jobIdMatch[1];
    jobs.push({
      dedupKey: `linkedin:${jobId}`,
      title,
      company,
      location: location ?? null,
      // Canonical link: every tracking parameter discarded.
      advertLink: `https://www.linkedin.com/jobs/view/${jobId}/`,
    });
  }
  return jobs;
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
