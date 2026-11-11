// PURE. Reads a Welcome to the Jungle job-alert digest into one raw row per card, or refuses (DR-0021).
// The card is an anchor wrapping a table of class es-content-body. Its fields sit in fixed positions:
// paragraph 1 is the employer, 2 the tagline, 3 the title, a line break, and an em of [salary,] location.
// The card link is an opaque click-tracking URL: it is stored, never requested.

import { scanHtml } from './html-scan.mjs';
import { fuzzyKey } from './dedup.mjs';
import { refuseMessage } from './sources/refusal.mjs';

const CARD_TABLE_CLASS = 'es-content-body';
const WHITESPACE_RUN = /\s+/g;

const elementsIn = (node) => (typeof node === 'string' ? [] : node.children.filter((child) => typeof child !== 'string'));
const descendantsIn = (node) => elementsIn(node).flatMap((child) => [child, ...descendantsIn(child)]);
const named = (tag) => (element) => element.tag === tag;
const hasClass = (name) => (element) => (element.attributes.class ?? '').split(WHITESPACE_RUN).includes(name);
const tidy = (text) => text.replace(WHITESPACE_RUN, ' ').trim();

const textOf = (node) => (typeof node === 'string' ? node : node.children.map(textOf).join(''));

/** The anchor-wrapped card tables, in document order. */
const cardAnchorsIn = (root) =>
  descendantsIn(root).filter((element) => element.tag === 'a' && elementsIn(element).some((child) => child.tag === 'table' && hasClass(CARD_TABLE_CLASS)(child)));

/** An element's children split into lines at each line break, each line's text tidied. */
const linesOf = (element) =>
  element.children
    .reduce((lines, child) => (child.tag === 'br' ? [...lines, ''] : [...lines.slice(0, -1), lines.at(-1) + textOf(child)]), [''])
    .map(tidy);

const needed = (value, what, position) => value || refuseMessage(`card ${position} has no ${what}`);

function readCard(anchor, position) {
  const href = needed(anchor.attributes.href, 'link', position);
  const paragraphs = descendantsIn(anchor).filter(named('p'));
  if (paragraphs.length !== 3) refuseMessage(`card ${position} has ${paragraphs.length} paragraphs, expected 3`);
  const [employerParagraph, , titleParagraph] = paragraphs;

  const company = needed(tidy(textOf(descendantsIn(employerParagraph).find(named('strong')) ?? '')), 'employer', position);
  const title = needed(tidy(textOf(descendantsIn(titleParagraph).find(named('strong')) ?? '')), 'title', position);
  const emphasis = descendantsIn(titleParagraph).find(named('em'));
  const lines = emphasis ? linesOf(emphasis) : [];
  if (lines.length < 1 || lines.length > 2) refuseMessage(`card ${position} has ${lines.length} detail lines, expected 1 or 2`);
  const location = needed(lines.at(-1), 'location', position);

  return { dedupKey: fuzzyKey('wttj', company, title, location), title, company, location, advertLink: href };
}

/** One message -> the raw rows its cards advertise. Refuses a message it cannot read in full. */
export function extractWelcomeJobs(message) {
  if (typeof message.htmlBody !== 'string') refuseMessage('the message has no HTML part');
  const scan = scanHtml(message.htmlBody);
  if (!scan.ok) refuseMessage(scan.reason);

  const anchors = cardAnchorsIn(scan.root);
  if (anchors.length === 0) refuseMessage('the message holds no job card');

  return anchors.map((anchor, index) => ({
    ...readCard(anchor, index + 1),
    minSalary: null,
    maxSalary: null,
    rate: null,
    searchTerm: null,
    seenAt: message.date,
    messageId: message.id,
    sender: message.sender,
  }));
}
