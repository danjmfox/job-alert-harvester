// @contract-shape:bounded-change
// welcome-to-the-jungle-source, slice 01b (US-01b, DR-0019 to DR-0021, DR-0023): a Welcome to the Jungle digest
// that carries only HTML becomes one Jobs row per job it advertises, labelled `Welcome to the Jungle`, with the
// employer alone in Company. Proven offline with `harvest --in <dir> --out <file>` on the synthetic alerts in
// fixtures/wttj/ (no Gmail, no Sheets, no cache). Subprocess acceptance layer: example-only (Mandate 9). The
// properties at the end run on the pure driving port, harvest(), and read an unreadable alert as a reported one.
// Wording pinned here: stderr carries `unparsed message <id> from <sender>: <reason>` for each claimed message
// that could not be read; the reason text is the crafter's.
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { harvest } from '../../../src/core/harvest.mjs';
import { aMessage } from './support/domain-types.mjs';
import { holds } from '../gmail-api-source/support/property.mjs';
import {
  LINKEDIN_BASELINE,
  LINKEDIN_FIXTURES_DIR,
  LINKEDIN_LABEL,
  THREE_CARD_ADVERTS,
  UK_REMOTE,
  WELCOME_LABEL,
  WelcomeAlert,
  aFolderHolding,
  cleanUpFolders,
  linesMentioning,
  rebuild,
  rowsOfGrid,
  unparsedLinePattern,
  welcomeAlertRecord,
} from './support/wttj-fixtures.mjs';
import { assertStateDelta, setTo } from '../../common/state-delta.mjs';

afterEach(cleanUpFolders);

const byCompany = (left, right) => left.Company.localeCompare(right.Company);
const welcomeRows = (jobs) => jobs.filter((row) => row.Source === WELCOME_LABEL).sort(byCompany);
const textCells = (row) => Object.values(row).filter((cell) => typeof cell === 'string');
const advertAsRow = ({ company, job, location, advertLink }) => ({ Company: company, Job: job, Location: location, 'Advert Link': advertLink, Source: WELCOME_LABEL });
const pickCells = (row) => ({ Company: row.Company, Job: row.Job, Location: row.Location, 'Advert Link': row['Advert Link'], Source: row.Source });

