// PURE. Messages in, workbook model out. Dedup, upsert and tab assembly all
// happen here — never in an adapter, because resends are partially-overlapping
// digests that can only be collapsed after every body has been extracted.

import { extractJobs } from './parse-linkedin.mjs';
import { classifySourceType } from './classify.mjs';
import { scoreFit } from './fit.mjs';

const SOURCE = 'LinkedIn';

export const JOBS_COLUMNS = [
  'Status',
  'Job',
  'Date Discovered',
  'Advert Link',
  'Company',
  'Location',
  'Permanent/Contract',
  'Onsite/Hybrid/Remote',
  'Full time/Part Time',
  'Min Salary (annual)',
  'Max Salary (annual)',
  'Min Salary (hourly)',
  'Day Rate',
  'Min Rate (derived)',
  'Max Rate (derived)',
  'Rate Unit (derived)',
  'Qualified?',
  'Applied on Date',
  'Source',
  'Source Type',
  'Fit Score',
  'Fit Reason',
  'Dedup Key',
  'First Seen',
  'Last Seen',
  'Times Seen',
];

export const SOURCES_COLUMNS = [
  'Source',
  'Search Term',
  'Sender',
  'First Seen',
  'Last Seen',
  'Messages',
  'Jobs Found',
];

export const COMPANIES_COLUMNS = [
  'Company',
  'Source Type',
  'Jobs Seen',
  'First Seen',
  'Last Seen',
];

const byTimestamp = (a, b) => a.localeCompare(b);

/** Widen a first-seen/last-seen window to admit another sighting. */
function widenSeenWindow(window, firstSeen, lastSeen) {
  if (firstSeen < window.firstSeen) window.firstSeen = firstSeen;
  if (lastSeen > window.lastSeen) window.lastSeen = lastSeen;
}

/** Collapse repeated advertisements of the same canonical job into one record. */
function upsertByDedupKey(rows) {
  const collapsed = new Map();

  for (const row of [...rows].sort((a, b) => byTimestamp(a.seenAt, b.seenAt))) {
    const existing = collapsed.get(row.dedupKey);
    if (!existing) {
      collapsed.set(row.dedupKey, {
        ...row,
        firstSeen: row.seenAt,
        lastSeen: row.seenAt,
        timesSeen: 1,
      });
      continue;
    }
    existing.lastSeen = row.seenAt;
    existing.timesSeen += 1;
    // A later sighting may carry salary the first one lacked (headline rotation).
    existing.minSalary ??= row.minSalary;
    existing.maxSalary ??= row.maxSalary;
  }

  return [...collapsed.values()];
}

/** The derived rate columns exist only for rates the annual columns cannot express. */
function derivedRateOf(job) {
  const rate = job.rate ?? { min: null, max: null, unit: null };
  if (rate.unit === 'year') return { min: null, max: null, unit: null };
  return rate;
}

function toJobsRow(job) {
  const fit = scoreFit(job.title);
  const rate = derivedRateOf(job);
  return {
    'Status': null,
    'Job': job.title,
    'Date Discovered': job.firstSeen.slice(0, 10),
    'Advert Link': job.advertLink,
    'Company': job.company,
    'Location': job.location,
    'Permanent/Contract': null,
    'Onsite/Hybrid/Remote': null,
    'Full time/Part Time': null,
    'Min Salary (annual)': job.minSalary,
    'Max Salary (annual)': job.maxSalary,
    'Min Salary (hourly)': null,
    'Day Rate': null,
    'Min Rate (derived)': rate.min,
    'Max Rate (derived)': rate.max,
    'Rate Unit (derived)': rate.unit,
    'Qualified?': null,
    'Applied on Date': null,
    'Source': SOURCE,
    'Source Type': classifySourceType(job.company),
    'Fit Score': fit.score,
    'Fit Reason': fit.reason,
    'Dedup Key': job.dedupKey,
    'First Seen': job.firstSeen,
    'Last Seen': job.lastSeen,
    'Times Seen': job.timesSeen,
  };
}

function toSourcesRows(rows) {
  const bySearchTerm = new Map();

  for (const row of rows) {
    const term = row.searchTerm;
    if (!term) continue;
    if (!bySearchTerm.has(term)) {
      bySearchTerm.set(term, {
        sender: row.sender,
        firstSeen: row.seenAt,
        lastSeen: row.seenAt,
        messageIds: new Set(),
        dedupKeys: new Set(),
      });
    }
    const source = bySearchTerm.get(term);
    widenSeenWindow(source, row.seenAt, row.seenAt);
    source.messageIds.add(row.messageId);
    source.dedupKeys.add(row.dedupKey);
  }

  return [...bySearchTerm.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([term, source]) => ({
      'Source': SOURCE,
      'Search Term': term,
      'Sender': source.sender,
      'First Seen': source.firstSeen,
      'Last Seen': source.lastSeen,
      'Messages': source.messageIds.size,
      'Jobs Found': source.dedupKeys.size,
    }));
}

function toCompaniesRows(jobs) {
  const byCompany = new Map();

  for (const job of jobs) {
    if (!byCompany.has(job.company)) {
      byCompany.set(job.company, {
        jobsSeen: 0,
        firstSeen: job.firstSeen,
        lastSeen: job.lastSeen,
      });
    }
    const company = byCompany.get(job.company);
    company.jobsSeen += 1;
    widenSeenWindow(company, job.firstSeen, job.lastSeen);
  }

  return [...byCompany.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, company]) => ({
      'Company': name,
      'Source Type': classifySourceType(name),
      'Jobs Seen': company.jobsSeen,
      'First Seen': company.firstSeen,
      'Last Seen': company.lastSeen,
    }));
}

/** messages[] -> { Sources, Companies, Jobs } row models, in tab order. */
export function harvest(messages) {
  const rawRows = messages.flatMap(extractJobs);
  const jobs = upsertByDedupKey(rawRows).sort(
    (a, b) => byTimestamp(a.firstSeen, b.firstSeen) || a.dedupKey.localeCompare(b.dedupKey),
  );

  return {
    sources: { columns: SOURCES_COLUMNS, rows: toSourcesRows(rawRows) },
    companies: { columns: COMPANIES_COLUMNS, rows: toCompaniesRows(jobs) },
    jobs: { columns: JOBS_COLUMNS, rows: jobs.map(toJobsRow) },
  };
}
