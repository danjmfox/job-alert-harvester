// Ways an invented Welcome to the Jungle digest can drift, as pure functions over its HTML (DEVOPS R2 note, section 5).
// Each mutation is `{ name, apply(html) -> html }`. They know the card layout of fixtures/wttj/ (an anchor wrapping a table
// of class es-content-body) and nothing else; the screen-implies-extract property (DDD-16) applies them in sequence.

import fc from 'fast-check';

const CARD = /<a href="https:\/\/example\.invalid\/ls\/click[^"]*">\s*<table class="es-content-body"[\s\S]*?<\/table>\s*<\/a>/g;

const mutation = (name, apply) => Object.freeze({ name, apply });

/** The digest as head, cards and tail; a digest without a card is all head. */
function splitDigest(html) {
  const cards = html.match(CARD) ?? [];
  if (cards.length === 0) return { head: html, cards, tail: '' };
  const first = html.indexOf(cards[0]);
  const end = html.lastIndexOf(cards.at(-1)) + cards.at(-1).length;
  return { head: html.slice(0, first), cards, tail: html.slice(end) };
}

const inFirstCard = (change) => (html) => {
  const { head, cards, tail } = splitDigest(html);
  return cards.length === 0 ? html : head + [change(cards[0]), ...cards.slice(1)].join('\n') + tail;
};

const DETAIL_LINES = Object.freeze(['Detail line one', 'Detail line two', 'Detail line three']);

/** The digest with exactly `count` cards, repeating or dropping the ones it has. */
export const cardCount = (count) =>
  mutation(`${count} card(s)`, (html) => {
    const { head, cards, tail } = splitDigest(html);
    return cards.length === 0 ? html : head + Array.from({ length: count }, (_, index) => cards[index % cards.length]).join('\n') + tail;
  });

/** The first card's detail line(s) replaced by `count` invented lines (none removes the element). */
export const detailLines = (count) =>
  mutation(`${count} detail line(s)`, inFirstCard((card) => card.replace(/<em>[\s\S]*?<\/em>/, count === 0 ? '' : `<em>${DETAIL_LINES.slice(0, count).join('<br>')}</em>`)));

/** The digest cut off after `fraction` of its length. */
export const truncatedAt = (fraction) => mutation(`truncated at ${Math.round(fraction * 100)}%`, (html) => html.slice(0, Math.floor(html.length * fraction)));

export const employerWithoutEmphasis = mutation('no emphasis on the employer', inFirstCard((card) => card.replace(/(<p style="margin:0;">)<strong>([^<]*)<\/strong>(<\/p>)/, '$1$2$3')));
export const titleWithoutEmphasis = mutation('no emphasis on the title', inFirstCard((card) => card.replace(/(<p style="margin:0;">)<strong>([^<]*)<\/strong>(<br>)/, '$1$2$3')));
export const taglineRemoved = mutation('two paragraphs in the card', inFirstCard((card) => card.replace(/<p style="margin:0;">[^<]*<\/p>\n/, '')));
export const extraParagraph = mutation('four paragraphs in the card', inFirstCard((card) => card.replace('</td>', '<p style="margin:0;">An extra line</p>\n</td>')));
export const unknownReference = mutation('an unknown character reference', inFirstCard((card) => card.replace('<strong>', '<strong>&bogus;')));
export const knownReference = mutation('a known character reference', inFirstCard((card) => card.replace('<strong>', '<strong>&amp;')));
export const strayOpeningBracket = mutation('a stray opening bracket', inFirstCard((card) => card.replace('</strong></p>', ' <</strong></p>')));
export const unbalancedTag = mutation('an unbalanced tag', inFirstCard((card) => card.replace('</tr>', '')));
export const cardWithoutLink = mutation('a card without its link', inFirstCard((card) => card.replace(/^<a href="[^"]*">/, '<a>')));
export const commentBeforeTheCards = mutation('a comment before the cards', (html) => {
  const { head, cards, tail } = splitDigest(html);
  return cards.length === 0 ? html : `${head}<!-- a note for the template editor -->\n${cards.join('\n')}${tail}`;
});

/** Mutations that must leave a readable digest readable, and ones that must not, by name, for the example table. */
export const HARMLESS = Object.freeze([knownReference, commentBeforeTheCards, detailLines(1), detailLines(2), cardCount(1), cardCount(4)]);
export const HARMFUL = Object.freeze([
  cardCount(0),
  employerWithoutEmphasis,
  titleWithoutEmphasis,
  taglineRemoved,
  extraParagraph,
  detailLines(0),
  detailLines(3),
  unknownReference,
  strayOpeningBracket,
  unbalancedTag,
  cardWithoutLink,
  truncatedAt(0.5),
]);

/** Any one mutation, for the property. */
export const mutationArb = fc.oneof(
  fc.integer({ min: 0, max: 4 }).map(cardCount),
  fc.integer({ min: 0, max: 3 }).map(detailLines),
  fc.double({ min: 0, max: 1, noNaN: true }).map(truncatedAt),
  fc.constantFrom(
    employerWithoutEmphasis,
    titleWithoutEmphasis,
    taglineRemoved,
    extraParagraph,
    unknownReference,
    knownReference,
    strayOpeningBracket,
    unbalancedTag,
    cardWithoutLink,
    commentBeforeTheCards,
  ),
);

/** Mutations applied in order. */
export const applyAll = (mutations, html) => mutations.reduce((current, { apply }) => apply(current), html);
