// @contract-shape:bounded-change
// welcome-to-the-jungle-source, slice 01a (US-01a, DR-0023, DR-0006 rules 2 and 5): the build asks the source
// registry to claim each message and says on stderr which messages no source claims, by id and sender. Subprocess
// acceptance layer (the real rebuild form and the real `build`, real filesystem): example-only (Mandate 9), universe-bound assertions
// (Mandate 8). The properties at the end run on the pure driving port, harvest(), where fast-check is affordable.
// Wording pinned here: stderr carries one line per unclaimed message, `unclaimed message <id> from <sender>`.
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { harvest } from '../../../src/core/harvest.mjs';
import { aMessage } from './support/domain-types.mjs';
import { holds } from '../gmail-api-source/support/property.mjs';
import {
  LINKEDIN_FIXTURES_DIR,
  WELCOME_SENDER,
  aFolderHolding,
  anUnclaimedMessage,
  buildFromCache,
  cleanUpFolders,
  linesMentioning,
  messagesIn,
  rebuild,
  unclaimedLine,
} from './support/wttj-fixtures.mjs';
import { assertStateDelta, setTo } from '../../common/state-delta.mjs';

afterEach(cleanUpFolders);

const LINKEDIN_SENDER = 'jobalerts-noreply@linkedin.com';
const TABS = ['Jobs', 'Companies', 'Sources'];

/** What Dan can observe of a rebuild: each tab's rows and the unclaimed-message lines on stderr. */
const observed = (built) => ({
  ...Object.fromEntries(TABS.map((tab) => [`tab.${tab}`, built.tabs[tab]])),
  'stderr.unclaimedLines': linesMentioning(built.stderr, 'unclaimed'),
});
const UNIVERSE = [...TABS.map((tab) => `tab.${tab}`), 'stderr.unclaimedLines'];

describe('@driving_port a message nobody claims is reported, never dropped (US-01a, AC-1)', () => {
  it('names the message by id and sender on stderr and adds no row for it', () => {
    // Given the LinkedIn fixtures, built on their own
    const alone = rebuild(aFolderHolding({ folders: [LINKEDIN_FIXTURES_DIR] }));
    expect(alone.status, alone.stderr).toBe(0);
    // And a folder holding the same fixtures plus one message from newsletter@example.invalid
    const newsletter = anUnclaimedMessage({ id: '0ddba11000000001', sender: 'newsletter@example.invalid' });
    const folder = aFolderHolding({ folders: [LINKEDIN_FIXTURES_DIR], records: [newsletter] });

    // When Dan builds a workbook from that folder
    const built = rebuild(folder);

    // Then stderr names that message's id and sender, and the three tabs are exactly the LinkedIn-only tabs
    expect(built.status, built.stderr).toBe(0);
    assertStateDelta(observed(alone), observed(built), {
      universe: UNIVERSE,
      expected: { 'stderr.unclaimedLines': setTo([unclaimedLine(newsletter)]) },
    });
  });

  it('names the message in a build from the cache as well, and adds no row for it', () => {
    // Given a cache holding the LinkedIn fixtures, built on their own
    const alone = buildFromCache({ folders: [LINKEDIN_FIXTURES_DIR] });
    expect(alone.status, alone.stderr).toBe(0);
    // And a cache holding the same fixtures plus one message from newsletter@example.invalid
    const newsletter = anUnclaimedMessage({ id: '0ddba11000000001', sender: 'newsletter@example.invalid' });

    // When Dan builds the tracker from that cache
    const built = buildFromCache({ folders: [LINKEDIN_FIXTURES_DIR], records: [newsletter] });

    // Then stderr names that message's id and sender, and the three tabs are exactly the LinkedIn-only tabs
    expect(built.status, built.stderr).toBe(0);
    assertStateDelta(observed(alone), observed(built), {
      universe: UNIVERSE,
      expected: { 'stderr.unclaimedLines': setTo([unclaimedLine(newsletter)]) },
    });
  });

  it('@error names every unclaimed message from different senders with its own id and sender, and invents no row for either', () => {
    // Given the LinkedIn fixtures, built on their own
    const alone = rebuild(aFolderHolding({ folders: [LINKEDIN_FIXTURES_DIR] }));
    // And two messages from two different senders that no source matches
    const newsletter = anUnclaimedMessage({ id: '0ddba11000000001', sender: 'newsletter@example.invalid' });
    const promotion = anUnclaimedMessage({ id: '0ddba11000000002', sender: 'promotions@example.invalid' });
    const folder = aFolderHolding({ folders: [LINKEDIN_FIXTURES_DIR], records: [newsletter, promotion] });

    // When Dan builds a workbook from the folder
    const built = rebuild(folder);

    // Then each is named with its own id and sender, and no row appears for either
    expect(built.status, built.stderr).toBe(0);
    assertStateDelta(observed(alone), observed(built), {
      universe: UNIVERSE,
      expected: { 'stderr.unclaimedLines': setTo([unclaimedLine(newsletter), unclaimedLine(promotion)]) },
    });
  });

  it('@error never reads a message from an unclaimed sender, even when its body looks like a LinkedIn digest', () => {
    // Given the LinkedIn fixtures, built on their own
    const alone = rebuild(aFolderHolding({ folders: [LINKEDIN_FIXTURES_DIR] }));
    // And a message from newsletter@example.invalid whose body is shaped like a LinkedIn job digest of three new jobs
    const lookalike = aMessage({
      id: '0ddba11000000003',
      date: '2026-07-26T08:00:00Z',
      sender: 'newsletter@example.invalid',
      subject: 'Delivery Lead at Imitation Works',
      jobs: [
        { id: '9000000001', title: 'Delivery Lead', company: 'Imitation Works' },
        { id: '9000000002', title: 'Scrum Master', company: 'Imitation Works' },
        { id: '9000000003', title: 'Agile Coach', company: 'Imitation Works' },
      ],
    });
    const folder = aFolderHolding({ folders: [LINKEDIN_FIXTURES_DIR], records: [lookalike] });

    // When Dan builds a workbook from the folder
    const built = rebuild(folder);

    // Then the message is reported as unclaimed and none of its three jobs becomes a row
    expect(built.status, built.stderr).toBe(0);
    assertStateDelta(observed(alone), observed(built), {
      universe: UNIVERSE,
      expected: { 'stderr.unclaimedLines': setTo([unclaimedLine(lookalike)]) },
    });
  });

  it('a folder in which every message belongs to a source reports nothing about unclaimed messages', () => {
    // Given a folder holding only LinkedIn fixtures
    const folder = aFolderHolding({ folders: [LINKEDIN_FIXTURES_DIR] });

    // When Dan builds a workbook from the folder
    const built = rebuild(folder);

    // Then the build succeeds and stderr carries no unclaimed-message line (a preservation guard: green before the change)
    expect(built.status, built.stderr).toBe(0);
    expect(linesMentioning(built.stderr, 'unclaimed')).toEqual([]);
  });
});

