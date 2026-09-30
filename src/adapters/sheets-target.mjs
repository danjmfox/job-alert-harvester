// Driven adapter: TargetSheet over a harvester-created native Sheet (DR-0012).
// The reader has probe and read only; the writer adds apply. Neither imports a node: module or global fetch:
// they receive a transport, an endpoint table, sleep and jitter.
import { SheetsRefusal } from '../core/sheets-refusals.mjs';
import { TAB_OWNERSHIP, parseSpreadsheet, parseValueRanges, resolveTabs, toSheetState } from '../core/sheets-model.mjs';
import { MAX_BATCH_BYTES, assertWithinLimit, buildApplyBody, settlePlans } from '../core/sheets-requests.mjs';
import { decideRetry, retryAfterSecondsOf } from '../core/retry-policy.mjs';

const OK = 200;
const FORBIDDEN = 403;
const NOT_FOUND = 404;
const LOST_CONNECTION = 0;
const SERVER_ERROR_STATUS = 503;
const JSON_HEADERS = { 'content-type': 'application/json' };
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
  resolveTabs({ tabs, grids });
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

// ------------------------------------------------------------------ resolution

/** Where every row and column of the owned tabs is right now: read fresh, never carried over from an earlier read. */
const resolveFresh = async (options, spreadsheetId) => {
  const tabs = await readTabs(options, spreadsheetId);
  const grids = await readGrids(options, spreadsheetId, tabs.filter(isOwnedTab).map(wholeTabRange));
  return resolveTabs({ tabs, grids });
};

// -------------------------------------------------------------------- writing

const sendBatch = ({ transport, endpoints }, spreadsheetId, body) =>
  transport.write.request(`${spreadsheetUrl(endpoints, spreadsheetId)}:batchUpdate`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });

const reasonOf = (body) => body?.error?.errors?.[0]?.reason ?? body?.error?.details?.find((detail) => detail.reason)?.reason ?? null;

const valuesIn = (rows) => rows.flatMap(({ values }) => values);

const cellsWrittenBy = ({ requests }) =>
  requests.reduce((total, { updateCells, appendCells }) => {
    if (updateCells) return total + valuesIn(updateCells.rows).length;
    if (appendCells) return total + valuesIn(appendCells.rows).filter((cell) => cell.userEnteredValue !== undefined).length;
    return total;
  }, 0);

const retryDecisionAfter = (response, attempt, jitter) =>
  decideRetry({
    attempt,
    status: response.status === LOST_CONNECTION ? SERVER_ERROR_STATUS : response.status,
    reason: reasonOf(response.body),
    retryAfterSeconds: response.headers ? retryAfterSecondsOf(response.headers) : null,
    jitter: jitter(),
    namespace: 'sheets',
  });

/** A 5xx or a lost answer may have applied the batch, so its exhaustion is unknown, not failed. */
const outcomeUnknown = () => {
  throw Object.assign(new Error(`${SheetsRefusal.APPLY_OUTCOME_UNKNOWN}: the Sheet may or may not have changed; a re-run is safe, it will not append twice`), {
    code: SheetsRefusal.APPLY_OUTCOME_UNKNOWN,
  });
};

const refuseUnsettled = (refusal) => (refusal === SheetsRefusal.SERVER_ERROR ? outcomeUnknown() : refuse(refusal));

/** Resolve, settle and send once; the caller retries. Returns null when the batch was not acknowledged. */
const attemptApply = async (options, spreadsheetId, plans, attempt) => {
  const resolution = await resolveFresh(options, spreadsheetId);
  const { plans: settled, appendsSkippedAsPresent } = settlePlans({ plans, resolution });
  const body = buildApplyBody({ plans: settled, resolution });
  if (body.requests.length === 0) return { appendsSkippedAsPresent, cellsWritten: 0 };
  assertWithinLimit(body, { maxBytes: options.maxBatchBytes ?? MAX_BATCH_BYTES });
  const response = await sendBatch(options, spreadsheetId, body);
  if (response.status === OK) return { appendsSkippedAsPresent, cellsWritten: cellsWrittenBy(body) };
  const decision = retryDecisionAfter(response, attempt, options.jitter);
  if (!decision.retry) return refuseUnsettled(decision.refusal);
  await options.sleep(decision.delayMs);
  return null;
};

const applyWithRetries = async (options, spreadsheetId, plans) => {
  for (let attempt = 1; ; attempt += 1) {
    const applied = await attemptApply(options, spreadsheetId, plans, attempt);
    if (applied) return applied;
  }
};

const applyPlans = async (options, plans) => {
  const spreadsheetId = recordedIdOf(options);
  const { cellsWritten, appendsSkippedAsPresent } = await applyWithRetries(options, spreadsheetId, plans);
  return {
    appliedAt: new Date().toISOString(),
    cellsWritten,
    inputDigest: null,
    outputDigest: null,
    appendsSkippedAsPresent,
  };
};

/**
 * @param {{ store: object, tokenSource: object, transport: { read: object, write: object }, endpoints: object,
 *           spreadsheetId?: string, sleep: Function, jitter: () => number, maxBatchBytes?: number }} options
 * @returns {{ probe: Function, read: Function, apply: Function }}
 *   apply(plans) resolves { appliedAt, cellsWritten, inputDigest: null, outputDigest: null, appendsSkippedAsPresent }.
 */
export function createSheetsTargetWriter(options) {
  return {
    probe: () => probeSheet(options),
    read: () => readSheetState(options),
    apply: (plans) => applyPlans(options, plans),
  };
}