describe('@driving_port every card of a digest becomes a row (US-01b, AC-1, AC-2, AC-6)', () => {
  it.skip('turns a digest of three jobs, under a subject that names only the first, into three Welcome to the Jungle rows', () => {
    // Given a cached HTML-only alert advertising three jobs under a subject that names the first
    const alert = welcomeAlertRecord(WelcomeAlert.THREE_CARDS);
    expect(alert.subject).toContain('Northwind Analytics');
    expect(alert.subject).not.toContain('Fabrikam Security');
    expect(alert.subject).not.toContain('Contoso Data');
    const folder = aFolderHolding({ alerts: [WelcomeAlert.THREE_CARDS] });

    // When Dan builds a workbook from the folder
    const built = rebuild(folder);

    // Then the Jobs tab holds three rows, one per job, each with the employer, title, location and card link
    expect(built.status, built.stderr).toBe(0);
    const rows = welcomeRows(built.tabs.Jobs);
    expect(built.tabs.Jobs).toHaveLength(3);
    expect(rows.map(pickCells)).toEqual(THREE_CARD_ADVERTS.map(advertAsRow).sort(byCompany));
  });

  it.skip('keys each row by its source and the job, so a job on two sources would be two rows', () => {
    // Given the three-job alert
    const folder = aFolderHolding({ alerts: [WelcomeAlert.THREE_CARDS] });

    // When Dan builds a workbook from the folder
    const built = rebuild(folder);

    // Then the three rows have three different keys, each namespaced by the Welcome to the Jungle source
    expect(built.status, built.stderr).toBe(0);
    const keys = built.tabs.Jobs.map((row) => row['Dedup Key']);
    expect(new Set(keys).size).toBe(3);
    expect(keys.every((key) => key.startsWith('wttj:'))).toBe(true);
  });

  it.skip('puts the employer alone in Company and drops the tagline from every cell', () => {
    // Given the card for Northwind Analytics, which carries a tagline
    const folder = aFolderHolding({ alerts: [WelcomeAlert.THREE_CARDS] });

    // When Dan builds a workbook from the folder
    const built = rebuild(folder);

    // Then the row's Company is `Northwind Analytics`, and no tagline is part of any cell of any row
    expect(built.status, built.stderr).toBe(0);
    expect(welcomeRows(built.tabs.Jobs).map((row) => row.Company)).toContain('Northwind Analytics');
    for (const { tagline } of THREE_CARD_ADVERTS) {
      for (const row of built.tabs.Jobs) expect(textCells(row).filter((cell) => cell.includes(tagline))).toEqual([]);
    }
  });

  it.skip('keeps a bracket at the end of a title in the title and never reads it as the location', () => {
    // Given a card whose title ends in a bracket, "(AI Platform)"
    const folder = aFolderHolding({ alerts: [WelcomeAlert.THREE_CARDS] });

    // When Dan builds a workbook from the folder
    const built = rebuild(folder);

    // Then the title keeps its bracket and the location stays Remote (within the UK)
    expect(built.status, built.stderr).toBe(0);
    const fabrikam = built.tabs.Jobs.find((row) => row.Company === 'Fabrikam Security');
    expect(fabrikam?.Job).toBe('Engineering Manager (AI Platform)');
    expect(fabrikam?.Location).toBe(UK_REMOTE);
  });

  it.skip('turns a digest of one job into one row', () => {
    // Given a cached alert advertising a single job
    const folder = aFolderHolding({ alerts: [WelcomeAlert.ONE_CARD] });

    // When Dan builds a workbook from the folder
    const built = rebuild(folder);

    // Then the Jobs tab holds exactly that job
    expect(built.status, built.stderr).toBe(0);
    expect(built.tabs.Jobs.map(pickCells).map(({ Company, Job, Source }) => ({ Company, Job, Source }))).toEqual([
      { Company: 'Relecloud Health', Job: 'Product Owner (Patient Apps)', Source: WELCOME_LABEL },
    ]);
  });

  it.skip('reads a character written as a named entity in a title as the character itself', () => {
    // Given a card whose title is written "Data &amp; Analytics Lead"
    const folder = aFolderHolding({ alerts: [WelcomeAlert.TITLE_WITH_AMPERSAND] });

    // When Dan builds a workbook from the folder
    const built = rebuild(folder);

    // Then the Job reads "Data & Analytics Lead", and no cell keeps the entity
    expect(built.status, built.stderr).toBe(0);
    expect(built.tabs.Jobs.map((row) => row.Job)).toEqual(['Data & Analytics Lead']);
    expect(built.tabs.Jobs.flatMap(textCells).filter((cell) => cell.includes('&amp;'))).toEqual([]);
  });

  it.skip('adds no row to the Sources tab, because the alert names no saved search', () => {
    // Given the three-job alert
    const folder = aFolderHolding({ alerts: [WelcomeAlert.THREE_CARDS] });

    // When Dan builds a workbook from the folder
    const built = rebuild(folder);

    // Then the Sources tab is empty and the Companies tab lists the three employers
    expect(built.status, built.stderr).toBe(0);
    expect(built.tabs.Sources).toEqual([]);
    expect(built.tabs.Companies.map((row) => row.Company).sort()).toEqual(THREE_CARD_ADVERTS.map(({ company }) => company).sort());
  });
});

