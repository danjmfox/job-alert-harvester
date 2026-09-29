// @contract-shape:pure-function
// DR-0012 / DR-0004: the write plan becomes exactly one spreadsheets.batchUpdate, and the request builder is where
// "never write a human cell, never delete a row" becomes structural. Only updateCells, appendCells, appendDimension,
// addSheet and createDeveloperMetadata are constructable, so a delete, a clear or a sort cannot be built.
// Pure layer: properties over generated tracker layouts (a header a human reordered, unknown columns, blank interior
// rows, a grid too narrow) whose plans come from the real merge planner.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { assertWithinLimit, buildApplyBody, buildMetadataBody, classifyRequest, settlePlans } from '../../../src/core/sheets-requests.mjs';
import { ALLOWED_REQUEST_TYPES, RequestClass, ROW_KEY_METADATA, SheetsRefusal, TAB_OWNERSHIP, HUMAN_COLUMNS, aCompanyRow, aHarvestedJob, aSourceRow, ownedNonKeyColumns, refusalOf } from './support/sheets-domain-types.mjs';
import { decode, typeOf, aTrackerMoment } from './support/request-model.mjs';
import { holds } from './support/property.mjs';

const build = (moment) => buildApplyBody({ plans: moment.plans, resolution: moment.resolution });
const keyOf = (plan, update) => (plan.tab === 'Jobs' ? update.key : update.match.Company);

