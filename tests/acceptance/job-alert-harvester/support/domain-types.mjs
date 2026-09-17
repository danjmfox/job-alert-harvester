// Domain vocabulary for the harvester's acceptance tests (nWave Mandate-12).
//
// Production owns the domain nouns — refusal codes, column ownership, quarantine
// reasons are re-exported from src/ so there is one definition, not two. This
// module adds only the builders that shape fixtures, and the CLI runner that is
// the single place a subprocess invocation is spelled out.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

export { KEY_COLUMN, HARVESTER_COLUMNS, HUMAN_COLUMNS } from '../../../../src/core/merge.mjs';
export { QuarantineReason, MINIMUM_DIGEST_BODY_LENGTH } from '../../../../src/core/slim.mjs';
export { CoverageRefusal } from '../../../../src/core/coverage.mjs';
export { LedgerRefusal } from '../../../../src/adapters/ledger-store.mjs';
export { SpillRefusal } from '../../../../src/adapters/raw-spill-source.mjs';
export { TargetRefusal } from '../../../../src/adapters/xlsx-target-sheet.mjs';

export const PROJECT_ROOT = new URL('../../../../', import.meta.url).pathname;
export const CLI = join(PROJECT_ROOT, 'src/cli/harvest.mjs');

/** Columns the harvester does not recognise; preserved verbatim in position and value. */
export const UNKNOWN_COLUMNS = Object.freeze(['My Notes', 'Recruiter Phone']);

// ---------------------------------------------------------------- workspaces

/** An isolated working directory. Subcommands resolve .cache/ relative to it. */
export function aWorkspace() {
  return mkdtempSync(join(tmpdir(), 'harvest-'));
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
  return path;
}

export function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
  return path;
}

// ------------------------------------------------------------------ builders

/** A closed coverage interval. */
export function anInterval({ from, to, source = 'linkedin', messageCount = 1, completedAt = '2026-08-01T00:00:00Z' }) {
  return { source, from, to, completedAt, messageCount };
}

/**
 * A LinkedIn digest body: one block per job, separated the way LinkedIn separates them,
 * each block carrying the kind of tracking-laden `View job:` link parse-linkedin.mjs
 * actually parses. Card shape (title/company/location triple, blank line, then a
 * one-to-two-line hiring-status run before `View job:`) is copied from the committed
 * fixtures at fixtures/linkedin/*.json — never a 3rd link-run prefix line, which would
 * shift the card per DR-0008's run-and-prefix rule. Header/footer filler is likewise
 * copied from those fixtures (the digest preamble and the LinkedIn sign-off block);
 * padding never lives inside a card's own runs.
 */
export function aDigestBody({ jobs, searchTerm = 'agile coach in United Kingdom' }) {
  const blocks = jobs.map(
    (job) =>
      `${job.title}\n${job.company}\n${job.location ?? 'United Kingdom'}\n\n` +
      'This company is actively hiring\n' +
      'Apply with resume & profile\n' +
      `View job: https://www.linkedin.com/comm/jobs/view/${job.id}/` +
      `?trackingId=REDACTED&refId=REDACTED` +
      `&lipi=REDACTED` +
      `&midToken=REDACTED&midSig=REDACTED` +
      `&trk=REDACTED` +
      `&trkEmail=REDACTED` +
      '&otpToken=REDACTED\n',
  );
  return (
    `Your job alert for ${searchTerm}\n\n` +
    blocks.join('\n---------------------------------------------------------\n\n') +
    '\n\nSee all jobs on LinkedIn: https://www.linkedin.com/jobs/collections/recommended/\n' +
    'Manage your job alerts: https://www.linkedin.com/comm/jobs/alerts\n\n' +
    'Job search smarter with Premium\n' +
    'https://www.linkedin.com/premium/products/\n\n' +
    '----------------------------------------\n\n' +
    'This email was intended for the address on your LinkedIn account.\n' +
    'Unsubscribe: https://www.linkedin.com/comm/psettings/email-unsubscribe\n\n' +
    '© 2026 LinkedIn Corporation, 1000 West Maude Avenue, Sunnyvale, CA 94085.\n' +
    'LinkedIn and the LinkedIn logo are registered trademarks of LinkedIn.\n'
  );
}

/** A slimmed message record — the shape the cache and the fixtures both use. */
export function aMessage({
  id = '19f9b40545ae5bbf',
  date = '2026-07-25T09:48:00Z',
  sender = 'jobalerts-noreply@linkedin.com',
  subject = 'Scrum Master & PMO Lead at Digital Waffle',
  jobs = [{ id: '4445119872', title: 'Scrum Master & PMO Lead', company: 'Digital Waffle' }],
  plaintextBody,
  searchTerm,
}) {
  return {
    id,
    date,
    sender,
    subject,
    snippet: subject,
    plaintextBody: plaintextBody ?? aDigestBody({ jobs, ...(searchTerm ? { searchTerm } : {}) }),
  };
}