describe('@driving_port a resent job is one row seen twice (US-01b, AC-3)', () => {
  it.skip('shows Northwind once with Times Seen 2, First Seen from the earlier alert, and the new job beside it', () => {
    // Given two cached alerts on consecutive days, the second repeating the Northwind card and adding Tailwind Freight
    const folder = aFolderHolding({ alerts: [WelcomeAlert.THREE_CARDS, WelcomeAlert.RESEND_WITH_NEW_CARD] });

    // When Dan builds a workbook from the folder
    const built = rebuild(folder);

    // Then four jobs appear, Northwind once, seen twice since the first alert
    expect(built.status, built.stderr).toBe(0);
    const rows = welcomeRows(built.tabs.Jobs);
    expect(rows.map((row) => row.Company)).toEqual(['Contoso Data', 'Fabrikam Security', 'Northwind Analytics', 'Tailwind Freight']);
    const seen = (company) => rows.find((row) => row.Company === company);
    expect(seen('Northwind Analytics')).toMatchObject({ 'Times Seen': 2, 'First Seen': '2026-10-20T07:10:00Z', 'Last Seen': '2026-10-21T07:10:00Z', 'Date Discovered': '2026-10-20' });
    expect(seen('Tailwind Freight')).toMatchObject({ Job: 'Delivery Lead', 'Times Seen': 1, 'First Seen': '2026-10-21T07:10:00Z' });
  });
});

describe('@driving_port LinkedIn rows are untouched beside the new source (US-01b, AC-4, guardrail KPI 3)', () => {
  it.skip('builds every LinkedIn row, search and company exactly as a LinkedIn-only folder does', () => {
    // Given a folder holding the LinkedIn fixtures and one Welcome to the Jungle alert of three jobs
    const folder = aFolderHolding({ folders: [LINKEDIN_FIXTURES_DIR], alerts: [WelcomeAlert.THREE_CARDS] });
    const expected = LINKEDIN_BASELINE['fixtures/linkedin'].grids;
    const welcomeCompanies = new Set(THREE_CARD_ADVERTS.map(({ company }) => company));

    // When Dan builds a workbook from the folder
    const built = rebuild(folder);

    // Then every LinkedIn row, every saved search and every LinkedIn employer is what a LinkedIn-only build gives
    expect(built.status, built.stderr).toBe(0);
    const observed = (jobs, sources, companies) => ({
      'jobs.linkedin': jobs.filter((row) => row.Source === LINKEDIN_LABEL),
      'jobs.welcome.count': jobs.filter((row) => row.Source === WELCOME_LABEL).length,
      'tab.Sources': sources,
      'companies.linkedin': companies.filter((row) => !welcomeCompanies.has(row.Company)),
    });
    const before = observed(rowsOfGrid(expected.Jobs), rowsOfGrid(expected.Sources), rowsOfGrid(expected.Companies));
    const after = observed(built.tabs.Jobs, built.tabs.Sources, built.tabs.Companies);
    assertStateDelta(before, after, { universe: Object.keys(before), expected: { 'jobs.welcome.count': setTo(3) } });
  });
});