describe('the request builder can only construct writes to harvester-owned cells (SD-05, SD-06)', () => {
  it('the allow-list is exactly the five constructable request types, and names no delete, clear or sort', () => {
    expect([...ALLOWED_REQUEST_TYPES].sort()).toEqual(['addSheet', 'appendCells', 'appendDimension', 'createDeveloperMetadata', 'updateCells']);
    expect(ALLOWED_REQUEST_TYPES.filter((type) => /delete|clear|sort|insert|repeat/i.test(type))).toEqual([]);
  });

  it('@property every request in the body is one allow-listed type, one per entry', () => {
    holds(
      fc.property(aTrackerMoment, (moment) => {
        const { requests } = build(moment);
        for (const request of requests) {
          expect(Object.keys(request)).toHaveLength(1);
          expect(ALLOWED_REQUEST_TYPES).toContain(typeOf(request));
        }
      }),
    );
  });

  it('@property @error an update lands only on a row resolved from a planned key, never on another row', () => {
    holds(
      fc.property(aTrackerMoment, (moment) => {
        const decoded = decode(build(moment), moment.resolution, moment.plans);
        const planned = new Set(
          moment.plans.flatMap((plan) => plan.updates.map((update) => `${plan.tab}:${moment.resolution.tabs[plan.tab]?.rowIndexByKey[keyOf(plan, update)]}`)),
        );
        for (const write of decoded.writes.filter((candidate) => candidate.rowIndex > 0)) {
          expect(write.tab).toBeDefined();
          expect(planned.has(`${write.tab}:${write.rowIndex}`)).toBe(true);
        }
      }),
    );
  });

  it('@property @error an update never touches a human-owned column, an unknown column or a key cell', () => {
    holds(
      fc.property(aTrackerMoment, (moment) => {
        const decoded = decode(build(moment), moment.resolution, moment.plans);
        for (const write of decoded.writes.filter((candidate) => candidate.rowIndex > 0)) {
          expect(write.header).toBeDefined();
          expect(ownedNonKeyColumns(write.tab)).toContain(write.header);
          expect(HUMAN_COLUMNS).not.toContain(write.header);
          expect(TAB_OWNERSHIP[write.tab].keyColumns).not.toContain(write.header);
        }
      }),
    );
  });

  it('@property header cells are written only for the planned appendColumns, in order, at the first free columns', () => {
    holds(
      fc.property(aTrackerMoment, (moment) => {
        const decoded = decode(build(moment), moment.resolution, moment.plans);
        for (const [title, tab] of Object.entries(moment.resolution.tabs)) {
          const plan = moment.plans.find((candidate) => candidate.tab === title);
          const headerWrites = decoded.writes.filter((write) => write.tab === title && write.rowIndex === 0);
          expect(headerWrites.map((write) => write.value)).toEqual(plan.appendColumns);
          expect(headerWrites.map((write) => write.columnIndex)).toEqual(plan.appendColumns.map((_, offset) => tab.headerWidth + offset));
        }
      }),
    );
  });

  it('@property appended rows are new rows: one per planned append, blank outside harvester-owned and key columns', () => {
    holds(
      fc.property(aTrackerMoment, (moment) => {
        const decoded = decode(build(moment), moment.resolution, moment.plans);
        for (const [title] of Object.entries(moment.resolution.tabs)) {
          const plan = moment.plans.find((candidate) => candidate.tab === title);
          const rows = decoded.appended.filter((row) => row.tab === title);
          expect(rows).toHaveLength(plan.appends.length);
          const writable = [...TAB_OWNERSHIP[title].keyColumns, ...TAB_OWNERSHIP[title].harvesterColumns];
          for (const cell of rows.flatMap((row) => row.cells)) {
            if (!writable.includes(cell.header)) expect(cell.kind).toBe('blank');
          }
        }
      }),
    );
  });

  it('@property the grid always has room: appendDimension widens exactly the shortfall, and only when there is one', () => {
    holds(
      fc.property(aTrackerMoment, (moment) => {
        const decoded = decode(build(moment), moment.resolution, moment.plans);
        for (const [title, tab] of Object.entries(moment.resolution.tabs)) {
          const plan = moment.plans.find((candidate) => candidate.tab === title);
          const needed = tab.headerWidth + plan.appendColumns.length;
          const shortfall = Math.max(0, needed - tab.columnCount);
          expect(decoded.widenedColumns[tab.sheetId] ?? 0).toBe(shortfall);
          const targeted = [...decoded.writes.filter((write) => write.tab === title).map((write) => write.columnIndex), ...decoded.appended.filter((row) => row.tab === title).flatMap((row) => row.cells.map((cell) => cell.columnIndex))];
          for (const column of targeted) expect(column).toBeLessThan(tab.columnCount + shortfall);
        }
      }),
    );
  });

  it('@property every write names the field mask userEnteredValue and nothing broader', () => {
    holds(
      fc.property(aTrackerMoment, (moment) => {
        const { fields } = decode(build(moment), moment.resolution, moment.plans);
        for (const mask of fields) expect(mask).toBe('userEnteredValue');
      }),
    );
  });

  it('@property a cell whose fresh value already equals the planned value is not in the request, and every changed cell is', () => {
    holds(
      fc.property(aTrackerMoment, (moment) => {
        const { plans } = settlePlans({ plans: moment.plans, resolution: moment.resolution });
        const decoded = decode(buildApplyBody({ plans, resolution: moment.resolution }), moment.resolution, plans);
        const expected = new Set();
        for (const plan of moment.plans) {
          const tab = moment.resolution.tabs[plan.tab];
          if (!tab) continue;
          for (const update of plan.updates) {
            const key = keyOf(plan, update);
            for (const [column, value] of Object.entries(update.cells)) {
              if (TAB_OWNERSHIP[plan.tab].keyColumns.includes(column)) continue;
              if ((value ?? null) === (tab.rowsByKey[key]?.[column] ?? null)) continue;
              expected.add(`${plan.tab}:${tab.rowIndexByKey[key]}:${column}`);
            }
          }
        }
        const actual = new Set(decoded.writes.filter((write) => write.rowIndex > 0).map((write) => `${write.tab}:${write.rowIndex}:${write.header}`));
        expect(actual).toEqual(expected);
      }),
    );
  });

  const aPlannedValue = fc.oneof(
    fc.string(),
    fc.tuple(fc.constantFrom('=', '+', '-', '@', '=HYPERLINK("http://evil.invalid","x")'), fc.string()).map(([prefix, rest]) => `${prefix}${rest}`),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.boolean(),
    fc.constant(null),
  );
  const oneJobUpdate = (value) => {
    const plan = { tab: 'Jobs', appendColumns: [], updates: [{ key: 'linkedin:1', cells: { Job: value } }], appends: [], changes: [] };
    const resolution = {
      tabs: { Jobs: { sheetId: 1, rowCount: 10, columnCount: 26, headerWidth: 3, columnIndex: { 'Dedup Key': 0, Job: 1, Status: 2 }, rowIndexByKey: { 'linkedin:1': 1 }, rowsByKey: { 'linkedin:1': { 'Dedup Key': 'linkedin:1', Job: 'before', Status: 'Applied' } }, unboundKeys: [] } },
    };
    return { plan, resolution };
  };

  it('@property harvested text is written as text, numbers as numbers, and a null clears the cell: a formula is never constructed', () => {
    holds(
      fc.property(aPlannedValue, (value) => {
        const { plan, resolution } = oneJobUpdate(value);
        const decoded = decode(buildApplyBody({ plans: [plan], resolution }), resolution, [plan]);
        expect(decoded.writes).toHaveLength(1);
        const [write] = decoded.writes;
        expect(write.kind).not.toBe('formula');
        if (value === null) expect(write.kind).toBe('blank');
        else if (typeof value === 'string') expect([write.kind, write.value]).toEqual(['text', value]);
        else if (typeof value === 'number') expect([write.kind, write.value]).toEqual(['number', value]);
        else expect([write.kind, write.value]).toEqual(['boolean', value]);
      }),
    );
  });

  it('@error refuses sheets.header-changed when a column the plan updates has vanished from the Sheet since the plan was made', () => {
    const { plan, resolution } = oneJobUpdate('after');
    delete resolution.tabs.Jobs.columnIndex.Job;

    expect(refusalOf(() => buildApplyBody({ plans: [plan], resolution }))).toBe(SheetsRefusal.HEADER_CHANGED);
  });

  it('a tab the Sheet lacks is created in the same batch with a chosen id, its header and rows appended after it', () => {
    const plan = { tab: 'Companies', appendColumns: TAB_OWNERSHIP.Companies.harvesterColumns, updates: [], appends: [aCompanyRow('Acme Ltd')], changes: [] };
    const resolution = { tabs: { Jobs: { sheetId: 1, rowCount: 10, columnCount: 26, headerWidth: 1, columnIndex: { 'Dedup Key': 0 }, rowIndexByKey: {}, rowsByKey: {}, unboundKeys: [] } } };

    const { requests } = buildApplyBody({ plans: [plan], resolution });

    const created = requests.findIndex((request) => typeOf(request) === 'addSheet');
    const properties = requests[created].addSheet.properties;
    expect(properties.title).toBe('Companies');
    expect(Number.isInteger(properties.sheetId) && properties.sheetId !== 1).toBe(true);
    const appended = requests.filter((request) => typeOf(request) === 'appendCells');
    expect(requests.indexOf(appended[0])).toBeGreaterThan(created);
    expect(appended.every((request) => request.appendCells.sheetId === properties.sheetId)).toBe(true);
    const rows = appended.flatMap((request) => request.appendCells.rows);
    expect(rows[0].values.map((cell) => cell.userEnteredValue.stringValue)).toEqual(TAB_OWNERSHIP.Companies.harvesterColumns);
    expect(rows).toHaveLength(2);
  });

  it('a Sources update is located by its composite key as an ordered JSON array, never a joined string', () => {
    const columns = TAB_OWNERSHIP.Sources.harvesterColumns;
    const row = aSourceRow('agile coach', { Messages: 9 });
    const plan = { tab: 'Sources', appendColumns: [], updates: [{ key: 'LinkedIn / agile coach', match: { Source: 'LinkedIn', 'Search Term': 'agile coach' }, cells: Object.fromEntries(columns.map((column) => [column, row[column]])) }], appends: [], changes: [] };
    const resolution = {
      tabs: { Sources: { sheetId: 3, rowCount: 20, columnCount: 26, headerWidth: columns.length, columnIndex: Object.fromEntries(columns.map((column, index) => [column, index])), rowIndexByKey: { '["LinkedIn","agile coach"]': 4 }, rowsByKey: { '["LinkedIn","agile coach"]': aSourceRow('agile coach', { Messages: 1 }) }, unboundKeys: [] } },
    };

    const decoded = decode(buildApplyBody({ plans: [plan], resolution }), resolution, [plan]);

    expect(new Set(decoded.writes.map((write) => write.rowIndex))).toEqual(new Set([4]));
    expect(decoded.writes.map((write) => write.header)).toContain('Messages');
    expect(decoded.writes.map((write) => write.header)).not.toContain('Source');
    expect(decoded.writes.map((write) => write.header)).not.toContain('Search Term');
  });

  it('@error the Companies key is also a harvester column, and an existing Company cell is still never written', () => {
    const columns = TAB_OWNERSHIP.Companies.harvesterColumns;
    const plan = { tab: 'Companies', appendColumns: [], updates: [{ key: 'Acme Ltd', match: { Company: 'Acme Ltd' }, cells: Object.fromEntries(columns.map((column) => [column, aCompanyRow('Acme Ltd', { 'Jobs Seen': 5 })[column]])) }], appends: [], changes: [] };
    const resolution = { tabs: { Companies: { sheetId: 2, rowCount: 20, columnCount: 26, headerWidth: columns.length, columnIndex: Object.fromEntries(columns.map((column, index) => [column, index])), rowIndexByKey: { 'Acme Ltd': 2 }, rowsByKey: { 'Acme Ltd': aCompanyRow('Acme Ltd', { 'Jobs Seen': 1 }) }, unboundKeys: [] } } };

    const decoded = decode(buildApplyBody({ plans: [plan], resolution }), resolution, [plan]);

    expect(decoded.writes.map((write) => write.header)).toEqual(['Jobs Seen']);
  });

  it('the body carries no precondition and no data filter: Google would accept a bogus one, so sending one would be theatre', () => {
    const { plan, resolution } = oneJobUpdate('after');

    const body = buildApplyBody({ plans: [plan], resolution });

    expect(Object.keys(body)).toEqual(['requests']);
    expect(JSON.stringify(body)).not.toMatch(/writeControl|requiredRevisionId|dataFilter/);
  });
});

