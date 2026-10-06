// Oracles for the generated text, written here so the pure-layer properties share no code with src/: a small strict reader
// for the property-list XML the plist uses (well-formedness is a property of the reader accepting the text), the XML entity
// reading, a mask for single-quoted shell words, and the `HH:MM` language.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** The text of an XML text node with its entities read, or a thrown Error when it holds a raw `<` or an `&` that starts no entity. */
export function unescapeXml(text) {
  if (text.includes('<')) throw new Error(`raw "<" in text: ${JSON.stringify(text.slice(0, 80))}`);
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);|&/g, (match, name) => {
    if (name === undefined) throw new Error(`"&" that starts no entity in: ${JSON.stringify(text.slice(0, 80))}`);
    if (name.startsWith('#x')) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    if (!(name in ENTITIES)) throw new Error(`unknown entity &${name};`);
    return ENTITIES[name];
  });
}

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([A-Za-z]+)\s*>|<([A-Za-z]+)(?:\s[^<>\/]*)?(\/?)>|<[^>]*>|[^<]+/gy;

/**
 * Reads a property list into plain values: dict to object (keys in file order), array to array, string to string, integer to number.
 * Throws when the text is not well-formed: an unbalanced or unknown element, a raw `<`, a stray `&`, a value without a key.
 * @param {string} text
 * @returns {{ value: unknown, comments: string[] }}
 */
export function parsePlist(text) {
  const comments = [];
  const stack = [];
  let root;
  const place = (value) => {
    const top = stack.at(-1);
    if (top === undefined || top.kind === 'plist') {
      if (root !== undefined) throw new Error('more than one top-level value');
      root = value;
    } else if (top.kind === 'dict') {
      if (top.key === null) throw new Error('a dict value without a key');
      top.value[top.key] = value;
      top.key = null;
    } else top.value.push(value);
  };
  let sawPlist = false;
  TOKEN.lastIndex = 0;
  let consumed = 0;
  for (let token = TOKEN.exec(text); token !== null; token = TOKEN.exec(text)) {
    consumed = TOKEN.lastIndex;
    const [raw, closing, opening, selfClosing] = token;
    if (raw.startsWith('<!--')) comments.push(raw.slice(4, -3).trim());
    else if (raw.startsWith('<?') || raw.startsWith('<!DOCTYPE')) continue;
    else if (closing !== undefined) {
      const top = stack.pop();
      if (top === undefined || top.name !== closing) throw new Error(`unbalanced </${closing}>`);
      if (top.kind === 'leaf') {
        const content = unescapeXml(top.text);
        if (top.name === 'key') {
          const owner = stack.at(-1);
          if (owner?.kind !== 'dict') throw new Error('a key outside a dict');
          owner.key = content;
        }
        else if (top.name === 'string') place(content);
        else if (top.name === 'integer') {
          if (!/^-?[0-9]+$/.test(content.trim())) throw new Error(`not an integer: ${content}`);
          place(Number(content));
        } else throw new Error(`unknown leaf <${top.name}>`);
      } else if (top.kind === 'dict' || top.kind === 'array') place(top.value);
      else if (top.kind !== 'plist') throw new Error(`unexpected </${closing}>`);
    } else if (opening !== undefined) {
      if (selfClosing === '/') {
        if (opening === 'true') place(true);
        else if (opening === 'false') place(false);
        else throw new Error(`unknown empty element <${opening}/>`);
      } else if (opening === 'plist') {
        sawPlist = true;
        stack.push({ name: 'plist', kind: 'plist' });
      }
      else if (opening === 'dict') stack.push({ name: 'dict', kind: 'dict', value: {}, key: null });
      else if (opening === 'array') stack.push({ name: 'array', kind: 'array', value: [] });
      else if (['key', 'string', 'integer'].includes(opening)) stack.push({ name: opening, kind: 'leaf', text: '' });
      else throw new Error(`unknown element <${opening}>`);
    } else if (raw.startsWith('<')) throw new Error(`malformed tag ${raw.slice(0, 40)}`);
    else {
      const top = stack.at(-1);
      if (top?.kind === 'leaf') top.text += raw;
      else if (raw.trim() !== '') throw new Error(`text outside any element: ${JSON.stringify(raw.slice(0, 40))}`);
    }
  }
  if (consumed !== text.length) throw new Error(`stopped reading at offset ${consumed}`);
  if (!sawPlist) throw new Error('no <plist> element');
  if (stack.length > 0) throw new Error(`unclosed <${stack.at(-1).name}>`);
  return { value: root, comments };
}

/** Every maximal run of single-quoted words (`'...'` and the `\'` idiom) replaced by `Q`: what is left is the script's own text. */
export const maskQuotedWords = (script) => script.replace(/(?:'[^']*'|\\')+/g, 'Q');

/** Two digits 00-23, a colon, two digits 00-59: the `--at` language, restated. */
export const VALID_TIME = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;
export const timeOf = (minuteOfDay) => `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
