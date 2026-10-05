// The synthetic vocabulary of the search-yield-summary scenarios: saved searches, advert titles and the families those
// titles are known to fall in. Every name here is invented; none comes from the operator's cache. The family of each
// title is a fact of the fixture (the golden table of role-family-column holds the same generic titles), stated here so
// the oracle does not ask the production classifier.

/** Titles an advert can carry whose Role Family is any family except `other`. */
export const ON_TARGET_TITLES = Object.freeze(['Agile Coach', 'Scrum Master', 'Delivery Manager', 'Product Owner', 'Change Manager', 'Programme Manager']);
/** Titles that fall through to `other`. */
export const OTHER_TITLES = Object.freeze(['Data Analyst', 'Java Developer', 'Warehouse Operative']);

export const Role = Object.freeze({
  COACH: 'Agile Coach',
  SCRUM: 'Scrum Master',
  DELIVERY: 'Delivery Manager',
  OWNER: 'Product Owner',
  CHANGE: 'Change Manager',
  PROGRAMME: 'Programme Manager',
  ANALYST: 'Data Analyst',
  DEVELOPER: 'Java Developer',
  OPERATIVE: 'Warehouse Operative',
});

/** Saved searches, spelled as an alert's first line spells them. All fit the 40-character column. */
export const Search = Object.freeze({
  BROAD: 'agile coach in Examplestan',
  REGIONAL: 'scrum master in Exampleshire',
  NOISY: 'engineering manager in Examplestan',
  REDUNDANT: 'agile coach (remote) in Examplestan',
  NEWCOMER: 'change manager in Examplestan',
});

export const NO_SEARCH = null;
export const BLANK_SEARCH = '   ';

/** A search label of exactly the column width, one a character longer (41), and a long one (50). */
export const FORTY_CHARACTER_SEARCH = 'delivery manager in Examplestan and near';
export const FORTY_ONE_CHARACTER_SEARCH = 'delivery manager in Examplestan and near!';
export const LONG_SEARCH = 'contract engineering manager in Examplestan region';
export const LONG_SEARCH_AS_SHOWN = 'contract engineering manager in Examp...';

/** `n` distinct saved searches whose names sort in the order given: `search 01 in Examplestan`, `search 02 in Examplestan`... */
export const numberedSearch = (n) => `search ${String(n).padStart(2, '0')} in Examplestan`;
