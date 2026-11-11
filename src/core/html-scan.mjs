// PURE and total (DR-0021). Scans an HTML string into an element tree, or refuses with a reason.
// Not a general HTML parser: it knows one family of well-formed email templates and refuses anything else.

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'link', 'meta']);
const RAW_TEXT_TAGS = new Set(['style', 'script']);

const NAMED_ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', pound: '£', euro: '€' });

const TOKEN = new RegExp(
  [
    '(?<comment><!--[\\s\\S]*?-->)',
    '(?<declaration><![^>]*>)',
    '(?<raw><(?<rawTag>style|script)\\b[^>]*>[\\s\\S]*?</\\k<rawTag>\\s*>)',
    '(?<close></(?<closeTag>[A-Za-z][A-Za-z0-9]*)\\s*>)',
    '(?<open><(?<openTag>[A-Za-z][A-Za-z0-9]*)(?<attributes>(?:\\s+[^\\s=>/]+(?:\\s*=\\s*(?:"[^"]*"|\'[^\']*\'|[^\\s>"\']+))?)*)\\s*(?<selfClosing>/?)>)',
    '(?<text>[^<]+)',
    '(?<stray><)',
  ].join('|'),
  'giy',
);

const ATTRIBUTE = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
const ENTITY_REFERENCE = /&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g;

const refusal = (reason) => ({ ok: false, reason });

/** One entity reference's text, or null when the closed table has no entry for it. */
function entityText(name) {
  if (name.startsWith('#')) {
    const codePoint = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : null;
  }
  return Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : null;
}

/** The first reference in `text` the table does not know, or null. */
const firstUnknownReference = (text) => [...text.matchAll(ENTITY_REFERENCE)].find(([, name]) => entityText(name) === null)?.[0] ?? null;

const decodeEntities = (text) => text.replace(ENTITY_REFERENCE, (_whole, name) => entityText(name));

const attributesOf = (source) =>
  Object.fromEntries([...source.matchAll(ATTRIBUTE)].map(([, name, double, single, bare]) => [name.toLowerCase(), double ?? single ?? bare ?? '']));

const withChild = (stack, child) => [...stack.slice(0, -1), { ...stack.at(-1), children: [...stack.at(-1).children, child] }];

/** Folds one token into the open-element stack, or refuses. */
function step(stack, groups) {
  if (groups.comment || groups.declaration || groups.raw) return stack;
  if (groups.stray) return refusal('a "<" that opens no tag');
  if (groups.text) {
    const unknown = firstUnknownReference(groups.text);
    return unknown ? refusal(`unknown character reference ${unknown}`) : withChild(stack, decodeEntities(groups.text));
  }
  if (groups.open) {
    const tag = groups.openTag.toLowerCase();
    const element = { tag, attributes: attributesOf(groups.attributes), children: [] };
    return VOID_TAGS.has(tag) || groups.selfClosing ? withChild(stack, element) : [...stack, element];
  }
  const tag = groups.closeTag.toLowerCase();
  if (stack.length < 2 || stack.at(-1).tag !== tag) return refusal(`closing tag </${tag}> does not match an open element`);
  return withChild(stack.slice(0, -1), stack.at(-1));
}

/** @returns {{ ok: true, root: { tag: string, attributes: object, children: (object|string)[] } } | { ok: false, reason: string }} */
export function scanHtml(html) {
  const tokens = [...html.matchAll(TOKEN)];
  const consumed = tokens.reduce((end, token) => (token.index === end ? end + token[0].length : -1), 0);
  if (consumed !== html.length) return refusal('markup the scanner cannot read');

  const stack = tokens.reduce(
    (state, token) => (Array.isArray(state) ? step(state, token.groups) : state),
    [{ tag: '#root', attributes: {}, children: [] }],
  );
  if (!Array.isArray(stack)) return stack;
  return stack.length === 1 ? { ok: true, root: stack[0] } : refusal(`element <${stack.at(-1).tag}> is never closed`);
}