/**
 * A raw connector spill payload — the flat JSON the harness actually writes to
 * disk (DR-0007). No `{ result: ... }` wrapper: the file *is* the message. Key
 * set mirrors a real captured message (fixtures/spill/mcp-*-get_message-*.txt):
 * the six record keys slim() keeps, plus the connector-only keys it is expected
 * to drop.
 */
export function aSpillPayload(overrides = {}) {
  const message = aMessage(overrides);
  return {
    ...message,
    historyId: overrides.historyId ?? '3362946',
    htmlBody: overrides.htmlBody ?? '<html><body>Job alert digest</body></html>',
    internalDate: overrides.internalDate ?? '1789235310000',
    labelIds: overrides.labelIds ?? ['UNREAD', 'INBOX'],
    sizeEstimate: overrides.sizeEstimate ?? 75295,
    threadId: overrides.threadId ?? message.id,
    toRecipients: overrides.toRecipients ?? ['me@example.invalid'],
  };
}

let spillFileSequence = 0;

/**
 * The filename the harness actually writes when it fetches a message
 * (DR-0007): `mcp-<connector-id>-get_message-<epoch-ms>.txt`. Selection is by
 * this pattern, never by file extension alone — the directory is shared with
 * unrelated tool output.
 */
export function aSpillFileName({ connectorId = '62a90b7b-7d1b-4f3b-b3b7-8a73582688a6', epochMs } = {}) {
  const stamp = epochMs ?? 1789314619969 + spillFileSequence++;
  return `mcp-${connectorId}-get_message-${stamp}.txt`;
}

export const SPILL_FIXTURES_DIR = join(PROJECT_ROOT, 'fixtures/spill');

/** Copies every real spill fixture (DR-0007) into `spillDir`, byte-identical. */
export function installRealSpillFixtures(spillDir) {
  mkdirSync(spillDir, { recursive: true });
  for (const name of readdirSync(SPILL_FIXTURES_DIR)) {
    writeFileSync(join(spillDir, name), readFileSync(join(SPILL_FIXTURES_DIR, name)));
  }
  return spillDir;
}

/** A row as it appears in the tracker's Jobs tab. */
export function aSheetRow(overrides = {}) {
  return {
    'Dedup Key': 'linkedin:4441092711',
    'Status': null,
    'Job': 'Agile Coach',
    'Date Discovered': '2026-07-25',
    'Advert Link': 'https://www.linkedin.com/jobs/view/4441092711/',
    'Company': 'Stealth iT Consulting',
    'Location': 'United Kingdom',
    'Permanent/Contract': null,
    'Onsite/Hybrid/Remote': null,
    'Full time/Part Time': null,
    'Min Salary (annual)': null,
    'Max Salary (annual)': null,
    'Min Salary (hourly)': null,
    'Day Rate': null,
    'Qualified?': null,
    'Applied on Date': null,
    'Source': 'LinkedIn',
    'Source Type': 'recruiter',
    'Fit Score': 3,
    'Fit Reason': 'agile coach',
    'First Seen': '2026-07-25T09:48:00Z',
    'Last Seen': '2026-07-25T21:48:00Z',
    'Times Seen': 4,
    ...overrides,
  };
}

/** The state of a tracker as TargetSheet.read() reports it. */
export function aTrackerContaining(rows, { columns, tab = 'Jobs' } = {}) {
  return { tabs: { [tab]: { columns: columns ?? Object.keys(rows[0] ?? aSheetRow()), rows } } };
}

/** A harvest model as core/harvest.mjs produces it. */
export function aHarvestOf(rows) {
  return { jobs: { columns: Object.keys(rows[0] ?? aSheetRow()), rows } };
}

// ------------------------------------------------------------------- running

/** Invokes the real command-line entry point. Never throws on a non-zero exit. */
export function runHarvest(args, { cwd = PROJECT_ROOT } = {}) {
  const result = spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** The refusal code carried by whatever `action` threw, or null if it did not throw. */
export function refusalOf(action) {
  try {
    action();
  } catch (error) {
    return error.code ?? error.message;
  }
  return null;
}

// ---------------------------------------------------------------- observables

/** Every file under `root`, as `relative/path -> sha256`. Absent root reads as {}. */
export function fileDigests(root) {
  const digests = {};
  const walk = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path, name);
      else digests[name] = createHash('sha256').update(readFileSync(path)).digest('hex');
    }
  };
  try {
    if (statSync(root).isDirectory()) walk(root, '');
  } catch {
    return {};
  }
  return digests;
}

/** The message ids the cache holds, ascending. Absent cache reads as []. */
export function cachedMessageIds(cacheRoot) {
  return Object.keys(fileDigests(cacheRoot))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.split('/').pop().replace(/\.json$/, ''))
    .sort();
}

/** The coverage intervals the ledger holds. Absent ledger reads as []. */
export function committedCoverage(ledgerPath) {
  try {
    return JSON.parse(readFileSync(ledgerPath, 'utf8'));
  } catch {
    return [];
  }
}