describe('@driving_port one unreadable alert does not stop the build (US-01b, AC-5, DDD-10)', () => {
  it.skip('@error reports an alert whose card has no title by id and reason, and every other message still produces its rows', () => {
    // Given a folder holding the LinkedIn fixtures, the three-job alert and an alert whose card has no title
    const broken = welcomeAlertRecord(WelcomeAlert.CARD_WITHOUT_TITLE);
    const folder = aFolderHolding({ folders: [LINKEDIN_FIXTURES_DIR], alerts: [WelcomeAlert.THREE_CARDS, WelcomeAlert.CARD_WITHOUT_TITLE] });
    const expected = LINKEDIN_BASELINE['fixtures/linkedin'].grids;

    // When Dan builds a workbook from the folder
    const built = rebuild(folder);

    // Then the build succeeds and the broken alert is named with a reason
    expect(built.status, built.stderr).toBe(0);
    const unparsed = linesMentioning(built.stderr, 'unparsed');
    expect(unparsed).toHaveLength(1);
    expect(unparsed[0]).toMatch(unparsedLinePattern(broken));
    // And no row appears for it, while the three-job alert and every LinkedIn row are all present
    expect(built.tabs.Jobs.map((row) => row.Company)).not.toContain('Datum Corp');
    expect(welcomeRows(built.tabs.Jobs).map(pickCells)).toEqual(THREE_CARD_ADVERTS.map(advertAsRow).sort(byCompany));
    expect(built.tabs.Jobs.filter((row) => row.Source === LINKEDIN_LABEL)).toEqual(rowsOfGrid(expected.Jobs));
  });

  it.skip('@error reports an alert holding a character reference the reader has no entry for, and never guesses what it meant (DR-0021)', () => {
    // Given the alert whose title carries an ampersand, with the ampersand rewritten as a character reference nobody defines
    const alert = welcomeAlertRecord(WelcomeAlert.TITLE_WITH_AMPERSAND);
    expect(alert.htmlBody).toContain('&amp;');
    const unreadable = { ...alert, htmlBody: alert.htmlBody.replaceAll('&amp;', '&bogus;') };

    // When the build model is derived
    const model = harvest([unreadable]);

    // Then no row is made from it, and it is reported as unparsed with a reason
    expect(model.jobs.rows).toEqual([]);
    expect(model.unparsed).toHaveLength(1);
    expect(model.unparsed[0]).toMatchObject({ id: alert.id, sender: alert.sender });
    expect(model.unparsed[0].reason).toEqual(expect.stringMatching(/\S/));
  });

  it.skip('@error reports nothing as unparsed when every alert can be read', () => {
    // Given a folder of readable alerts only
    const folder = aFolderHolding({ alerts: [WelcomeAlert.THREE_CARDS, WelcomeAlert.ONE_CARD] });

    // When Dan builds a workbook from the folder
    const built = rebuild(folder);

    // Then no unparsed line is printed
    expect(built.status, built.stderr).toBe(0);
    expect(linesMentioning(built.stderr, 'unparsed')).toEqual([]);
  });
});

describe('@driving_port Role Family comes from the title, as for a LinkedIn advert (US-01b)', () => {
  it.skip('gives each Welcome to the Jungle row the family that the same title earns on LinkedIn', () => {
    // Given the three sample cards
    const folder = aFolderHolding({ alerts: [WelcomeAlert.THREE_CARDS] });
    const familyOnLinkedIn = (title) =>
      harvest([aMessage({ jobs: [{ id: '4400000001', title, company: 'Any Company' }], subject: `${title} at Any Company` })]).jobs.rows[0]['Role Family'];

    // When Dan builds a workbook from the folder
    const built = rebuild(folder);

    // Then each row's Role Family is the family its title classifies to on LinkedIn
    expect(built.status, built.stderr).toBe(0);
    const families = welcomeRows(built.tabs.Jobs).map((row) => [row.Job, row['Role Family']]);
    expect(families).toHaveLength(3);
    expect(families).toEqual(families.map(([title]) => [title, familyOnLinkedIn(title)]));
    expect(families.some(([, family]) => family !== 'other')).toBe(true);
  });
});

// ------------------------------------------------------------------ properties

const threeCardAlert = welcomeAlertRecord(WelcomeAlert.THREE_CARDS);
const words = fc.stringMatching(/^[A-Za-z][A-Za-z0-9&]{0,11}( [A-Za-z0-9&]{1,10}){0,2}$/);
const asText = (value) => value.replace(/&/g, '&amp;');
const withoutRowIdentity = (model) => ({ jobs: model.jobs, companies: model.companies, sources: model.sources });

