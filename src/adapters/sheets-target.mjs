// Driven adapter. The reader is real; the writer is still a RED scaffold (DISTILL): TargetSheet over a harvester-created native Sheet (DR-0012).
// The reader has probe and read only; the writer adds apply. Neither imports a node: module or global fetch:
// they receive a transport, an endpoint table, sleep and jitter.
import { SheetsRefusal } from '../core/sheets-refusals.mjs';
import { TAB_OWNERSHIP, parseSpreadsheet, parseValueRanges, resolveTabs, toSheetState } from '../core/sheets-model.mjs';

export const __SCAFFOLD__ = true;

const scaffold = (name) => {
  throw new Error(`RED scaffold: ${name} is not implemented`);
};

const OK = 200;
const FORBIDDEN = 403;
const NOT_FOUND = 404;
const RENDER_UNFORMATTED = 'UNFORMATTED_VALUE';
const TAB_FIELDS = 'spreadsheetId,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))';
const HEADER_AND_FIRST_ROW = '1:2';

// Messages carry the refusal code only: no credential value may reach an error.
const refuse = (code) => {
  throw Object.assign(new Error(code), { code });
};

const refusalForStatus = (status) => (status === FORBIDDEN || status === NOT_FOUND ? SheetsRefusal.SPREADSHEET_UNREADABLE : SheetsRefusal.REQUEST_REJECTED);

const quotedTitle = (title) => `'${title.replaceAll("'", "''")}'`;

const isOwnedTab = ({ title }) => Object.hasOwn(TAB_OWNERSHIP, title);

/** A 200 body, or the named refusal for the status; exhaustion and unauthorised are refused by the transport. */
const readBody = async (transport, url) => {
  const response = await transport.read.request(url);
  return response.status === OK ? response.body : refuse(refusalForStatus(response.status));
};

const spreadsheetUrl = (endpoints, spreadsheetId) => `${endpoints.sheetsBase}/spreadsheets/${encodeURIComponent(spreadsheetId)}`;

const withQuery = (url, entries) => `${url}?${new URLSearchParams(entries)}`;

const recordedIdOf = ({ spreadsheetId, store }) => spreadsheetId ?? store.readTarget().spreadsheetId;

const readTabs = async ({ transport, endpoints }, spreadsheetId) =>
  parseSpreadsheet(await readBody(transport, withQuery(spreadsheetUrl(endpoints, spreadsheetId), { fields: TAB_FIELDS })), { expectedId: spreadsheetId }).tabs;

const readGrids = async ({ transport, endpoints }, spreadsheetId, ranges) => {
  if (ranges.length === 0) return {};
  const query = new URLSearchParams([...ranges.map(({ range }) => ['ranges', range]), ['valueRenderOption', RENDER_UNFORMATTED], ['majorDimension', 'ROWS']]);
  const body = await readBody(transport, `${spreadsheetUrl(endpoints, spreadsheetId)}/values:batchGet?${query}`);
  return parseValueRanges(body, ranges.map(({ title }) => title));
};

const assertNotTrashed = async ({ transport, endpoints }, spreadsheetId) => {
  const file = await readBody(transport, withQuery(`${endpoints.driveBase}/files/${encodeURIComponent(spreadsheetId)}`, { fields: 'trashed' }));
  if (typeof file?.trashed !== 'boolean') return refuse(SheetsRefusal.RESPONSE_MALFORMED);
  return file.trashed ? refuse(SheetsRefusal.SPREADSHEET_TRASHED) : undefined;
};

const headerRange = ({ title }) => ({ title, range: `${quotedTitle(title)}!${HEADER_AND_FIRST_ROW}` });

const wholeTabRange = ({ title }) => ({ title, range: quotedTitle(title) });

/** Wire, then probe, then use: every step is a read, in the order that fails soonest. */
const probeSheet = async (options) => {
  options.tokenSource.probe();
  const spreadsheetId = recordedIdOf(options);
  const tabs = await readTabs(options, spreadsheetId);
  await assertNotTrashed(options, spreadsheetId);
  const grids = await readGrids(options, spreadsheetId, tabs.filter(isOwnedTab).map(headerRange));
  resolveTabs({ tabs, grids, metadata: [] });
};

const readSheetState = async (options) => {
  options.tokenSource.probe();
  const spreadsheetId = recordedIdOf(options);
  const tabs = await readTabs(options, spreadsheetId);
  return toSheetState(await readGrids(options, spreadsheetId, tabs.map(wholeTabRange)));
};

/**
 * @param {{ store: object, tokenSource: object, transport: { read: object }, endpoints: object,
 *           spreadsheetId?: string, sleep: Function, jitter: () => number }} options
 *   spreadsheetId, when given, overrides the recorded id (import verifies a Sheet before recording it).
 * @returns {{ probe: Function, read: Function }}
 */
export function createSheetsTargetReader(options) {
  return { probe: () => probeSheet(options), read: () => readSheetState(options) };
}

/**
 * @param {{ store: object, tokenSource: object, transport: { read: object, write: object }, endpoints: object,
 *           spreadsheetId?: string, sleep: Function, jitter: () => number, maxBatchBytes?: number }} options
 * @returns {{ probe: Function, read: Function, apply: Function, bindRowKeys: Function }}
 *   apply(plans) resolves { appliedAt, cellsWritten, inputDigest: null, outputDigest: null, appendsSkippedAsPresent, metadataPending, warnings }.
 *   bindRowKeys() resolves { bound, pending }: searches first, binds only keyed rows lacking metadata, in chunks.
 */
export function createSheetsTargetWriter(options) {
  return {
    probe: () => scaffold('writer.probe'),
    read: () => scaffold('writer.read'),
    apply: () => scaffold('writer.apply'),
    bindRowKeys: () => scaffold('writer.bindRowKeys'),
  };
}