describe('settling a plan against the fresh Sheet: idempotent appends and skipped no-ops (SD-03)', () => {
  const resolutionHolding = (keys) => ({
    tabs: { Jobs: { sheetId: 1, rowCount: 20, columnCount: 26, headerWidth: 2, columnIndex: { 'Dedup Key': 0, Job: 1 }, rowIndexByKey: Object.fromEntries(keys.map((key, index) => [key, index + 1])), rowsByKey: Object.fromEntries(keys.map((key) => [key, { 'Dedup Key': key, Job: 'same' }])), unboundKeys: [] } },
  });

  it('@error drops an append whose key is already in the Sheet, counts it, and keeps the appends that are genuinely new', () => {
    const plan = { tab: 'Jobs', appendColumns: [], updates: [], appends: [aHarvestedJob('1'), aHarvestedJob('2')], changes: [] };

    const settled = settlePlans({ plans: [plan], resolution: resolutionHolding(['linkedin:1']) });

    expect(settled.appendsSkippedAsPresent).toBe(1);
    expect(settled.plans[0].appends.map((row) => row['Dedup Key'])).toEqual(['linkedin:2']);
  });

  it('leaves a plan whose appends are all new exactly as it was', () => {
    const plan = { tab: 'Jobs', appendColumns: [], updates: [], appends: [aHarvestedJob('3')], changes: [] };

    const settled = settlePlans({ plans: [plan], resolution: resolutionHolding(['linkedin:1']) });

    expect(settled).toEqual({ plans: [plan], appendsSkippedAsPresent: 0 });
  });

  it('an update whose every cell already holds the planned value produces no write at all', () => {
    const plan = { tab: 'Jobs', appendColumns: [], updates: [{ key: 'linkedin:1', cells: { Job: 'same' } }], appends: [], changes: [] };
    const resolution = resolutionHolding(['linkedin:1']);

    const { plans } = settlePlans({ plans: [plan], resolution });

    expect(buildApplyBody({ plans, resolution }).requests.filter((request) => typeOf(request) === 'updateCells')).toEqual([]);
  });
});

