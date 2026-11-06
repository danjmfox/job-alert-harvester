// The leak rules for committed fixtures (DEVOPS R1 note, section 5; DDD-15). A fixture is invented text, so these
// rules look for anything that could be real: a foreign host, a foreign mail address, a long token, or an
// unsubscribe or token value. Each rule takes a text and returns the offending fragments (an empty list when clean).

export const OWN_HOST = 'example.invalid';
export const OWN_SENDER = 'help@welcometothejungle.com';
/** A run this long of token characters (letters, digits, _ - + = %) is treated as a token. Real tokens run to hundreds; 40 is a judgement, not measured. A slash or dot ends a run, so a path or a host name is not one. */
export const TOKEN_RUN_LENGTH = 40;

const URL_HOST = /\bhttps?:\/\/([^\s/?#:"'<>\\]+)/gi;
const MAIL_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const URL_SAFE_RUN = new RegExp(`[A-Za-z0-9_\\-+=%]{${TOKEN_RUN_LENGTH},}`, 'g');
const UNSUBSCRIBE_VALUE = /unsubscribe[?=/:&][^\s"'<>]+/gi;
const TOKEN_VALUE = /token=[^\s"'<>&]+/gi;

const matches = (pattern, text) => [...text.matchAll(pattern)];

export const foreignHosts = (text) =>
  matches(URL_HOST, text)
    .map(([url, host]) => ({ url, host: host.toLowerCase() }))
    .filter(({ host }) => host !== OWN_HOST)
    .map(({ url }) => url);

export const foreignAddresses = (text) =>
  matches(MAIL_ADDRESS, text)
    .map(([address]) => address)
    .filter((address) => address !== OWN_SENDER && !address.toLowerCase().endsWith(`@${OWN_HOST}`));

export const longTokenRuns = (text) => matches(URL_SAFE_RUN, text).map(([run]) => run);

export const unsubscribeOrTokenValues = (text) => [...matches(UNSUBSCRIBE_VALUE, text), ...matches(TOKEN_VALUE, text)].map(([value]) => value);

export const LEAK_RULES = Object.freeze({
  'a URL whose host is not example.invalid': foreignHosts,
  'an email address other than the sender and example.invalid addresses': foreignAddresses,
  [`an unbroken run of ${TOKEN_RUN_LENGTH} or more token characters`]: longTokenRuns,
  'the word unsubscribe or token= followed by a value': unsubscribeOrTokenValues,
});

/** Every offence in `text`, as `rule: fragment`. */
export const leaksIn = (text) => Object.entries(LEAK_RULES).flatMap(([rule, find]) => find(text).map((fragment) => `${rule}: ${fragment.slice(0, 80)}`));
