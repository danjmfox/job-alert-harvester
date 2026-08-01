// PURE. Is the advertiser the employer, or an agency advertising on their behalf?
// Deliberately incomplete and trivially extendable: a known-name set plus a
// small keyword list. Everything unrecognised is assumed to be the employer.

const KNOWN_RECRUITERS = new Set([
  'lorien',
  'hackajob',
  'stealth it consulting',
  'calibre candidates',
  'la fosse',
  'adroit people',
  'digital waffle',
  'haystack',
  'searchability',
  'akkodis',
  'roc search',
]);

const RECRUITER_KEYWORDS = [
  'recruit',
  'resourcing',
  'staffing',
  'headhunt',
  'talent solutions',
];

export function classifySourceType(company) {
  const name = (company ?? '').trim().toLowerCase();
  if (KNOWN_RECRUITERS.has(name)) return 'recruiter';
  if (RECRUITER_KEYWORDS.some((keyword) => name.includes(keyword))) return 'recruiter';
  return 'employer';
}