describe('the batch is refused when it is too large, never split (OQ-4)', () => {
  it('@error refuses sheets.plan-too-large when the serialised body exceeds the limit', () => {
    const body = { requests: [{ appendCells: { sheetId: 1, fields: 'userEnteredValue', rows: [{ values: [{ userEnteredValue: { stringValue: 'x'.repeat(500) } }] }] } }] };

    expect(refusalOf(() => assertWithinLimit(body, { maxBytes: 100 }))).toBe(SheetsRefusal.PLAN_TOO_LARGE);
  });

  it('accepts a body exactly at the limit', () => {
    const body = { requests: [] };
    const exact = JSON.stringify(body).length;

    expect(refusalOf(() => assertWithinLimit(body, { maxBytes: exact }))).toBeNull();
  });

  it('@error the refusal names no cell value', () => {
    const body = { requests: [{ appendCells: { sheetId: 1, fields: 'userEnteredValue', rows: [{ values: [{ userEnteredValue: { stringValue: 'PRIVATE-NOTE-TEXT'.repeat(50) } }] }] } }] };

    let refusal = null;
    try {
      assertWithinLimit(body, { maxBytes: 100 });
    } catch (error) {
      refusal = error;
    }

    expect(refusal?.code).toBe(SheetsRefusal.PLAN_TOO_LARGE);
    expect(refusal.message).not.toContain('PRIVATE-NOTE-TEXT');
  });
});