describe('@property digests are read by what they advertise, and a digest is never lost silently (US-01b, DDD-10)', () => {
  it.skip('@property whatever employer and title a card carries, the row carries exactly them and the other cards are unmoved', () => {
    // Given the three-job alert, in which Northwind's employer and title appear once each
    expect(threeCardAlert.htmlBody.split('Northwind Analytics')).toHaveLength(2);
    expect(threeCardAlert.htmlBody.split('Technical Product Lead')).toHaveLength(2);
    const untouched = harvest([threeCardAlert]).jobs.rows.filter((row) => row.Company !== 'Northwind Analytics');

    holds(
      fc.property(words, words, (employer, title) => {
        // When that card is rewritten to carry any other employer and title
        const htmlBody = threeCardAlert.htmlBody.replace('Northwind Analytics', asText(employer)).replace('Technical Product Lead', asText(title));
        const rows = harvest([{ ...threeCardAlert, htmlBody }]).jobs.rows;

        // Then three rows result, the rewritten one carries exactly that employer and title, and the others did not move
        expect(rows).toHaveLength(3);
        const rewritten = rows.find((row) => row.Company === employer && row.Job === title);
        expect(rewritten?.Source).toBe(WELCOME_LABEL);
        expect(rows.filter((row) => row !== rewritten)).toEqual(untouched);
      }),
    );
  });

  it.skip('@property whatever the subject says, the same jobs are read from the same digest', () => {
    // Given the three-job alert as read under its own subject
    const expected = withoutRowIdentity(harvest([threeCardAlert]));

    holds(
      fc.property(fc.string({ maxLength: 120 }), (subject) => {
        // When any other subject is put on the same digest
        const model = harvest([{ ...threeCardAlert, subject }]);

        // Then the same jobs, employers and searches result
        expect(withoutRowIdentity(model)).toEqual(expected);
      }),
    );
  });

  it.skip('@property @error whatever a digest holds, it is either read into rows or reported as unparsed with a reason, never dropped', () => {
    // Given the three-job alert's text, and damage of every kind to it: other text, a piece cut out, junk pushed in, a cut-off end
    const original = threeCardAlert.htmlBody;
    const damaged = fc.oneof(
      fc.string({ maxLength: 300 }),
      fc.record({ at: fc.nat(original.length), length: fc.nat(400) }).map(({ at, length }) => original.slice(0, at) + original.slice(at + length)),
      fc.record({ at: fc.nat(original.length), junk: fc.string({ maxLength: 30 }) }).map(({ at, junk }) => original.slice(0, at) + junk + original.slice(at)),
      fc.nat(original.length).map((end) => original.slice(0, end)),
    );

    holds(
      fc.property(damaged, (htmlBody) => {
        // When the build model is derived from that message
        const model = harvest([{ ...threeCardAlert, htmlBody }]);

        // Then the message is never claimed by nobody, and it lands in exactly one place: rows, or the unparsed list with a reason
        expect(model.unmatched).toEqual([]);
        const read = model.jobs.rows.length > 0;
        expect(model.unparsed.length).toBe(read ? 0 : 1);
        if (!read) {
          expect(model.unparsed[0]).toMatchObject({ id: threeCardAlert.id, sender: threeCardAlert.sender });
          expect(model.unparsed[0].reason).toEqual(expect.stringMatching(/\S/));
        }
      }),
    );
  });
});

describe('@driving_port reading a digest stays inside the reparse budget (US-01b done-when, DR-0020 rule 5)', () => {
  const BUDGET_MS_PER_MESSAGE = 10;
  const REPETITIONS = 200;

  it.skip('reads a three-job digest in under 10 ms on average, and reports the measured figure', () => {
    // Given the three-job alert
    harvest([threeCardAlert]);

    // When it is read two hundred times
    const started = performance.now();
    let rowCount = 0;
    for (let repetition = 0; repetition < REPETITIONS; repetition += 1) rowCount += harvest([threeCardAlert]).jobs.rows.length;
    const perMessage = (performance.now() - started) / REPETITIONS;

    // Then every reading produced its three rows and the mean cost is inside DR-0001's budget
    console.info(`scan cost per message (three-job digest, whole build model): ${perMessage.toFixed(3)} ms; budget ${BUDGET_MS_PER_MESSAGE} ms`);
    expect(rowCount).toBe(3 * REPETITIONS);
    expect(perMessage).toBeLessThan(BUDGET_MS_PER_MESSAGE);
  });
});