describe('@driving_port harvest() hands the unclaimed messages back beside the rows (DR-0023 rule 1)', () => {
  const linkedinMessages = messagesIn(LINKEDIN_FIXTURES_DIR);

  it('lists each unclaimed message by id and sender, and an empty unparsed list when every message was read', () => {
    // Given the LinkedIn fixtures and one message from newsletter@example.invalid
    const newsletter = anUnclaimedMessage({ id: '0ddba11000000001', sender: 'newsletter@example.invalid' });

    // When the build model is derived
    const model = harvest([...linkedinMessages, newsletter]);

    // Then the unclaimed list names that message, and no message is unparsed
    expect(model.unmatched).toEqual([{ id: newsletter.id, sender: newsletter.sender }]);
    expect(model.unparsed).toEqual([]);
  });

  it('@property whatever unclaimed messages are added, the tabs are the LinkedIn-only tabs and exactly those messages are listed as unclaimed', () => {
    // Given the build model of the LinkedIn fixtures on their own
    const alone = harvest(linkedinMessages);
    const unclaimedMessages = fc.uniqueArray(
      fc.record({
        id: fc.stringMatching(/^[0-9a-f]{16}$/),
        sender: fc.emailAddress().filter((sender) => sender !== LINKEDIN_SENDER && sender !== WELCOME_SENDER),
      }),
      { selector: ({ id }) => id, minLength: 1, maxLength: 4 },
    );

    holds(
      fc.property(unclaimedMessages, (extras) => {
        // When any number of messages from other senders join the folder
        const messages = extras.map(anUnclaimedMessage);
        const model = harvest([...linkedinMessages, ...messages]);

        // Then the tabs do not move and the unclaimed list is those messages, in order
        const snapshot = (m) => ({ sources: m.sources, companies: m.companies, jobs: m.jobs, unmatched: m.unmatched });
        assertStateDelta(snapshot({ ...alone, unmatched: [] }), snapshot(model), {
          universe: ['sources', 'companies', 'jobs', 'unmatched'],
          expected: { unmatched: setTo(extras.map(({ id, sender }) => ({ id, sender }))) },
        });
      }),
    );
  });
});