describe('binding a row key to its row is a metadata request and nothing else (SD-04)', () => {
  it('@property every binding becomes one createDeveloperMetadata on exactly that row, keyed and valued, and nothing more', () => {
    holds(
      fc.property(fc.uniqueArray(fc.record({ sheetId: fc.integer({ min: 0, max: 5 }), rowIndex: fc.integer({ min: 1, max: 500 }), key: fc.string({ minLength: 1 }) }), { selector: (b) => `${b.sheetId}:${b.rowIndex}`, maxLength: 8 }), (bindings) => {
        const { requests } = buildMetadataBody({ bindings });
        expect(requests).toHaveLength(bindings.length);
        requests.forEach((request, index) => {
          expect(typeOf(request)).toBe('createDeveloperMetadata');
          const meta = request.createDeveloperMetadata.developerMetadata;
          expect(meta.metadataKey).toBe(ROW_KEY_METADATA);
          expect(meta.metadataValue).toBe(bindings[index].key);
          expect(meta.location.dimensionRange).toEqual({ sheetId: bindings[index].sheetId, dimension: 'ROWS', startIndex: bindings[index].rowIndex, endIndex: bindings[index].rowIndex + 1 });
        });
      }),
    );
  });
});

describe('which requests are reads: a read-only capability is structural, so an unknown request is a write (SD-08)', () => {
  const SHEETS = 'https://sheets.googleapis.com/v4';
  const DRIVE = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const READS = [
    ['GET', `${SHEETS}/spreadsheets/abc?fields=sheets.properties`],
    ['GET', `${SHEETS}/spreadsheets/abc/values:batchGet?ranges=Jobs&valueRenderOption=UNFORMATTED_VALUE`],
    ['POST', `${SHEETS}/spreadsheets/abc/developerMetadata:search`],
    ['GET', `${DRIVE}/files/abc?fields=trashed`],
  ];
  const WRITES = [
    ['POST', `${SHEETS}/spreadsheets/abc:batchUpdate`],
    ['POST', `${SHEETS}/spreadsheets/abc/values:batchUpdate`],
    ['PUT', `${SHEETS}/spreadsheets/abc/values/Jobs!A1?valueInputOption=RAW`],
    ['POST', `${SHEETS}/spreadsheets/abc/values/Jobs!A1:append`],
    ['POST', `${SHEETS}/spreadsheets/abc/values:batchClear`],
    ['POST', `${UPLOAD}/files?uploadType=multipart`],
    ['DELETE', `${DRIVE}/files/abc`],
    ['PATCH', `${DRIVE}/files/abc`],
  ];

  for (const [method, url] of READS) {
    it(`${method} ${new URL(url).pathname.split('/').slice(-2).join('/')} is a read`, () => {
      expect(classifyRequest({ method, url })).toBe(RequestClass.READ);
    });
  }

  for (const [method, url] of WRITES) {
    it(`@error ${method} ${new URL(url).pathname.split('/').slice(-2).join('/')} is a write`, () => {
      expect(classifyRequest({ method, url })).toBe(RequestClass.WRITE);
    });
  }

  it('@error @property any non-GET request other than a metadata search is a write, whatever its path', () => {
    holds(
      fc.property(fc.constantFrom('POST', 'PUT', 'PATCH', 'DELETE'), fc.array(fc.stringMatching(/^[a-zA-Z0-9]{1,8}$/), { minLength: 1, maxLength: 4 }), (method, segments) => {
        const url = `https://sheets.googleapis.com/v4/${segments.join('/')}`;
        expect(classifyRequest({ method, url })).toBe(RequestClass.WRITE);
      }),
    );
  });

  it('@error a method the classifier does not recognise is a write, not a read', () => {
    expect(classifyRequest({ method: 'BREW', url: `${SHEETS}/spreadsheets/abc` })).toBe(RequestClass.WRITE);
  });
});
